// Reads California bill text from the Legislature's own bulk download, because leginfo.legislature.ca.gov answers every
// automated request with HTTP 403.
//
// The Legislature publishes the same text at https://downloads.leginfo.legislature.ca.gov/pubinfo_<year>.zip, one archive
// per two-year session, named for the session's first year (2025 covers 2025-26). The archives are about 1.2 GB, so this
// module never downloads one. The server answers HTTP Range requests, so it reads only:
//   1. the end of the archive and its central directory (about 20 MB: the archive has some 200,000 entries, nearly all
//      of them law-section and analysis files that no bill needs, so only the tables and the bill-version entries are
//      kept and saved),
//   2. BILL_VERSION_TBL.dat, the table of every bill version (about 0.8 MB compressed),
//   3. BILL_HISTORY_TBL.dat (about 1.8 MB) and BILL_TBL.dat (about 0.1 MB), for the history of each bill and where it
//      stands (see "Why the history" below), and
//   4. the one XML file of the bill version wanted (a few KB to about 100 KB).
// The directory, the parsed version table and the histories of the bills asked for are cached per session year, so after
// the first bill of a session each further bill costs two small requests.
//
// What the pubinfo files look like (checked against the live 2023 and 2025 archives, 2026-10-15; pubinfo_Readme.pdf and
// the load script in pubinfo_load.zip give the layout):
//  - The archives are ZIP64: the end record says 65,535 entries, and the ZIP64 end record gives the real count (205,056).
//    Every entry is deflated (method 8) and the names are flat, with no folders: the tables are `BILL_VERSION_TBL.dat` and
//    so on, and a table's large text columns are separate files named `BILL_VERSION_TBL_<n>.lob`.
//  - A .dat file is tab-separated, one row per line, with no header. A text value is wrapped in backticks, a number or
//    date is not, and NULL is the bare word NULL. MySQL's loader (the load script) reads it as `FIELDS TERMINATED BY '\t'
//    OPTIONALLY ENCLOSED BY '`' LINES TERMINATED BY '\n'`, so a tab or newline inside backticks belongs to the value.
//    The real BILL_VERSION_TBL.dat holds neither, nor a doubled backtick, but this parser handles all three.
//  - BILL_VERSION_TBL.dat has 18 columns, in this order (from the load script): BILL_VERSION_ID, BILL_ID, VERSION_NUM,
//    BILL_VERSION_ACTION_DATE, BILL_VERSION_ACTION, REQUEST_NUM, SUBJECT, VOTE_REQUIRED, APPROPRIATION, FISCAL_COMMITTEE,
//    LOCAL_PROGRAM, SUBSTANTIVE_CHANGES, URGENCY, TAXLEVY, BILL_XML, ACTIVE_FLG, TRANS_UID, TRANS_UPDATE. In the file,
//    BILL_XML (column 15) is the name of the LOB file that holds the bill's XML, written bare: `BILL_VERSION_TBL_8965.lob`.
//    A LOB file is named for its row's position in the table, so the name has to be read from this column.
//  - BILL_ID is `<session years><session number><type><number>`, for example `202520260SB53`. BILL_VERSION_ID is
//    `<first year>0<type><number><VERSION_NUM><stage>`, for example `20250SB5390CHP`. The stage is the last three
//    letters, INT, AMD, ENR or CHP, and the action column says the same in words: Introduced, Amended Senate/Assembly,
//    Enrolled, Chaptered. VERSION_NUM counts DOWN from 99 (introduced) with each later version, so the lowest number is
//    the newest version. Action dates are `YYYY-MM-DD 00:00:00`. A vetoed bill's last version is its Enrolled one.
//    Some bills have an enrolled and a chaptered version on one day (46 of 5,065 in 2025), which is why `latestVersion`
//    breaks a tie on the date by the stage.
//  - A bill's LOB file is CAML XML: a caml:Description (with the subject and the Legislative Counsel's Digest) and a
//    caml:Bill of caml:BillSection elements ("SECTION 1.", "SEC. 2."). Deleted text is a processing instruction,
//    `<?xm-deletion_mark data=" January 31"?>`, and inserted text sits between `<?xm-insertion_mark_start?>` and
//    `<?xm-insertion_mark_end?>`. So reading the XML without its processing instructions gives the bill as it would read.
//
//  - Why the history. The text of a bill version cannot say whether the bill was signed, vetoed or left to die: the
//    enrolled text of a vetoed bill reads like any passed bill. Enrichment derives a record's status and timeline from
//    its text, and verification checks them against it, so the text this module returns carries the bill's
//    legislative history and its current status (see `legislativeHistoryText`).
//  - Why this order (R23): a header naming the bill, then the Legislative Counsel's Digest, then the history, then the
//    bill's sections. The verifier's identity check reads the start of the text, and a model asked to summarise a long
//    bill may see only its first thousand words, so what the bill is (the header), what it does (the digest) and how it
//    ended (the history) come first. With the history first, the digest began in passage 3 or later for 33 of the 63
//    bills and the identity check could not find the bill's subject.
//  - BILL_HISTORY_TBL.dat has 13 columns, in this order (from the load script): BILL_ID, BILL_HISTORY_ID, ACTION_DATE,
//    ACTION, TRANS_UID, TRANS_UPDATE_DT, ACTION_SEQUENCE, ACTION_CODE, ACTION_STATUS, PRIMARY_LOCATION,
//    SECONDARY_LOCATION, TERNARY_LOCATION, END_STATUS. One row per action on a bill: the date is `YYYY-MM-DD 00:00:00`,
//    ACTION is the Legislature's own wording ("Vetoed by the Governor.", "Chaptered by Secretary of State.  Chapter 138,
//    Statutes of 2025.", with runs of spaces in it), and END_STATUS is the bill's status after the action. The file is
//    NOT in date order, a bill's rows are spread through it, and a bill can have two rows with the same date and
//    sequence number, so rows are sorted by (date, ACTION_SEQUENCE, BILL_HISTORY_ID). ACTION_STATUS is "Applied" for
//    all but a handful of rows: "Rescinded" (an earlier vote that was rescinded), "Reconsidered" and
//    "Pending-Reconsideration"; those rows are kept, with the status in brackets after the text.
//  - BILL_TBL.dat has 19 columns: BILL_ID, SESSION_YEAR, SESSION_NUM, MEASURE_TYPE, MEASURE_NUM, MEASURE_STATE,
//    CHAPTER_YEAR, CHAPTER_TYPE, CHAPTER_SESSION_NUM, CHAPTER_NUM, LATEST_BILL_VERSION_ID, ACTIVE_FLG, TRANS_UID,
//    TRANS_UPDATE, CURRENT_LOCATION, CURRENT_SECONDARY_LOC, CURRENT_HOUSE, CURRENT_STATUS, DAYS_31ST_IN_PRINT. The
//    status is CURRENT_STATUS (column 18): Chaptered, Vetoed, Died, In Committee Process, In Floor Process, Passed,
//    Pending Referral, Failed, Failed Passage in Committee, In Desk Process, or NULL. Beware: a vetoed bill is "Vetoed"
//    only after the Legislature has dealt with the veto; many (SB 1047 among them) stay "In Floor Process" while
//    "Consideration of Governor's veto pending", so the status line alone does not say whether a bill was vetoed:
//    the history does. So the status line is left out when the history has a veto or a chaptering (R22).
//
// Node-only build code: never import this from photon/src.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

import { htmlToText } from "./extract.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Bill URLs

const LEGINFO_HOSTS = new Set(["leginfo.legislature.ca.gov", "www.leginfo.legislature.ca.gov"]);
/** `202520260SB53`: two years, the session number, the measure type and the number. The first four digits name the archive. */
const BILL_ID = /^(\d{4})\d{4}\d[A-Z]+\d+$/;

/**
 * The bill and the archive year of a leginfo bill page (`billNavClient`, `billTextClient`, `billStatusClient`: any page
 * with a `bill_id`). Null for other sites and for leginfo pages that name no bill, such as code sections.
 */
export function parseLeginfoBillId(url: string): { billId: string; sessionYear: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!LEGINFO_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const billId = parsed.searchParams.get("bill_id")?.trim().toUpperCase();
  const match = billId ? BILL_ID.exec(billId) : null;
  return billId && match ? { billId, sessionYear: match[1]! } : null;
}

export const pubinfoUrl = (sessionYear: string): string => `https://downloads.leginfo.legislature.ca.gov/pubinfo_${sessionYear}.zip`;

// ---------------------------------------------------------------------------------------------------------------------
// A zip archive read by byte ranges

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  /** Where the entry's local header starts. */
  offset: number;
}

/** What is known of an archive's layout, and which version of the file it describes. */
export interface ZipDirectory {
  archive: { size: number; etag?: string };
  entries: ZipEntry[];
}

export interface RangeZip {
  /** The names of the entries in the directory, as the archive spells them. */
  names(): string[];
  /** The bytes of one entry, uncompressed and checked against the archive's checksum. A name matches by basename, ignoring case. */
  read(name: string): Promise<Uint8Array>;
  /** The directory as read, for saving and passing back to `createRangeZipReader` so the archive's tail need not be read again. */
  directory(): ZipDirectory;
}

/** The archive file has changed since its directory was read (the Legislature rebuilds the archives weekly): the directory's offsets are no use. */
export class ArchiveChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveChangedError";
  }
}

export interface ZipReaderOptions {
  /** A directory read earlier. The archive is not touched to open it. */
  directory?: ZipDirectory;
  /** Keep only the entries this accepts (given the full entry name) when reading the directory. Default: all. */
  keep?: (name: string) => boolean;
}

const REQUEST_TIMEOUT_MS = 120_000;
/** The first read from the end of the file: enough for an archive with no comment. */
const FIRST_TAIL_BYTES = 1024;
/** Enough for the longest archive comment (65,535 bytes), the end record (22) and the ZIP64 locator (20). */
const LONG_TAIL_BYTES = 65_535 + 22 + 20;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const baseName = (name: string) => name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);

interface RangeResult {
  bytes: Uint8Array;
  start: number;
  /** The whole file's length, from Content-Range. */
  size: number;
  etag?: string;
}

/**
 * One range request, answered with a 206 or refused. A server that answers 200 is ignoring the Range header and sending
 * the whole archive, so the body is cancelled unread. With `expected`, a different file size or ETag means the archive changed.
 */
async function getRange(
  url: string,
  fetchImpl: typeof fetch,
  range: { start: number; end: number } | { suffix: number },
  expected?: ZipDirectory["archive"],
): Promise<RangeResult> {
  const header = "suffix" in range ? `bytes=-${range.suffix}` : `bytes=${range.start}-${range.end}`;
  // "identity" so that the bytes sent are the archive's own bytes, which is what the Range header counts.
  const res = await fetchImpl(url, { headers: { Range: header, "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status !== 206) {
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 200) throw new Error(`${url} ignored the Range header (HTTP 200); not downloading the whole archive`);
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
  if (!match) throw new Error(`${url} sent no usable Content-Range for ${header}`);
  const start = Number(match[1]);
  const size = Number(match[3]);
  const etag = res.headers.get("etag") ?? undefined;
  if (expected && (size !== expected.size || (expected.etag !== undefined && etag !== undefined && etag !== expected.etag))) {
    await res.body?.cancel().catch(() => undefined);
    throw new ArchiveChangedError(`${url} has changed since its directory was read (size ${expected.size} to ${size}, ETag ${expected.etag} to ${etag})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if ("start" in range && start !== range.start) throw new Error(`${url} answered ${header} with bytes from ${start}`);
  if (bytes.length !== Number(match[2]) - start + 1) throw new Error(`${url} sent ${bytes.length} bytes for ${header}, not what its Content-Range says`);
  return { bytes, start, size, ...(etag !== undefined ? { etag } : {}) };
}

/** Where the end-of-central-directory record starts in `tail`, or -1. Its comment must run exactly to the end of the file, else (trailing bytes) at most to it. */
function findEndRecord(tail: Uint8Array): number {
  const dv = view(tail);
  for (const exact of [true, false]) {
    for (let at = tail.length - 22; at >= 0; at--) {
      if (dv.getUint32(at, true) !== SIG_EOCD) continue;
      const end = at + 22 + dv.getUint16(at + 20, true);
      if (exact ? end === tail.length : end <= tail.length) return at;
    }
  }
  return -1;
}

async function readDirectory(url: string, fetchImpl: typeof fetch, keep: ZipReaderOptions["keep"]): Promise<ZipDirectory> {
  let tail = await getRange(url, fetchImpl, { suffix: FIRST_TAIL_BYTES });
  let at = findEndRecord(tail.bytes);
  if (at < 0 && tail.size > tail.bytes.length) {
    // A long archive comment pushes the end record out of the first read.
    tail = await getRange(url, fetchImpl, { suffix: Math.min(tail.size, LONG_TAIL_BYTES) }, { size: tail.size, etag: tail.etag });
    at = findEndRecord(tail.bytes);
  }
  if (at < 0) throw new Error(`${url} is not a zip archive (no end-of-central-directory record)`);
  const archive: ZipDirectory["archive"] = { size: tail.size, ...(tail.etag !== undefined ? { etag: tail.etag } : {}) };

  const dv = view(tail.bytes);
  let count = dv.getUint16(at + 10, true);
  let cdSize = dv.getUint32(at + 12, true);
  let cdOffset = dv.getUint32(at + 16, true);
  if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && at >= 20 && dv.getUint32(at - 20, true) === SIG_ZIP64_LOCATOR) {
    const recordAt = Number(dv.getBigUint64(at - 20 + 8, true));
    const recordEnd = recordAt + 56;
    const record =
      recordAt >= tail.start && recordEnd <= tail.start + tail.bytes.length
        ? tail.bytes.subarray(recordAt - tail.start, recordEnd - tail.start)
        : (await getRange(url, fetchImpl, { start: recordAt, end: recordEnd - 1 }, archive)).bytes;
    const r = view(record);
    if (r.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new Error(`${url} has a damaged ZIP64 end record`);
    count = Number(r.getBigUint64(32, true));
    cdSize = Number(r.getBigUint64(40, true));
    cdOffset = Number(r.getBigUint64(48, true));
  }

  const central =
    cdSize === 0
      ? new Uint8Array(0)
      : cdOffset >= tail.start && cdOffset + cdSize <= tail.start + tail.bytes.length
        ? tail.bytes.subarray(cdOffset - tail.start, cdOffset - tail.start + cdSize)
        : (await getRange(url, fetchImpl, { start: cdOffset, end: cdOffset + cdSize - 1 }, archive)).bytes;
  return { archive, entries: parseCentralDirectory(central, count, keep) };
}

function parseCentralDirectory(bytes: Uint8Array, count: number, keep: ZipReaderOptions["keep"]): ZipEntry[] {
  const dv = view(bytes);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CENTRAL) throw new Error("the zip archive's central directory is damaged");
    const method = dv.getUint16(p + 10, true);
    let compressedSize = dv.getUint32(p + 20, true);
    let uncompressedSize = dv.getUint32(p + 24, true);
    const nameLength = dv.getUint16(p + 28, true);
    const extraLength = dv.getUint16(p + 30, true);
    const commentLength = dv.getUint16(p + 32, true);
    let offset = dv.getUint32(p + 42, true);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length) throw new Error("the zip archive's central directory is damaged");
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));

    if (!keep || keep(name)) {
      // The ZIP64 extra field (id 1) holds, in order, only those of the three values that were written as 0xFFFFFFFF.
      for (let q = p + 46 + nameLength, end = q + extraLength; q + 4 <= end; ) {
        const id = dv.getUint16(q, true);
        const size = dv.getUint16(q + 2, true);
        if (id === 1) {
          let r = q + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(dv.getBigUint64(r, true));
            r += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(dv.getBigUint64(r, true));
            r += 8;
          }
          if (offset === 0xffffffff) offset = Number(dv.getBigUint64(r, true));
        }
        q += 4 + size;
      }
      entries.push({ name, method, compressedSize, uncompressedSize, crc32: dv.getUint32(p + 16, true), offset });
    }
    p = next;
  }
  return entries;
}

/**
 * Opens a remote zip archive for reading single entries by byte range. It reads the end-of-central-directory record from
 * the file's tail (a comment of up to 65,535 bytes and the ZIP64 record and locator are handled), then the central
 * directory. `read` fetches an entry's 30-byte local header, then its data. Only methods 0 (stored) and 8 (deflate) are
 * supported. With `options.directory` the archive is not touched until an entry is read.
 * Every response must be a 206: a server that sends a 200 is refused without reading the body.
 */
export async function createRangeZipReader(url: string, fetchImpl: typeof fetch = fetch, options: ZipReaderOptions = {}): Promise<RangeZip> {
  const directory = options.directory ?? (await readDirectory(url, fetchImpl, options.keep));
  const byName = new Map<string, ZipEntry>();
  for (const entry of directory.entries) {
    const key = baseName(entry.name).toLowerCase();
    if (!byName.has(key)) byName.set(key, entry);
  }

  return {
    names: () => directory.entries.map((e) => e.name),
    directory: () => directory,
    async read(name) {
      const entry = byName.get(baseName(name).toLowerCase());
      if (!entry) throw new Error(`${name} is not in the archive`);
      if (entry.method !== 0 && entry.method !== 8) throw new Error(`${entry.name} uses compression method ${entry.method}, which is not supported (only stored and deflate are)`);

      const head = await getRange(url, fetchImpl, { start: entry.offset, end: entry.offset + 29 }, directory.archive);
      const h = view(head.bytes);
      if (h.getUint32(0, true) !== SIG_LOCAL) throw new ArchiveChangedError(`${url} has no entry for ${entry.name} where its directory says`);
      const dataStart = entry.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const compressed =
        entry.compressedSize === 0
          ? new Uint8Array(0)
          : (await getRange(url, fetchImpl, { start: dataStart, end: dataStart + entry.compressedSize - 1 }, directory.archive)).bytes;

      const data =
        entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
      if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc32) {
        throw new Error(`${entry.name} failed its checksum (the archive may have changed while it was read)`);
      }
      return data;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The .dat format and BILL_VERSION_TBL

/**
 * Parses a pubinfo .dat file: fields separated by tabs, rows by newlines, a value optionally wrapped in backticks
 * (inside which a tab, a newline or a doubled backtick belong to the value), and the bare word NULL for a null.
 * A quoted `NULL` is the text "NULL".
 */
export function parseDat(text: string): (string | null)[][] {
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [];
  let field = "";
  let quoted = false;
  let inQuote = false;
  const endField = () => {
    row.push(!quoted && field === "NULL" ? null : field);
    field = "";
    quoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuote) {
      if (ch !== "`") field += ch;
      else if (text[i + 1] === "`") (field += "`"), i++;
      else inQuote = false;
    } else if (ch === "`" && field === "" && !quoted) {
      inQuote = true;
      quoted = true;
    } else if (ch === "\t") {
      endField();
    } else if (ch === "\n") {
      endField();
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (row.length > 0 || field !== "" || quoted) {
    endField();
    rows.push(row);
  }
  return rows;
}

export interface BillVersion {
  /** For example `20250SB5390CHP`. */
  versionId: string;
  /** For example `202520260SB53`. */
  billId: string;
  /** Counts down from 99 (introduced): the lowest number is the newest version. */
  versionNum: string;
  /** As the table has it, `YYYY-MM-DD 00:00:00`. */
  actionDate: string;
  /** `Introduced`, `Amended Senate`, `Amended Assembly`, `Enrolled` or `Chaptered`. */
  action: string;
  /** The SUBJECT column, for example `Artificial intelligence models: large developers.` Empty when the table has NULL; absent in an index cached before it was kept. */
  subject?: string;
  /** The LOB file that holds the version's XML, for example `BILL_VERSION_TBL_8965.lob`. */
  xmlFile: string;
}

const VERSION_TABLE = "BILL_VERSION_TBL.dat";
/** Columns of BILL_VERSION_TBL.dat (0-based): see the header comment. */
const COL = { versionId: 0, billId: 1, versionNum: 2, actionDate: 3, action: 4, subject: 6, xmlFile: 14 } as const;
const VERSION_TABLE_COLUMNS = 18;

/** Every bill version in the archive's BILL_VERSION_TBL.dat. Rows with no XML file, or too few columns, are skipped. */
export async function loadBillVersions(zip: RangeZip): Promise<BillVersion[]> {
  const text = new TextDecoder().decode(await zip.read(VERSION_TABLE));
  const rows = parseDat(text);
  const versions: BillVersion[] = [];
  for (const row of rows) {
    if (row.length < VERSION_TABLE_COLUMNS) continue;
    const pick = (i: number) => row[i] ?? "";
    const version: BillVersion = {
      versionId: pick(COL.versionId),
      billId: pick(COL.billId),
      versionNum: pick(COL.versionNum),
      actionDate: pick(COL.actionDate),
      action: pick(COL.action),
      subject: pick(COL.subject),
      xmlFile: pick(COL.xmlFile),
    };
    if (version.versionId && version.billId && version.xmlFile) versions.push(version);
  }
  if (rows.length > 0 && versions.length === 0) {
    throw new Error(`${VERSION_TABLE} has no rows in the expected ${VERSION_TABLE_COLUMNS}-column layout (the format may have changed)`);
  }
  return versions;
}

/** 0 introduced, 1 amended, 2 enrolled, 3 chaptered; the action text first, then the version id's last three letters. */
function stageRank(v: BillVersion): number {
  const action = v.action.toLowerCase();
  if (action.startsWith("chaptered")) return 3;
  if (action.startsWith("enrolled")) return 2;
  if (action.startsWith("amended")) return 1;
  if (action.startsWith("introduced")) return 0;
  return { CHP: 3, ENR: 2, AMD: 1, INT: 0 }[v.versionId.slice(-3).toUpperCase()] ?? -1;
}

/**
 * The newest version of a bill: the latest action date, a tie going to the most advanced stage (chaptered, then enrolled,
 * then amended, then introduced) and a tie of that to the lower version number, which is the later version.
 */
export function latestVersion(versions: BillVersion[], billId: string): BillVersion | null {
  let best: BillVersion | null = null;
  for (const v of versions) {
    if (v.billId !== billId) continue;
    if (!best || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

function compareVersions(a: BillVersion, b: BillVersion): number {
  if (a.actionDate !== b.actionDate) return a.actionDate > b.actionDate ? 1 : -1;
  const stage = stageRank(a) - stageRank(b);
  if (stage !== 0) return stage;
  return Number(b.versionNum) - Number(a.versionNum);
}

// ---------------------------------------------------------------------------------------------------------------------
// BILL_HISTORY_TBL and BILL_TBL: what happened to a bill, and where it stands

export interface HistoryAction {
  /** `YYYY-MM-DD` */
  date: string;
  /** The Legislature's wording with runs of whitespace collapsed; a row that was not "Applied" has its status in brackets at the end. */
  text: string;
}

export interface BillHistory {
  /** BILL_TBL.dat's CURRENT_STATUS, for example "Chaptered", or null. */
  status: string | null;
  /** Oldest first. */
  actions: HistoryAction[];
}

const HISTORY_TABLE = "BILL_HISTORY_TBL.dat";
const BILL_TABLE = "BILL_TBL.dat";
const HISTORY_COLUMNS = 13;
const BILL_TABLE_COLUMNS = 19;
/** Columns of BILL_HISTORY_TBL.dat (0-based): see the header comment. */
const HCOL = { billId: 0, historyId: 1, actionDate: 2, action: 3, sequence: 6, actionStatus: 8 } as const;
/** CURRENT_STATUS in BILL_TBL.dat (0-based). */
const BILL_STATUS_COL = 17;

const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * The legislative history and current status of bills, from BILL_HISTORY_TBL.dat and BILL_TBL.dat.
 * `billIds` are the bills to keep ("all" keeps every bill): every one asked for is in the result, with no actions and a
 * null status if the tables have nothing on it. Actions come oldest first.
 */
export async function loadBillHistories(zip: RangeZip, billIds: ReadonlySet<string> | "all"): Promise<Map<string, BillHistory>> {
  const wanted = (id: string) => billIds === "all" || billIds.has(id);
  const result = new Map<string, BillHistory>();
  const historyOf = (id: string): BillHistory => {
    let h = result.get(id);
    if (!h) result.set(id, (h = { status: null, actions: [] }));
    return h;
  };
  if (billIds !== "all") for (const id of billIds) historyOf(id);

  const historyRows = parseDat(decodeUtf8(await zip.read(HISTORY_TABLE)));
  const billRows = parseDat(decodeUtf8(await zip.read(BILL_TABLE)));

  const pending = new Map<string, { date: string; sequence: number; historyId: number; text: string }[]>();
  let valid = 0;
  for (const row of historyRows) {
    if (row.length < HISTORY_COLUMNS) continue;
    valid++;
    const billId = row[HCOL.billId];
    if (!billId || !wanted(billId)) continue;
    const date = (row[HCOL.actionDate] ?? "").slice(0, 10);
    const action = (row[HCOL.action] ?? "").replace(/\s+/g, " ").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !action) continue;
    const status = row[HCOL.actionStatus];
    const text = status && status !== "Applied" ? `${action} [${status}]` : action;
    const list = pending.get(billId) ?? [];
    list.push({ date, sequence: Number(row[HCOL.sequence]) || 0, historyId: Number(row[HCOL.historyId]) || 0, text });
    pending.set(billId, list);
  }
  if (historyRows.length > 0 && valid === 0) {
    throw new Error(`${HISTORY_TABLE} has no rows in the expected ${HISTORY_COLUMNS}-column layout (the format may have changed)`);
  }
  for (const [billId, list] of pending) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sequence - b.sequence || a.historyId - b.historyId));
    historyOf(billId).actions = list.map(({ date, text }) => ({ date, text }));
  }

  let validBills = 0;
  for (const row of billRows) {
    if (row.length < BILL_TABLE_COLUMNS) continue;
    validBills++;
    const billId = row[0];
    if (billId && wanted(billId)) historyOf(billId).status = row[BILL_STATUS_COL] || null;
  }
  if (billRows.length > 0 && validBills === 0) {
    throw new Error(`${BILL_TABLE} has no rows in the expected ${BILL_TABLE_COLUMNS}-column layout (the format may have changed)`);
  }
  return result;
}

/** An action that decides how a bill ended: a veto, or the Secretary of State chaptering it (that is, it became law). */
const DECISIVE_ACTION = /vetoed|chaptered by secretary of state/i;

/**
 * The section that goes in front of a bill's text, so that a record's status and timeline can be read from the text and
 * checked against it: `# Legislative history`, then one paragraph per action, oldest first, `YYYY-MM-DD \u2014 <action>`
 * (a paragraph each, because the passage splitter joins the lines of a paragraph and would run the actions together),
 * then `Current status: <status>` if there is one. Empty if there is neither an action nor a status.
 * There is no status line once the history holds a decisive action, a veto or a chaptering (R22): the history already
 * says how the bill ended, and BILL_TBL's status can disagree with it (a vetoed bill whose veto the Legislature has not
 * dealt with stays "In Floor Process"), which would mislead the model that reads it.
 */
export function legislativeHistoryText(history: BillHistory | undefined): string {
  if (!history) return "";
  const lines = history.actions.map((a) => `${a.date} \u2014 ${a.text}`);
  if (history.status && !history.actions.some((a) => DECISIVE_ACTION.test(a.text))) lines.push(`Current status: ${history.status}`);
  return lines.length > 0 ? ["# Legislative history", ...lines].join("\n\n") : "";
}

/**
 * The inverse of `legislativeHistoryText`, for the record extractors: the dated actions under a text's `# Legislative history`
 * heading, in the order written (oldest first), each with the action's wording exactly as written. Reads
 * `YYYY-MM-DD \u2014 <action>` lines up to the next heading; `Current status: ...` is not an action. The section may be anywhere
 * in the text. Empty when there is no such section. A change to `legislativeHistoryText` that this cannot read breaks a test.
 */
export function parseLegislativeHistory(text: string): { date: string; action: string }[] {
  const out: { date: string; action: string }[] = [];
  let inHistory = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#{1,6}[ \t]/.test(line)) {
      inHistory = /^#{1,6}[ \t]+Legislative history[ \t]*$/.test(line);
      continue;
    }
    if (!inHistory) continue;
    const m = /^(\d{4}-\d{2}-\d{2}) \u2014 (.*)$/.exec(line);
    if (m && m[2]!.trim()) out.push({ date: m[1]!, action: m[2]!.trim() });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Bill XML to text

const tagBody = (xml: string, tag: string): string | undefined => new RegExp(`<caml:${tag}\\b[^>]*>([\\s\\S]*?)</caml:${tag}>`).exec(xml)?.[1];

/** CAML fragment to simple HTML that `htmlToText` reads: spacing marks become spaces and CAML's structural elements become blocks. */
function camlToHtml(fragment: string): string {
  return fragment
    .replace(/<span\b[^>]*\/>/g, " ") // <span class="EnSpace"/> after "(a)"
    .replace(/<(\/?)xhtml:p\b/g, "<$1p")
    .replace(/<caml:LawHeading\b([^>]*)>/g, (_, attrs: string) => `<div>${/\btype="([^"]*)"/.exec(attrs)?.[1]?.toUpperCase() ?? ""} `) // CHAPTER 24.6. Title
    .replace(/<\/caml:(?:Num|LawHeadingText)>/g, "$& ")
    .replace(/<(\/?)caml:(?:ActionLine|Content|Fragment|LawSection|LawSectionVersion|LawHeading|BillSection|Preamble)\b/g, "<$1div");
}

/** The parts of a bill version's XML that go into its text, each as plain text (empty when the XML has none). */
export interface BillXmlParts {
  /** The subject line, for example `Artificial intelligence models: large developers.` */
  subject: string;
  /** The bill's title, `An act to add Section ... relating to ...`. */
  title: string;
  /** `# Legislative Counsel's Digest`, the subject line, then the digest; empty when the bill has no digest. */
  digest: string;
  /** Each section of the bill under its own heading: `# SECTION 1.`, `# SEC. 2.` */
  sections: string;
}

/**
 * Splits a bill version's CAML XML into its parts (see `BillXmlParts`). Tags go, entities are decoded, whitespace is
 * collapsed and paragraphs stay apart. Deleted text (a processing instruction, see the header) is left out and inserted
 * text kept, so the text reads as the bill would. The enacting clause is not repeated.
 */
export function billXmlParts(xml: string): BillXmlParts {
  const plain = (fragment: string | undefined) => htmlToText(`<p>${fragment ?? ""}</p>`);
  const subject = plain(tagBody(xml, "Subject"));
  const title = plain(tagBody(xml, "Title"));

  const digestBody = htmlToText(`<div>${camlToHtml(tagBody(xml, "DigestText") ?? "")}</div>`);
  const digest = digestBody ? ["# Legislative Counsel's Digest", ...(subject ? [subject] : []), digestBody].join("\n\n") : "";

  const blocks: string[] = [];
  const bill = /<caml:Bill\b[^>]*>([\s\S]*)<\/caml:Bill>/.exec(xml)?.[1] ?? "";
  for (const section of bill.matchAll(/<caml:BillSection\b[^>]*>([\s\S]*?)<\/caml:BillSection>/g)) {
    let inner = section[1]!;
    const num = /^(?:\s|<\?[\s\S]*?\?>)*<caml:Num\b[^>]*>([\s\S]*?)<\/caml:Num>/.exec(inner);
    if (num) inner = inner.slice(num[0].length);
    const heading = num ? htmlToText(`<h2>${num[1]}</h2>`) : "";
    const body = htmlToText(`<div>${camlToHtml(inner)}</div>`);
    if (heading) blocks.push(heading);
    if (body) blocks.push(body);
  }
  return { subject, title, digest, sections: blocks.join("\n\n") };
}

/**
 * Plain text of a bill version's CAML XML for the passage splitter. It starts with the Legislative Counsel's Digest
 * (under a `# Legislative Counsel's Digest` heading, after the bill's subject line), then each section of the bill under
 * its own heading, `# SECTION 1.`, `# SEC. 2.` (see `billXmlParts`). The bill's title ("An act to add ...") is not repeated.
 * Gives an empty string for XML with no digest and no sections.
 */
export function billXmlToText(xml: string): string {
  const { digest, sections } = billXmlParts(xml);
  return [digest, sections].filter(Boolean).join("\n\n");
}

/**
 * The line that opens a bill's text: `# Bill: SB 53 (2025-2026) \u2014 Artificial intelligence models: large developers.`
 * (R23). It names the measure type and number, the session's years and the subject, and the bill's title follows it as
 * the first paragraph. That paragraph is needed: the passage splitter drops a heading with nothing under it, and then
 * no passage would carry the bill's number. With no title it is the same words as the header, so it is never empty.
 * Empty for a bill id this module does not recognise.
 */
export function billHeaderText(billId: string, subject: string, title: string): string {
  const m = /^(\d{4})(\d{4})\d([A-Z]+)(\d+)$/.exec(billId);
  if (!m) return "";
  const what = `${m[3]} ${Number(m[4])} (${m[1]}-${m[2]})${subject ? ` \u2014 ${subject}` : ""}`;
  return [`# Bill: ${what}`, title || what].join("\n\n");
}

/**
 * Bumped when the layout of the text `leginfoBillText` returns changes. A download cached with an older layout (or with
 * none: the layout was not recorded before R23) is read again from the archive, which is cached, so it costs little.
 * 2: the header, then the digest, then the history, then the sections.
 */
export const LEGINFO_TEXT_LAYOUT = "2";

// ---------------------------------------------------------------------------------------------------------------------
// The bill's text, with the archive's layout cached

export type LeginfoResult =
  /**
   * `text` is the header, the digest, the legislative history (if the tables have any) and the sections, in that order
   * (R23); `billText` is the digest and the sections alone, which is what the 150-word gate counts.
   */
  | { ok: true; text: string; billText: string; versionId: string }
  | { ok: false; reason: "loading failed"; detail: string };

export interface LeginfoOptions {
  /** The index, the directory and the histories of each session are cached in `${cacheDir}/leginfo/`. */
  cacheDir: string;
  fetchImpl?: typeof fetch;
  /** Read the archive's directory and tables again instead of using the cached ones (once per run and session year, however many bills follow). */
  refresh?: boolean;
  /**
   * The bills whose history to keep in the session's history cache, as bill ids such as `202520260SB53`, or "all". The
   * bill asked for is always kept. When a bill the cache does not cover is asked for, the history tables are read
   * again and keep these, the bills the cache already has, and that bill: so a caller that names every bill it will
   * ask for reads the tables once per session. Default: only the bills asked for.
   */
  historyBills?: readonly string[] | "all";
}

interface Archive {
  zip: RangeZip;
  versions: BillVersion[];
}

/** The pubinfo files that bill text needs: the tables (18 small entries) and the bill XML files. The rest of the ~200,000 entries are left out of the cached directory. */
const keepEntry = (name: string) => /^(?:[^/\\]+\.dat|BILL_VERSION_TBL_\d+\.lob)$/i.test(baseName(name));
/** A cached directory that lacks one of these predates the history tables, and is read again. */
const REQUIRED_TABLES = [VERSION_TABLE, HISTORY_TABLE, BILL_TABLE];
const hasTables = (directory: ZipDirectory) =>
  REQUIRED_TABLES.every((table) => directory.entries.some((e) => baseName(e.name).toLowerCase() === table.toLowerCase()));

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function asArchiveRef(v: unknown): ZipDirectory["archive"] | undefined {
  const o = v as { size?: unknown; etag?: unknown } | null;
  return o && isNumber(o.size) && (o.etag === undefined || isString(o.etag)) ? (v as ZipDirectory["archive"]) : undefined;
}

function asDirectory(v: unknown): ZipDirectory | undefined {
  const o = v as { archive?: unknown; entries?: unknown } | null;
  const archive = asArchiveRef(o?.archive);
  if (!o || !archive || !Array.isArray(o.entries)) return undefined;
  for (const e of o.entries as Partial<Record<keyof ZipEntry, unknown>>[]) {
    if (!e || !isString(e.name) || !isNumber(e.method) || !isNumber(e.compressedSize) || !isNumber(e.uncompressedSize) || !isNumber(e.crc32) || !isNumber(e.offset)) {
      return undefined;
    }
  }
  return { archive, entries: o.entries as ZipEntry[] };
}

function asVersions(v: unknown): { archive: ZipDirectory["archive"]; versions: BillVersion[] } | undefined {
  const o = v as { archive?: unknown; versions?: unknown } | null;
  const archive = asArchiveRef(o?.archive);
  if (!o || !archive || !Array.isArray(o.versions)) return undefined;
  for (const e of o.versions as Partial<Record<keyof BillVersion, unknown>>[]) {
    if (!e || !isString(e.versionId) || !isString(e.billId) || !isString(e.versionNum) || !isString(e.actionDate) || !isString(e.action) || !isString(e.xmlFile)) return undefined;
    if (e.subject !== undefined && !isString(e.subject)) return undefined; // an index cached before the subject was kept has none
  }
  return { archive, versions: o.versions as BillVersion[] };
}

const sameArchive = (a: ZipDirectory["archive"], b: ZipDirectory["archive"]) => a.size === b.size && a.etag === b.etag;

interface HistoryCache {
  archive: ZipDirectory["archive"];
  /** Every bill is in `bills`. */
  all: boolean;
  /** The bills the cache covers, including those with nothing in the tables. */
  bills: Record<string, BillHistory>;
}

function asHistoryCache(v: unknown): HistoryCache | undefined {
  const o = v as { archive?: unknown; all?: unknown; bills?: unknown } | null;
  const archive = asArchiveRef(o?.archive);
  if (!o || !archive || typeof o.all !== "boolean" || !o.bills || typeof o.bills !== "object" || Array.isArray(o.bills)) return undefined;
  for (const h of Object.values(o.bills as Record<string, Partial<BillHistory> | null>)) {
    if (!h || (h.status !== null && !isString(h.status)) || !Array.isArray(h.actions)) return undefined;
    if (!h.actions.every((a) => a && isString(a.date) && isString(a.text))) return undefined;
  }
  return { archive, all: o.all, bills: o.bills as Record<string, BillHistory> };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.part`, JSON.stringify(value));
  await rename(`${path}.part`, path); // an interrupted run never leaves a truncated file for the next one to trust
}

// Session years whose index this process has built from the archive (so a bill missing from it really is missing), and
// those it has rebuilt because `refresh` asked for it (so the next bill of the run does not rebuild it again).
const builtThisRun = new Set<string>();
const refreshedThisRun = new Set<string>();
const opening = new Map<string, Promise<Archive>>();

/** The archive's directory and version table: from the cache when it is there and agrees, else read from the archive and cached. */
async function openArchive(sessionYear: string, key: string, opts: LeginfoOptions, fromNetwork: boolean): Promise<Archive> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = pubinfoUrl(sessionYear);
  const dir = join(opts.cacheDir, "leginfo");
  const directoryPath = join(dir, `${sessionYear}-directory.json`);
  const versionsPath = join(dir, `${sessionYear}-versions.json`);

  if (!fromNetwork) {
    const directory = asDirectory(await readJson(directoryPath));
    const cached = asVersions(await readJson(versionsPath));
    if (directory && hasTables(directory) && cached && sameArchive(directory.archive, cached.archive)) {
      return { zip: await createRangeZipReader(url, fetchImpl, { directory }), versions: cached.versions };
    }
  }

  const zip = await createRangeZipReader(url, fetchImpl, { keep: keepEntry });
  const versions = await loadBillVersions(zip);
  const { archive } = zip.directory();
  await mkdir(dir, { recursive: true });
  await writeJson(directoryPath, zip.directory());
  await writeJson(versionsPath, { archive, versions });
  builtThisRun.add(key);
  return { zip, versions };
}

function open(sessionYear: string, opts: LeginfoOptions, fromNetwork: boolean): Promise<Archive> {
  const key = `${resolve(opts.cacheDir)}|${sessionYear}`;
  const flight = `${key}|${fromNetwork}`;
  const running = opening.get(flight);
  if (running) return running;
  const started = openArchive(sessionYear, key, opts, fromNetwork).finally(() => opening.delete(flight));
  opening.set(flight, started);
  return started;
}

/**
 * The history and status of one bill: from the session's history cache when it covers the bill and describes this very
 * archive, else read from the two tables and cached for the bill, the `historyBills` and the bills the cache had.
 * `ignoreCache` is for a directory that was just read again. (Unlike `open`, concurrent calls are not merged: a build
 * asks for one bill at a time.)
 */
async function historyFor(archive: Archive, sessionYear: string, opts: LeginfoOptions, billId: string, ignoreCache: boolean): Promise<BillHistory> {
  const path = join(opts.cacheDir, "leginfo", `${sessionYear}-history.json`);
  const ref = archive.zip.directory().archive;
  let cache = ignoreCache ? undefined : asHistoryCache(await readJson(path));
  if (cache && !sameArchive(cache.archive, ref)) cache = undefined;
  const wantAll = opts.historyBills === "all";
  if (cache && (cache.all || (!wantAll && Object.hasOwn(cache.bills, billId)))) return cache.bills[billId] ?? { status: null, actions: [] };

  const keep = wantAll ? ("all" as const) : new Set([billId, ...(opts.historyBills ?? []), ...(cache ? Object.keys(cache.bills) : [])]);
  const histories = await loadBillHistories(archive.zip, keep);
  await mkdir(join(opts.cacheDir, "leginfo"), { recursive: true });
  await writeJson(path, { archive: ref, all: keep === "all", bills: Object.fromEntries(histories) } satisfies HistoryCache);
  return histories.get(billId) ?? { status: null, actions: [] };
}

const failure = (detail: string): LeginfoResult => ({ ok: false, reason: "loading failed", detail });
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The newest text of the California bill a leginfo URL names, read from the Legislature's bulk download (see the header),
 * with the id of the version it came from. The text starts with a header naming the bill (`billHeaderText`), then the
 * digest, then the bill's legislative history and current status (`legislativeHistoryText`; a bill the tables know
 * nothing about gets none), then the sections.
 * The session's version index, archive directory and histories are cached under `${cacheDir}/leginfo/`. They are read
 * again when `refresh` is set, when the archive turns out to have changed, and once when a bill is missing from an
 * index built by an earlier run. Failure is always reason "loading failed" with what went wrong in `detail`; that
 * includes an archive with no history table, since a text without its history can give a record the wrong status.
 */
export async function leginfoBillText(url: string, opts: LeginfoOptions): Promise<LeginfoResult> {
  const parsed = parseLeginfoBillId(url);
  if (!parsed) return failure(`not a leginfo bill URL: ${url}`);
  const { billId, sessionYear } = parsed;
  const key = `${resolve(opts.cacheDir)}|${sessionYear}`;

  try {
    let rebuild = Boolean(opts.refresh) && !refreshedThisRun.has(key);
    for (let attempt = 0; ; attempt++) {
      const archive = await open(sessionYear, opts, rebuild);
      if (rebuild && opts.refresh) refreshedThisRun.add(key);

      const version = latestVersion(archive.versions, billId);
      if (!version) {
        if (attempt === 0 && !builtThisRun.has(key)) {
          rebuild = true; // the cached index may predate the bill
          continue;
        }
        return failure(`bill ${billId} is not in ${VERSION_TABLE} of ${pubinfoUrl(sessionYear)}`);
      }
      try {
        const parts = billXmlParts(decodeUtf8(await archive.zip.read(version.xmlFile)));
        const header = billHeaderText(billId, version.subject?.replace(/\s+/g, " ").trim() || parts.subject, parts.title);
        const history = legislativeHistoryText(await historyFor(archive, sessionYear, opts, billId, rebuild));
        const billText = [parts.digest, parts.sections].filter(Boolean).join("\n\n");
        return { ok: true, text: [header, parts.digest, history, parts.sections].filter(Boolean).join("\n\n"), billText, versionId: version.versionId };
      } catch (e) {
        if (e instanceof ArchiveChangedError && attempt === 0) {
          rebuild = true; // the weekly rebuild moved everything: read the new layout
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    return failure(errorMessage(e));
  }
}
