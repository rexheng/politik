// Test helpers for the range-reading zip adapter: an in-memory zip builder, and a fake `fetch` that serves byte ranges.
// The zips are built with node:zlib only (deflateRawSync for the data, crc32 for the checksums).
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";

const utf8 = (s: string) => new TextEncoder().encode(s);
const bytesOf = (data: Uint8Array | string) => (typeof data === "string" ? utf8(data) : data);

export interface ZipEntrySpec {
  name: string;
  data: Uint8Array | string;
  /** 0 = stored, 8 = deflate (the default). Any other number writes the bytes as they are, labelled with that method code. */
  method?: number;
  /** Bytes for the local header's extra field. The central directory's own extra field is separate, as in real archives. */
  localExtra?: Uint8Array;
}

export interface ZipOptions {
  comment?: Uint8Array | string;
  /**
   * "eocd": a ZIP64 end-of-central-directory record and locator, with the classic record's entry count set to 0xFFFF.
   * That is what the Legislature's pubinfo archives look like (they hold more than 65,535 entries).
   * "full": also 0xFFFFFFFF sizes and offsets in every central directory entry, with a ZIP64 extra field.
   */
  zip64?: "eocd" | "full";
}

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;
  push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
  u16(n: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    this.push(b);
  }
  u32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    this.push(b);
  }
  u64(n: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
    this.push(b);
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** A zip archive holding `entries`, in order. */
export function buildZip(entries: ZipEntrySpec[], options: ZipOptions = {}): Uint8Array {
  const w = new Writer();
  const central: { spec: ZipEntrySpec; method: number; crc: number; csize: number; usize: number; offset: number }[] = [];

  for (const spec of entries) {
    const raw = bytesOf(spec.data);
    const method = spec.method ?? 8;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const name = utf8(spec.name);
    const extra = spec.localExtra ?? new Uint8Array(0);
    const crc = crc32(raw);
    const offset = w.length;
    w.u32(0x04034b50);
    w.u16(options.zip64 ? 45 : 20);
    w.u16(0x0800); // names are UTF-8
    w.u16(method);
    w.u16(0); // time
    w.u16(0x21); // date
    w.u32(crc);
    w.u32(stored.length);
    w.u32(raw.length);
    w.u16(name.length);
    w.u16(extra.length);
    w.push(name);
    w.push(extra);
    w.push(stored);
    central.push({ spec, method, crc, csize: stored.length, usize: raw.length, offset });
  }

  const cdOffset = w.length;
  for (const c of central) {
    const name = utf8(c.spec.name);
    const full = options.zip64 === "full";
    const extra = new Writer();
    if (full) {
      extra.u16(0x0001);
      extra.u16(24);
      extra.u64(c.usize);
      extra.u64(c.csize);
      extra.u64(c.offset);
    }
    const extraBytes = extra.bytes();
    w.u32(0x02014b50);
    w.u16(options.zip64 ? 45 : 20); // made by
    w.u16(options.zip64 ? 45 : 20); // needed
    w.u16(0x0800);
    w.u16(c.method);
    w.u16(0);
    w.u16(0x21);
    w.u32(c.crc);
    w.u32(full ? 0xffffffff : c.csize);
    w.u32(full ? 0xffffffff : c.usize);
    w.u16(name.length);
    w.u16(extraBytes.length);
    w.u16(0); // comment
    w.u16(0); // disk
    w.u16(0); // internal attrs
    w.u32(0); // external attrs
    w.u32(full ? 0xffffffff : c.offset);
    w.push(name);
    w.push(extraBytes);
  }
  const cdSize = w.length - cdOffset;

  if (options.zip64) {
    const eocd64At = w.length;
    w.u32(0x06064b50);
    w.u64(44);
    w.u16(45);
    w.u16(45);
    w.u32(0);
    w.u32(0);
    w.u64(central.length);
    w.u64(central.length);
    w.u64(cdSize);
    w.u64(cdOffset);
    w.u32(0x07064b50); // locator
    w.u32(0);
    w.u64(eocd64At);
    w.u32(1);
  }

  const comment = options.comment === undefined ? new Uint8Array(0) : bytesOf(options.comment);
  const full = options.zip64 === "full";
  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(options.zip64 ? 0xffff : central.length);
  w.u16(options.zip64 ? 0xffff : central.length);
  w.u32(full ? 0xffffffff : cdSize);
  w.u32(full ? 0xffffffff : cdOffset);
  w.u16(comment.length);
  w.push(comment);
  return w.bytes();
}

export interface ServedRequest {
  url: string;
  /** The Range header as sent, or null if there was none. */
  range: string | null;
  /** The Accept-Encoding header as sent, or null. */
  acceptEncoding: string | null;
  status: number;
  /** The number of body bytes sent back. */
  bytes: number;
}

export interface RangeServer {
  fetch: typeof fetch;
  /** The files by URL. Replace an entry to make the "archive" change: its ETag follows its bytes. */
  files: Map<string, Uint8Array>;
  requests: ServedRequest[];
  /** Total body bytes served so far. */
  bytesServed(): number;
}

/**
 * A fake `fetch` that serves `files` (URL to bytes) like the Legislature's download site: it honours `Range`
 * (`bytes=a-b`, `bytes=a-` and `bytes=-n`) with a 206 and a Content-Range, and sends an ETag derived from the bytes.
 * `ignoreRange` makes it answer every request with a 200 and the whole file, like a server that has no range support.
 */
export function serveRanges(files: Record<string, Uint8Array>, options: { ignoreRange?: boolean } = {}): RangeServer {
  const map = new Map(Object.entries(files));
  const requests: ServedRequest[] = [];
  const etagOf = (bytes: Uint8Array) => `"${createHash("sha1").update(bytes).digest("hex").slice(0, 16)}"`;

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const sent = new Headers(init?.headers);
    const range = sent.get("range");
    const file = map.get(url);
    const reply = (status: number, body: Uint8Array | string, headers: Record<string, string> = {}) => {
      const bytes = typeof body === "string" ? utf8(body) : body;
      requests.push({ url, range, acceptEncoding: sent.get("accept-encoding"), status, bytes: bytes.length });
      return new Response(bytes as BodyInit, { status, headers });
    };
    if (!file) return reply(404, "not found");
    const etag = etagOf(file);
    if (!range || options.ignoreRange) return reply(200, file, { ETag: etag, "Content-Length": String(file.length) });

    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (m[1] === "" && m[2] === "")) return reply(416, "bad range");
    let start: number;
    let end: number;
    if (m[1] === "") {
      start = Math.max(0, file.length - Number(m[2]));
      end = file.length - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? file.length - 1 : Math.min(Number(m[2]), file.length - 1);
    }
    if (start >= file.length || start > end) return reply(416, "range not satisfiable", { "Content-Range": `bytes */${file.length}` });
    return reply(206, file.subarray(start, end + 1), { ETag: etag, "Content-Range": `bytes ${start}-${end}/${file.length}` });
  }) as typeof fetch;

  return { fetch: impl, files: map, requests, bytesServed: () => requests.reduce((n, r) => n + r.bytes, 0) };
}
