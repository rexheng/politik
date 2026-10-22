import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  ArchiveChangedError,
  billXmlToText,
  createRangeZipReader,
  latestVersion,
  legislativeHistoryText,
  leginfoBillText,
  loadBillHistories,
  loadBillVersions,
  parseDat,
  parseLegislativeHistory,
  parseLeginfoBillId,
  pubinfoUrl,
  type BillVersion,
} from "../../photon/scripts/snapshot/leginfo.ts";
import { splitPassages } from "../../photon/scripts/snapshot/passages.ts";
import { archiveUrl, billIdOf, billXml, pubinfoZip, wordsOf, type FixtureBill } from "../helpers/pubinfo.ts";
import { buildZip, serveRanges } from "../helpers/zip.ts";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

let tmp: string;
let n = 0;
const nextDir = async () => {
  const dir = join(tmp, `case-${++n}`);
  await mkdir(dir, { recursive: true });
  return dir;
};
before(async () => {
  tmp = await mkdtemp(join(tmpdir(), "politik-leginfo-"));
});
after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------------
// parseLeginfoBillId, pubinfoUrl

test("parseLeginfoBillId reads the bill id and the session's first year from billNavClient and billTextClient URLs", () => {
  assert.deepEqual(parseLeginfoBillId("https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB53"), {
    billId: "202520260SB53",
    sessionYear: "2025",
  });
  assert.deepEqual(parseLeginfoBillId("https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB53"), {
    billId: "202520260SB53",
    sessionYear: "2025",
  });
  assert.deepEqual(parseLeginfoBillId("https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240SB1047"), {
    billId: "202320240SB1047",
    sessionYear: "2023",
  });
});

test("parseLeginfoBillId accepts the www host, a status page, other query parameters and a fragment", () => {
  assert.equal(parseLeginfoBillId("https://www.leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB853")?.billId, "202520260AB853");
  assert.equal(parseLeginfoBillId("https://leginfo.legislature.ca.gov/faces/billStatusClient.xhtml?bill_id=202520260AB1018")?.billId, "202520260AB1018");
  assert.equal(
    parseLeginfoBillId("https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?lang=en&bill_id=202520260SB53&utm=x#top")?.billId,
    "202520260SB53",
  );
});

test("parseLeginfoBillId returns null for other sites, for leginfo pages with no bill, and for anything that is not a bill id", () => {
  for (const url of [
    "https://example.test/faces/billNavClient.xhtml?bill_id=202520260SB53",
    "https://leginfo.legislature.ca.gov.evil.test/faces/billNavClient.xhtml?bill_id=202520260SB53",
    "https://notleginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB53",
    "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.100",
    "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml",
    "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=",
    "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=../../etc",
    "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=SB53",
    "ftp://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB53",
    "not a url",
    "",
  ]) {
    assert.equal(parseLeginfoBillId(url), null, url);
  }
});

test("pubinfoUrl names the session archive on the Legislature's download site", () => {
  assert.equal(pubinfoUrl("2025"), "https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip");
  assert.equal(pubinfoUrl("2023"), "https://downloads.leginfo.legislature.ca.gov/pubinfo_2023.zip");
});

// ---------------------------------------------------------------------------------------------------------------------
// The range-reading zip reader

const URL25 = "https://example.test/pubinfo_2025.zip";
const stored = "stored entry bytes, kept as they are. ".repeat(10);
const deflated = Array.from({ length: 400 }, (_, i) => `line ${i} of a deflated entry`).join("\n");

const sampleZip = (options = {}) =>
  buildZip(
    [
      { name: "STORED.txt", data: stored, method: 0 },
      { name: "data/Deflated.DAT", data: deflated, method: 8 },
      { name: "weird.bin", data: "bzip2-ish", method: 12 },
    ],
    options,
  );

test("the zip reader lists the entries and reads a stored and a deflated one, with a 2 KB archive comment", async () => {
  const server = serveRanges({ [URL25]: sampleZip({ comment: "c".repeat(2048) }) });
  const zip = await createRangeZipReader(URL25, server.fetch);
  assert.deepEqual(zip.names(), ["STORED.txt", "data/Deflated.DAT", "weird.bin"]);
  assert.equal(decode(await zip.read("STORED.txt")), stored);
  assert.equal(decode(await zip.read("data/Deflated.DAT")), deflated);
});

test("the zip reader finds the end record behind the longest archive comment, 65,535 bytes", async () => {
  const server = serveRanges({ [URL25]: sampleZip({ comment: "c".repeat(65535) }) });
  const zip = await createRangeZipReader(URL25, server.fetch);
  assert.equal(decode(await zip.read("STORED.txt")), stored);
});

test("entry names match case-insensitively by basename", async () => {
  const server = serveRanges({ [URL25]: sampleZip() });
  const zip = await createRangeZipReader(URL25, server.fetch);
  assert.equal(decode(await zip.read("deflated.dat")), deflated);
  assert.equal(decode(await zip.read("sub/Stored.TXT")), stored);
  await assert.rejects(() => zip.read("missing.dat"), /missing\.dat/);
});

test("an entry with an unknown compression method throws, naming the method", async () => {
  const server = serveRanges({ [URL25]: sampleZip() });
  const zip = await createRangeZipReader(URL25, server.fetch);
  await assert.rejects(() => zip.read("weird.bin"), /compression method 12/);
});

test("a local header's own extra field is skipped when finding the data", async () => {
  const zipBytes = buildZip([{ name: "a.txt", data: "after the extra field", method: 0, localExtra: new Uint8Array(23).fill(7) }]);
  const server = serveRanges({ [URL25]: zipBytes });
  const zip = await createRangeZipReader(URL25, server.fetch);
  assert.equal(decode(await zip.read("a.txt")), "after the extra field");
});

test("ZIP64 archives are read: an end record with 0xFFFF entries, and 0xFFFFFFFF sizes and offsets in the entries", async () => {
  for (const zip64 of ["eocd", "full"] as const) {
    const server = serveRanges({ [URL25]: sampleZip({ zip64, comment: "zip64 archive" }) });
    const zip = await createRangeZipReader(URL25, server.fetch);
    assert.equal(zip.names().length, 3, zip64);
    assert.equal(decode(await zip.read("data/Deflated.DAT")), deflated, zip64);
    assert.equal(decode(await zip.read("STORED.txt")), stored, zip64);
  }
});

test("an archive with more than 65,535 entries is read in one ranged request for its directory, like the real pubinfo archives", async () => {
  const entries = Array.from({ length: 66_000 }, (_, i) => ({ name: `BILL_VERSION_TBL_${i}.lob`, data: `entry ${i}`, method: 0 }));
  const zipBytes = buildZip(entries, { zip64: "eocd" });
  const server = serveRanges({ [URL25]: zipBytes });
  const zip = await createRangeZipReader(URL25, server.fetch, { keep: (name) => /_(?:0|65999|12345)\.lob$/.test(name) });
  assert.deepEqual(zip.names(), ["BILL_VERSION_TBL_0.lob", "BILL_VERSION_TBL_12345.lob", "BILL_VERSION_TBL_65999.lob"]);
  assert.equal(decode(await zip.read("BILL_VERSION_TBL_65999.lob")), "entry 65999");
  const directoryReads = server.requests.filter((r) => r.bytes > 1_000_000);
  assert.equal(directoryReads.length, 1, JSON.stringify(server.requests.map((r) => [r.range, r.bytes])));
  assert.ok(server.bytesServed() < zipBytes.length, "not the whole archive");
});

test("the zip reader only ever asks for byte ranges, and never the whole archive", async () => {
  const filler = randomBytes(400_000); // incompressible: the archive stays big
  const zipBytes = buildZip([
    { name: "filler.lob", data: filler },
    { name: "wanted.txt", data: "the one entry we read" },
    { name: "filler2.lob", data: randomBytes(300_000) },
  ]);
  assert.ok(zipBytes.length > 700_000);
  const server = serveRanges({ [URL25]: zipBytes });
  const zip = await createRangeZipReader(URL25, server.fetch);
  assert.equal(decode(await zip.read("wanted.txt")), "the one entry we read");
  assert.ok(server.requests.length >= 3);
  for (const r of server.requests) {
    assert.ok(r.range !== null && /^bytes=/.test(r.range), `request without a Range: ${JSON.stringify(r)}`);
    assert.equal(r.status, 206);
    assert.equal(r.acceptEncoding, "identity", "so a range counts the archive's own bytes");
  }
  assert.ok(server.bytesServed() < 5_000, `served ${server.bytesServed()} bytes of ${zipBytes.length}`);
});

test("a server that ignores Range is refused instead of downloaded", async () => {
  const server = serveRanges({ [URL25]: sampleZip() }, { ignoreRange: true });
  await assert.rejects(() => createRangeZipReader(URL25, server.fetch), /ignored the Range header/);
});

test("an HTTP error, and a file that is not a zip, are reported", async () => {
  const server = serveRanges({ "https://example.test/not-a-zip": new TextEncoder().encode("hello, this is not a zip file at all".repeat(10)) });
  await assert.rejects(() => createRangeZipReader("https://example.test/missing.zip", server.fetch), /404/);
  await assert.rejects(() => createRangeZipReader("https://example.test/not-a-zip", server.fetch), /not a zip/i);
});

test("a corrupted entry fails its checksum", async () => {
  const bytes = sampleZip();
  bytes[30 + "STORED.txt".length + 3] ^= 0xff; // inside the first entry's data
  const server = serveRanges({ [URL25]: bytes });
  const zip = await createRangeZipReader(URL25, server.fetch);
  await assert.rejects(() => zip.read("STORED.txt"), /checksum/i);
});

test("an archive that changes after its directory was read is reported as changed", async () => {
  const server = serveRanges({ [URL25]: sampleZip() });
  const zip = await createRangeZipReader(URL25, server.fetch);
  server.files.set(URL25, sampleZip({ comment: "the weekly rebuild" }));
  await assert.rejects(() => zip.read("STORED.txt"), (e: unknown) => e instanceof ArchiveChangedError);
});

test("a saved directory is reused without reading the archive's tail, and still notices a changed archive", async () => {
  const server = serveRanges({ [URL25]: sampleZip() });
  const first = await createRangeZipReader(URL25, server.fetch);
  const saved = JSON.parse(JSON.stringify(first.directory()));

  const again = serveRanges({ [URL25]: sampleZip() });
  const reused = await createRangeZipReader(URL25, again.fetch, { directory: saved });
  assert.equal(again.requests.length, 0, "no request just to open the archive");
  assert.deepEqual(reused.names(), first.names());
  assert.equal(decode(await reused.read("data/Deflated.DAT")), deflated);
  assert.equal(again.requests.length, 2, "one request for the local header, one for the data");

  again.files.set(URL25, sampleZip({ comment: "changed" }));
  await assert.rejects(() => reused.read("STORED.txt"), (e: unknown) => e instanceof ArchiveChangedError);
});

test("the keep filter leaves other entries out of the directory", async () => {
  const server = serveRanges({ [URL25]: sampleZip() });
  const zip = await createRangeZipReader(URL25, server.fetch, { keep: (name) => /\.dat$/i.test(name) });
  assert.deepEqual(zip.names(), ["data/Deflated.DAT"]);
  await assert.rejects(() => zip.read("STORED.txt"), /STORED\.txt/);
});

// ---------------------------------------------------------------------------------------------------------------------
// The .dat format and the bill-version table

test("parseDat: backticks, NULL, a tab inside backticks and a newline inside backticks", () => {
  const rows = parseDat("`a`\t`b c`\tNULL\t5\n`x\ty`\t`line one\nline two`\t7\n");
  assert.deepEqual(rows, [
    ["a", "b c", null, "5"],
    ["x\ty", "line one\nline two", "7"],
  ]);
});

test("parseDat: a quoted NULL is text, a doubled backtick is one, an empty field is empty, and the last row needs no newline", () => {
  assert.deepEqual(parseDat("`NULL`\t`a``b`\t\tNULL"), [["NULL", "a`b", "", null]]);
  assert.deepEqual(parseDat(""), []);
  assert.deepEqual(parseDat("1\n2\n"), [["1"], ["2"]]);
});

const realRows = [
  "`20230SB104788ENR`\t`202320240SB1047`\t88\t2024-09-03 00:00:00\t`Enrolled`\tNULL\t`Safe and Secure Innovation for Frontier Artificial Intelligence Models Act.`\t`Majority`\t`No`\t`Yes`\t`No`\tNULL\t`No`\t`No`\tBILL_VERSION_TBL_19202.lob\t`Y`\t`LEG_ESI`\t2024-09-03 20:08:24",
  "`20230SB104799INT`\t`202320240SB1047`\t99\t2024-02-07 00:00:00\t`Introduced`\tNULL\tNULL\tNULL\tNULL\t`No`\tNULL\tNULL\tNULL\tNULL\tBILL_VERSION_TBL_11271.lob\t`Y`\t`LEG_ESI`\t2024-02-07 10:00:00",
].join("\n");

test("loadBillVersions maps the 18 columns of BILL_VERSION_TBL.dat (as the pubinfo load script names them) to versions", async () => {
  const zipBytes = buildZip([{ name: "BILL_VERSION_TBL.dat", data: `${realRows}\n` }]);
  const zip = await createRangeZipReader(URL25, serveRanges({ [URL25]: zipBytes }).fetch);
  assert.deepEqual(await loadBillVersions(zip), [
    {
      versionId: "20230SB104788ENR",
      billId: "202320240SB1047",
      versionNum: "88",
      actionDate: "2024-09-03 00:00:00",
      action: "Enrolled",
      subject: "Safe and Secure Innovation for Frontier Artificial Intelligence Models Act.",
      xmlFile: "BILL_VERSION_TBL_19202.lob",
    },
    {
      versionId: "20230SB104799INT",
      billId: "202320240SB1047",
      versionNum: "99",
      actionDate: "2024-02-07 00:00:00",
      action: "Introduced",
      subject: "", // NULL in the table
      xmlFile: "BILL_VERSION_TBL_11271.lob",
    },
  ]);
});

test("loadBillVersions skips rows with no XML file or too few columns, and refuses a table it cannot read at all", async () => {
  const noLob = realRows.split("\n")[0]!.replace("BILL_VERSION_TBL_19202.lob", "NULL");
  const short = "`only`\t`three`\t`columns`";
  const mixed = buildZip([{ name: "BILL_VERSION_TBL.dat", data: `${noLob}\n${short}\n${realRows.split("\n")[1]}\n` }]);
  const zip = await createRangeZipReader(URL25, serveRanges({ [URL25]: mixed }).fetch);
  assert.deepEqual((await loadBillVersions(zip)).map((v) => v.versionId), ["20230SB104799INT"]);

  const junk = buildZip([{ name: "BILL_VERSION_TBL.dat", data: `${short}\n${short}\n` }]);
  const junkZip = await createRangeZipReader(URL25, serveRanges({ [URL25]: junk }).fetch);
  await assert.rejects(() => loadBillVersions(junkZip), /BILL_VERSION_TBL\.dat/);

  const none = buildZip([{ name: "OTHER.dat", data: "x" }]);
  const noneZip = await createRangeZipReader(URL25, serveRanges({ [URL25]: none }).fetch);
  await assert.rejects(() => loadBillVersions(noneZip), /BILL_VERSION_TBL\.dat/);
});

// ---------------------------------------------------------------------------------------------------------------------
// BILL_HISTORY_TBL and BILL_TBL: what happened to a bill, and where it stands

const SB1047 = "202320240SB1047";
const SB53_ID = "202520260SB53";
// Real rows (shortened), in the file's order, which is not date order. A bill's rows are spread through the file.
const historyDat = [
  `\`${SB1047}\`\t118209100\t2024-09-29 00:00:00\t\`In Senate.  Consideration of Governor's veto pending.\`\t\`LEG_ESI\`\t2025-01-01 10:00:00\t35\t\`376\`\t\`Applied\`\t\`Senate\`\t\`Floor\`\tNULL\t\`In Floor Process\``,
  `\`${SB1047}\`\t118209001\t2024-02-07 00:00:00\t\`Introduced.  Read first time.  To Com. on RLS. for assignment.  To print.\`\t\`LEG_ESI\`\t2025-01-01 10:00:00\t1\t\`126\`\t\`Applied\`\t\`Senate\`\t\`Rules\`\tNULL\t\`Pending Referral\``,
  `\`202320240AB9\`\t118200000\t2023-01-05 00:00:00\t\`Introduced.\`\t\`LEG_ESI\`\t2025-01-01 10:00:00\t1\t\`126\`\t\`Applied\`\t\`Assembly\`\tNULL\tNULL\t\`Pending Referral\``,
  `\`${SB1047}\`\t118209099\t2024-09-29 00:00:00\t\`Vetoed by the Governor.\`\t\`LEG_ESI\`\t2025-01-01 10:00:00\t34\t\`96\`\t\`Applied\`\t\`Senate\`\t\`Floor\`\tNULL\t\`Vetoed\``,
  `\`${SB53_ID}\`\t118216770\t2025-09-12 00:00:00\t\`Read third time. Passed. (Ayes 59. Noes  7. Page 3432.) Ordered to the Senate.\`\t\`LEG_ESI\`\t2025-12-02 16:22:14\t32\t\`61\`\t\`Rescinded\`\t\`Assembly\`\t\`Floor\`\tNULL\t\`Passed\``,
  `\`${SB53_ID}\`\t118216769\t2025-09-12 00:00:00\t\`Assembly Rule 63 suspended.\`\t\`LEG_ESI\`\t2025-12-02 16:22:14\t32\t\`985\`\t\`Applied\`\t\`Assembly\`\t\`Floor\`\tNULL\t\`In Floor Process\``,
].join("\n");
const billTblDat = [
  `\`${SB1047}\`\t\`20232024\`\t\`0\`\t\`SB\`\t1047\t\`Enrolled\`\tNULL\tNULL\tNULL\tNULL\t\`20230SB104788ENR\`\t\`Y\`\t\`HS_INT\`\t2024-10-09 15:04:38\t\`Unfinished Business\`\t\`Floor\`\t\`Senate\`\t\`In Floor Process\`\t2024-03-09 00:00:00`,
  `\`${SB53_ID}\`\t\`20252026\`\t\`0\`\t\`SB\`\t53\t\`Chaptered\`\t\`2025\`\t\`CHP\`\t\`0\`\t138\t\`20250SB5390CHP\`\t\`Y\`\t\`HS_INT\`\t2025-12-02 16:22:14\tNULL\tNULL\t\`Secretary of State\`\t\`Chaptered\`\t2025-02-07 00:00:00`,
  `\`202320240AB9\`\t\`20232024\`\t\`0\`\t\`AB\`\t9\t\`Introduced\`\tNULL\tNULL\tNULL\tNULL\t\`20230AB999INT\`\t\`Y\`\t\`HS_INT\`\t2025-01-01 00:00:00\tNULL\tNULL\t\`Assembly\`\t\`Died\`\t2023-01-05 00:00:00`,
].join("\n");

async function historyZip(files: Record<string, string> = { "BILL_HISTORY_TBL.dat": historyDat, "BILL_TBL.dat": billTblDat }) {
  const bytes = buildZip(Object.entries(files).map(([name, data]) => ({ name, data })));
  return createRangeZipReader(URL25, serveRanges({ [URL25]: bytes }).fetch);
}

test("loadBillHistories: the requested bills' actions oldest first, text tidied, status from BILL_TBL.dat", async () => {
  const zip = await historyZip();
  const got = await loadBillHistories(zip, new Set([SB1047, SB53_ID, "202320240SB999"]));
  assert.deepEqual([...got.keys()].sort(), ["202320240SB999", SB1047, SB53_ID].sort());
  assert.deepEqual(got.get(SB1047), {
    status: "In Floor Process",
    actions: [
      { date: "2024-02-07", text: "Introduced. Read first time. To Com. on RLS. for assignment. To print." },
      { date: "2024-09-29", text: "Vetoed by the Governor." },
      { date: "2024-09-29", text: "In Senate. Consideration of Governor's veto pending." },
    ],
  });
  // The same date and sequence number: the lower BILL_HISTORY_ID first. An action that was not applied says so.
  assert.deepEqual(got.get(SB53_ID), {
    status: "Chaptered",
    actions: [
      { date: "2025-09-12", text: "Assembly Rule 63 suspended." },
      { date: "2025-09-12", text: "Read third time. Passed. (Ayes 59. Noes 7. Page 3432.) Ordered to the Senate. [Rescinded]" },
    ],
  });
  assert.deepEqual(got.get("202320240SB999"), { status: null, actions: [] }, "no rows is not an error");
});

test("loadBillHistories with 'all' keeps every bill, and a table it cannot read at all is refused", async () => {
  const all = await loadBillHistories(await historyZip(), "all");
  assert.deepEqual([...all.keys()].sort(), ["202320240AB9", SB1047, SB53_ID].sort());
  assert.deepEqual(all.get("202320240AB9"), { status: "Died", actions: [{ date: "2023-01-05", text: "Introduced." }] });

  const junk = await historyZip({ "BILL_HISTORY_TBL.dat": "`a`\t`b`\n`c`\t`d`\n", "BILL_TBL.dat": billTblDat });
  await assert.rejects(() => loadBillHistories(junk, new Set([SB1047])), /BILL_HISTORY_TBL\.dat/);
  const noTable = await historyZip({ "BILL_HISTORY_TBL.dat": historyDat });
  await assert.rejects(() => loadBillHistories(noTable, new Set([SB1047])), /BILL_TBL\.dat/);
  const empty = await historyZip({ "BILL_HISTORY_TBL.dat": "", "BILL_TBL.dat": "" });
  assert.deepEqual((await loadBillHistories(empty, new Set([SB1047]))).get(SB1047), { status: null, actions: [] });
});

test("legislativeHistoryText: a heading, one dated line per action, then the current status", () => {
  assert.equal(
    legislativeHistoryText({
      status: "In Committee Process",
      actions: [
        { date: "2024-02-07", text: "Introduced." },
        { date: "2024-03-05", text: "Set for hearing April 2." },
      ],
    }),
    "# Legislative history\n\n2024-02-07 \u2014 Introduced.\n\n2024-03-05 \u2014 Set for hearing April 2.\n\nCurrent status: In Committee Process",
  );
  assert.equal(legislativeHistoryText({ status: null, actions: [{ date: "2024-02-07", text: "Introduced." }] }), "# Legislative history\n\n2024-02-07 \u2014 Introduced.");
  assert.equal(legislativeHistoryText({ status: "Died", actions: [] }), "# Legislative history\n\nCurrent status: Died");
  assert.equal(legislativeHistoryText({ status: null, actions: [] }), "");
  assert.equal(legislativeHistoryText(undefined), "");
});

test("T8: parseLegislativeHistory is the inverse of legislativeHistoryText: the same dates and actions", () => {
  const actions = [
    { date: "2025-01-07", text: "Introduced. Read first time. To Com. on RLS. for assignment. To print." },
    { date: "2025-05-28", text: "Read third time. Passed. (Ayes 37. Noes 0. Page 1281.) Ordered to the Assembly." },
    { date: "2025-09-29", text: "Chaptered by Secretary of State. Chapter 138, Statutes of 2025." },
  ];
  assert.deepEqual(
    parseLegislativeHistory(legislativeHistoryText({ status: "Chaptered", actions })),
    actions.map((a) => ({ date: a.date, action: a.text })),
  );
  const moving = legislativeHistoryText({ status: "In Committee Process", actions: actions.slice(0, 1) });
  assert.ok(moving.includes("Current status: In Committee Process"));
  assert.deepEqual(parseLegislativeHistory(moving), [{ date: actions[0]!.date, action: actions[0]!.text }], "the status line is not an action");
});

test("T8: parseLegislativeHistory keeps an action as written (a double space too), and reads it from anywhere in a bill's text", () => {
  const history = { status: null, actions: [{ date: "2024-02-07", text: "Referred to  Com. on  JUD." }, { date: "2024-02-07", text: "Set for hearing [Canceled at request of author]." }] };
  const billText = ["# Bill: SB 1 (2023-2024) \u2014 Subject.", "An act.", "# Legislative Counsel's Digest", "Digest text.", legislativeHistoryText(history), "# SECTION 1.", "2024-03-01 \u2014 Not an action: it is in a section.", "Text."].join("\n\n");
  assert.deepEqual(parseLegislativeHistory(billText), [
    { date: "2024-02-07", action: "Referred to  Com. on  JUD." },
    { date: "2024-02-07", action: "Set for hearing [Canceled at request of author]." },
  ]);
  // the layout before R23 put the history first
  assert.deepEqual(parseLegislativeHistory(`${legislativeHistoryText(history)}\n\n# Legislative Counsel's Digest\n\nDigest.`).length, 2);
});

test("T8: parseLegislativeHistory of a text with no history section is empty", () => {
  assert.deepEqual(parseLegislativeHistory(""), []);
  assert.deepEqual(parseLegislativeHistory("# Legislative Counsel's Digest\n\n2024-02-07 \u2014 not under the history heading."), []);
  assert.deepEqual(parseLegislativeHistory("# Legislative history\n\nCurrent status: Died"), []);
});

test("legislativeHistoryText leaves out the current status once the history has a veto or a chaptering (R22)", () => {
  const introduced = { date: "2024-02-07", text: "Introduced." };
  // BILL_TBL says "In Floor Process" for a bill whose veto the Legislature has not yet dealt with, which would mislead.
  assert.equal(
    legislativeHistoryText({
      status: "In Floor Process",
      actions: [introduced, { date: "2024-09-29", text: "Vetoed by the Governor." }, { date: "2024-09-29", text: "In Senate. Consideration of Governor's veto pending." }],
    }),
    "# Legislative history\n\n2024-02-07 \u2014 Introduced.\n\n2024-09-29 \u2014 Vetoed by the Governor.\n\n2024-09-29 \u2014 In Senate. Consideration of Governor's veto pending.",
  );
  assert.equal(
    legislativeHistoryText({ status: "Chaptered", actions: [introduced, { date: "2025-09-29", text: "Chaptered by Secretary of State. Chapter 138, Statutes of 2025." }] }),
    "# Legislative history\n\n2024-02-07 \u2014 Introduced.\n\n2025-09-29 \u2014 Chaptered by Secretary of State. Chapter 138, Statutes of 2025.",
  );
  // Whatever the case, and the wording the Legislature used in other years.
  for (const text of ["VETOED BY GOVERNOR.", "Vetoed by Governor.", "Chaptered by Secretary of State - Chapter 800, Statutes of 2023.", "chaptered by secretary of state."]) {
    assert.ok(!legislativeHistoryText({ status: "Passed", actions: [introduced, { date: "2024-09-29", text }] }).includes("Current status"), text);
  }
  // Other actions that mention the Governor, or a veto, do not decide anything.
  for (const text of ["Enrolled and presented to the Governor at 2 p.m.", "Approved by the Governor.", "In Senate. Consideration of Governor's veto pending.", "Veto sustained."]) {
    assert.ok(legislativeHistoryText({ status: "Passed", actions: [introduced, { date: "2024-09-29", text }] }).endsWith("Current status: Passed"), text);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// latestVersion

const ver = (versionId: string, versionNum: string, date: string, action: string, billId = "202520260SB53"): BillVersion => ({
  versionId,
  billId,
  versionNum,
  actionDate: `${date} 00:00:00`,
  action,
  xmlFile: `BILL_VERSION_TBL_${versionNum}.lob`,
});

test("latestVersion picks the newest action date", () => {
  const versions = [
    ver("20250SB5399INT", "99", "2025-01-07", "Introduced"),
    ver("20250SB5390CHP", "90", "2025-09-29", "Chaptered"),
    ver("20250SB5395AMD", "95", "2025-07-08", "Amended Assembly"),
    ver("20250SB5391ENR", "91", "2025-09-17", "Enrolled"),
  ];
  assert.equal(latestVersion(versions, "202520260SB53")?.versionId, "20250SB5390CHP");
  assert.equal(latestVersion([...versions].reverse(), "202520260SB53")?.versionId, "20250SB5390CHP");
});

test("latestVersion breaks a date tie by the most advanced stage: chaptered, enrolled, amended, introduced", () => {
  const day = "2025-09-29";
  // The version numbers here run the opposite way to the real ones (which fall as a bill advances), so only the stage can pick the winner.
  const all = [
    ver("20250SB5390INT", "90", day, "Introduced"),
    ver("20250SB5391AMD", "91", day, "Amended Senate"),
    ver("20250SB5392ENR", "92", day, "Enrolled"),
    ver("20250SB5393CHP", "93", day, "Chaptered"),
  ];
  const pick = (...ids: string[]) => latestVersion(all.filter((v) => ids.includes(v.versionId)), "202520260SB53")?.versionId;
  assert.equal(pick("20250SB5390INT", "20250SB5391AMD", "20250SB5392ENR", "20250SB5393CHP"), "20250SB5393CHP");
  assert.equal(pick("20250SB5390INT", "20250SB5391AMD", "20250SB5392ENR"), "20250SB5392ENR");
  assert.equal(pick("20250SB5390INT", "20250SB5391AMD"), "20250SB5391AMD");
  assert.equal(pick("20250SB5390INT"), "20250SB5390INT");
  // The order the rows come in does not matter.
  assert.equal(latestVersion([...all].reverse(), "202520260SB53")?.versionId, "20250SB5393CHP");
});

test("latestVersion reads the stage from the version id when the action text is not one it knows", () => {
  const day = "2025-09-29";
  const versions = [ver("20250SB5392ENR", "92", day, "Something New"), ver("20250SB5391AMD", "91", day, "Something Else")];
  assert.equal(latestVersion(versions, "202520260SB53")?.versionId, "20250SB5392ENR");
});

test("latestVersion breaks a tie on date and stage by the lower version number, which is the later version", () => {
  const day = "2025-05-01";
  const versions = [ver("20250SB5398AMD", "98", day, "Amended Senate"), ver("20250SB5397AMD", "97", day, "Amended Senate")];
  assert.equal(latestVersion(versions, "202520260SB53")?.versionId, "20250SB5397AMD");
});

test("latestVersion only looks at the bill asked for, and returns null when it has no versions", () => {
  const versions = [
    ver("20250SB5390CHP", "90", "2025-09-29", "Chaptered"),
    ver("20250SB5499INT", "99", "2026-01-01", "Introduced", "202520260SB54"),
  ];
  assert.equal(latestVersion(versions, "202520260SB54")?.versionId, "20250SB5499INT");
  assert.equal(latestVersion(versions, "202520260SB999"), null);
  assert.equal(latestVersion([], "202520260SB53"), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// billXmlToText

const sampleXml =
  `<?xml version="1.0" encoding="UTF-8"?><caml:MeasureDoc version="1.0" xmlns:caml="http://lc.ca.gov/legalservices/schemas/caml.1#" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">\n` +
  `<!-- Copyright © Legislative Counsel Bureau, State of California. -->\n` +
  `<caml:Description xmlns="http://www.w3.org/1999/xhtml"><caml:Id>20250AB101892AMD</caml:Id><caml:VersionNum>92</caml:VersionNum>` +
  `<caml:History><caml:Action><caml:ActionText>INTRODUCED</caml:ActionText><caml:ActionDate>2025-02-20</caml:ActionDate></caml:Action></caml:History>` +
  `<caml:Title> An act to add Chapter 24.6 (commencing with Section 22756) to Division 8 of the Business and Professions Code, relating to artificial intelligence. </caml:Title>` +
  `<caml:RelatingClause>artificial intelligence</caml:RelatingClause><caml:GeneralSubject><caml:Subject>Automated decision systems.</caml:Subject></caml:GeneralSubject>` +
  `<caml:DigestText><p>(1)<span class="EnSpace"/>Existing law regulates &quot;automated&quot; tools.</p>` +
  `<xhtml:p>This bill would enact the Automated Decisions Safety Act.</xhtml:p>` +
  `<p>Existing law sets a date of<?xm-deletion_mark data=" January 31"?><?xm-insertion_mark_start?> February 15<?xm-insertion_mark_end?>.</p></caml:DigestText>` +
  `<caml:DigestKey><caml:VoteRequired>MAJORITY</caml:VoteRequired><caml:Appropriation>NO</caml:Appropriation></caml:DigestKey></caml:Description>` +
  `<caml:Bill id="bill" xmlns="http://www.w3.org/1999/xhtml"><caml:Preamble>The people of the State of California do enact as follows:</caml:Preamble>` +
  `<caml:BillSection id="id_1"><caml:Num>SECTION 1.</caml:Num>` +
  `<caml:ActionLine action="IS_ADDED" xlink:href="urn:caml:codes:BPC:caml#xpointer(%2Fcaml%3ALawDoc%2Fcaml%3ALawHeading%5B%40type%3D'DIVISION'%20and%20caml%3ANum%3D'8.'%5D)" xlink:label="fractionType: LAW_SPREAD||commencingWith: 22756" xlink:type="locator">Chapter 24.6 (commencing with Section 22756) is added to Division 8 of the <caml:DocName>Business and Professions Code</caml:DocName>, to read:</caml:ActionLine>` +
  `<caml:Fragment><caml:LawHeading id="id_h" type="CHAPTER"><caml:Num>24.6.</caml:Num><caml:LawHeadingVersion id="id_hv"><caml:LawHeadingText>Automated Decisions Safety Act</caml:LawHeadingText></caml:LawHeadingVersion>` +
  `<caml:LawSection id="id_s"><caml:Num>22756.</caml:Num><caml:LawSectionVersion id="id_sv"><caml:Content>` +
  `<p>As used in this chapter:</p><p>(a)<span class="EnSpace"/>“Adverse outcome” means a decision &lt; 5 days &amp; more.</p>` +
  `<p>(b)<span class="EnSpace"/>A word  spread\n\t\t over   lines.</p></caml:Content></caml:LawSectionVersion></caml:LawSection></caml:LawHeading></caml:Fragment></caml:BillSection>` +
  `<caml:BillSection id="id_2"><caml:Num><?xm-insertion_mark_start?>SEC. 2.<?xm-insertion_mark_end?></caml:Num><caml:Content>` +
  `<p>This act takes effect on<?xm-deletion_mark data=" July 1"?><?xm-insertion_mark_start?> January 1<?xm-insertion_mark_end?>, 2027.</p></caml:Content></caml:BillSection>` +
  `</caml:Bill></caml:MeasureDoc>`;

test("billXmlToText starts with the Legislative Counsel's Digest, then gives the bill with its sections as headings", () => {
  const text = billXmlToText(sampleXml);
  assert.ok(text.startsWith("# Legislative Counsel's Digest\n\n"), text.slice(0, 80));
  const order = ["# Legislative Counsel's Digest", "Automated decision systems.", "# SECTION 1.", "# SEC. 2."].map((s) => text.indexOf(s));
  assert.ok(order.every((i) => i >= 0), `${order} in\n${text}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in document order");
  assert.deepEqual(
    text.split("\n").filter((l) => l.startsWith("# ")),
    ["# Legislative Counsel's Digest", "# SECTION 1.", "# SEC. 2."],
  );
});

test("billXmlToText: tags go, entities are decoded, spacing marks become spaces and paragraphs stay apart", () => {
  const text = billXmlToText(sampleXml);
  assert.equal(
    text,
    [
      "# Legislative Counsel's Digest",
      "Automated decision systems.",
      '(1) Existing law regulates "automated" tools.',
      "This bill would enact the Automated Decisions Safety Act.",
      "Existing law sets a date of February 15.",
      "# SECTION 1.",
      "Chapter 24.6 (commencing with Section 22756) is added to Division 8 of the Business and Professions Code, to read:",
      "CHAPTER 24.6. Automated Decisions Safety Act",
      "22756.",
      "As used in this chapter:",
      "(a) “Adverse outcome” means a decision < 5 days & more.",
      "(b) A word spread over lines.",
      "# SEC. 2.",
      "This act takes effect on January 1, 2027.",
    ].join("\n\n"),
  );
  assert.ok(!/<\/?[a-z?!]/i.test(text), "no markup left");
});

test("billXmlToText leaves out deleted text and keeps inserted text, so it reads as the bill would", () => {
  const text = billXmlToText(sampleXml);
  assert.ok(!text.includes("January 31") && !text.includes("July 1"));
  assert.ok(text.includes("February 15") && text.includes("January 1, 2027"));
});

test("billXmlToText with no digest starts with the first section, and with no bill gives nothing", () => {
  const noDigest = billXml({ subject: "S.", digest: [], sections: [{ num: "SECTION 1.", paragraphs: ["Only a section."] }] }).replace(/<caml:DigestText>[\s\S]*<\/caml:DigestText>/, "");
  assert.equal(billXmlToText(noDigest), "# SECTION 1.\n\nOnly a section.");
  assert.equal(billXmlToText("<caml:MeasureDoc></caml:MeasureDoc>"), "");
  assert.equal(billXmlToText(""), "");
  assert.equal(billXmlToText("this is not xml <b>at</b> all"), "");
});

// ---------------------------------------------------------------------------------------------------------------------
// leginfoBillText

const sb53 = (versions = [{ stage: "INT", versionNum: 99, date: "2025-01-07", body: `Introduced text ${wordsOf(30, "intro")}` }, { stage: "CHP", versionNum: 90, date: "2025-09-29", body: `Chaptered text ${wordsOf(30, "chap")}` }]): FixtureBill =>
  ({ session: "202520260", type: "SB", num: 53, versions: versions as FixtureBill["versions"], subject: "Artificial intelligence models: large developers." });
const sb1 = (): FixtureBill => ({
  session: "202520260",
  type: "SB",
  num: 1,
  versions: [
    { stage: "INT", versionNum: 99, date: "2025-01-02", body: "SB one introduced" },
    { stage: "AMD", versionNum: 98, date: "2025-03-02", body: "SB one amended" },
  ],
});
const NAV53 = "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB53";
const NAV1 = "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB1";

test("leginfoBillText returns the newest version's text, and caches the version index and the directory per session", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53(), sb1()]).zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.versionId, "20250SB5390CHP");
  assert.ok(
    result.text.startsWith(
      "# Bill: SB 53 (2025-2026) \u2014 Artificial intelligence models: large developers.\n\nAn act relating to fixtures.\n\n# Legislative Counsel's Digest\n\nArtificial intelligence models: large developers.",
    ),
    result.text.slice(0, 260),
  );
  assert.ok(result.text.includes("Chaptered text chap0 chap1") && !result.text.includes("Introduced text"));
  assert.ok(result.text.includes("# SECTION 1."));

  const versions = JSON.parse(await readFile(join(cacheDir, "leginfo", "2025-versions.json"), "utf8"));
  assert.ok(JSON.stringify(versions).includes("20250SB5390CHP") && JSON.stringify(versions).includes("202520260SB1"));
  assert.ok(existsSync(join(cacheDir, "leginfo", "2025-directory.json")));
  for (const r of server.requests) assert.ok(r.range?.startsWith("bytes="), "only ranges are requested");
});

test("a second bill of the same session reads only its own XML: no directory, no version table, no history table", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53(), sb1()]).zip });
  const historyBills = ["202520260SB53", "202520260SB1"];
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch, historyBills });
  const before = server.requests.length;

  const second = await leginfoBillText(NAV1, { cacheDir, fetchImpl: server.fetch, historyBills });
  assert.ok(second.ok && second.versionId === "20250SB198AMD", JSON.stringify(second));
  assert.ok(second.ok && second.text.includes("SB one amended"));
  assert.equal(server.requests.length - before, 2, "a local header and the data");
});

test("the 2023 session's bills come from the 2023 archive", async () => {
  const cacheDir = await nextDir();
  const bill: FixtureBill = { session: "202320240", type: "SB", num: 1047, versions: [{ stage: "ENR", versionNum: 88, date: "2024-09-03", body: "Vetoed bill text" }] };
  const server = serveRanges({ [archiveUrl("2023")]: pubinfoZip([bill]).zip });
  const result = await leginfoBillText("https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240SB1047", { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok && result.versionId === "20230SB104788ENR" && result.text.includes("Vetoed bill text"), JSON.stringify(result));
  assert.ok(existsSync(join(cacheDir, "leginfo", "2023-versions.json")));
  assert.ok(server.requests.every((r) => r.url === archiveUrl("2023")));
});

test("a bill that is not in the version table fails with 'loading failed' and says which bill", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  const result = await leginfoBillText("https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB999", { cacheDir, fetchImpl: server.fetch });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "loading failed" && /202520260SB999/.test(result.detail), JSON.stringify(result));
});

test("an archive that cannot be reached, and a URL that is not a bill, fail with 'loading failed' and a detail", async () => {
  const cacheDir = await nextDir();
  const empty = serveRanges({});
  const gone = await leginfoBillText(NAV53, { cacheDir, fetchImpl: empty.fetch });
  assert.ok(!gone.ok && gone.reason === "loading failed" && /404/.test(gone.detail), JSON.stringify(gone));

  const boom = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const down = await leginfoBillText(NAV53, { cacheDir, fetchImpl: boom });
  assert.ok(!down.ok && down.reason === "loading failed" && /fetch failed/.test(down.detail), JSON.stringify(down));

  const notBill = await leginfoBillText("https://example.test/x", { cacheDir, fetchImpl: empty.fetch });
  assert.ok(!notBill.ok && notBill.reason === "loading failed" && notBill.detail.length > 0);
});

test("when the archive is rebuilt, the cached directory is dropped and the bill is read from the new archive", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb1(), sb53()]).zip });
  const first = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(first.ok && first.versionId === "20250SB5390CHP");

  // The weekly rebuild: SB 53 has a newer version, and everything sits at other offsets.
  const rebuilt = sb53([
    { stage: "INT", versionNum: 99, date: "2025-01-07", body: "Introduced text" },
    { stage: "CHP", versionNum: 90, date: "2025-09-29", body: "Chaptered text" },
    { stage: "CHP", versionNum: 89, date: "2026-02-01", body: `Re-chaptered text ${wordsOf(30, "newer")}` },
  ]);
  server.files.set(archiveUrl("2025"), pubinfoZip([rebuilt, sb1()], { comment: "rebuilt" }).zip);

  const second = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(second.ok && second.versionId === "20250SB5389CHP", JSON.stringify(second));
  assert.ok(second.ok && second.text.includes("Re-chaptered text newer0"));
  assert.ok(JSON.stringify(JSON.parse(await readFile(join(cacheDir, "leginfo", "2025-versions.json"), "utf8"))).includes("20250SB5389CHP"));
});

test("refresh reads the version table again, once per run and session, however many bills follow", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53(), sb1()]).zip });
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  const tail = (from: number) => server.requests.slice(from).filter((r) => r.range?.startsWith("bytes=-")).length;

  let mark = server.requests.length;
  await leginfoBillText(NAV1, { cacheDir, fetchImpl: server.fetch });
  assert.equal(tail(mark), 0, "no refresh: the cached directory is used");

  mark = server.requests.length;
  const refreshed = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch, refresh: true });
  assert.ok(refreshed.ok);
  assert.equal(tail(mark), 1, "the first refresh reads the archive's end again");

  mark = server.requests.length;
  await leginfoBillText(NAV1, { cacheDir, fetchImpl: server.fetch, refresh: true });
  assert.equal(tail(mark), 0, "the second bill of the same run reuses what the refresh just read");
});

test("a cache file that is not valid JSON is ignored and rebuilt", async () => {
  const cacheDir = await nextDir();
  await mkdir(join(cacheDir, "leginfo"), { recursive: true });
  await writeFile(join(cacheDir, "leginfo", "2025-versions.json"), "{ not json");
  await writeFile(join(cacheDir, "leginfo", "2025-directory.json"), '{"archive": 5}');
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
});

test("only a few kilobytes are downloaded from an archive that is megabytes long", async () => {
  const cacheDir = await nextDir();
  const big = pubinfoZip([sb53(), sb1()], { fillerBytes: 600_000 });
  const server = serveRanges({ [archiveUrl("2025")]: big.zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok);
  assert.ok(big.zip.length > 600_000);
  assert.ok(server.bytesServed() < 30_000, `served ${server.bytesServed()} of ${big.zip.length} bytes`);
});

// ---------------------------------------------------------------------------------------------------------------------
// The legislative history in front of the bill text

const sb1047 = (): FixtureBill => ({
  session: "202320240",
  type: "SB",
  num: 1047,
  subject: "Safe and Secure Innovation for Frontier Artificial Intelligence Models Act.",
  currentStatus: "Vetoed",
  versions: [
    { stage: "INT", versionNum: 99, date: "2024-02-07", body: "Introduced text" },
    { stage: "ENR", versionNum: 88, date: "2024-09-03", body: `Enrolled text ${wordsOf(30, "frontier")}` },
  ],
  // Out of order on purpose.
  history: [
    { date: "2024-09-29", text: "Vetoed by the Governor.", seq: 34 },
    { date: "2024-02-07", text: "Introduced.  Read first time.  To Com. on RLS. for assignment.  To print.", seq: 1 },
    { date: "2024-09-24", text: "Enrolled and presented to the Governor at  3 p.m.", seq: 33 },
  ],
});
const SB1047_URL = "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240SB1047";

const headingsOf = (text: string) => text.split("\n").filter((l) => l.startsWith("# "));

test("the text is the header, the digest, the legislative history (oldest first), then the bill; a vetoed bill has the veto and no status line (R23)", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2023")]: pubinfoZip([sb1047()]).zip });
  const result = await leginfoBillText(SB1047_URL, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(headingsOf(result.text), [
    "# Bill: SB 1047 (2023-2024) \u2014 Safe and Secure Innovation for Frontier Artificial Intelligence Models Act.",
    "# Legislative Counsel's Digest",
    "# Legislative history",
    "# SECTION 1.",
  ]);
  const history = result.text.slice(result.text.indexOf("# Legislative history"), result.text.indexOf("# SECTION 1."));
  assert.equal(
    history.trim(),
    [
      "# Legislative history",
      "2024-02-07 \u2014 Introduced. Read first time. To Com. on RLS. for assignment. To print.",
      "2024-09-24 \u2014 Enrolled and presented to the Governor at 3 p.m.",
      "2024-09-29 \u2014 Vetoed by the Governor.",
    ].join("\n\n"),
  );
  assert.ok(result.text.indexOf("Vetoed by the Governor.") < result.text.indexOf("Enrolled text frontier0"), "so a model reading the passages can tell that this bill was vetoed");
  assert.ok(!result.text.includes("Current status"), "BILL_TBL's status for this bill (the fixture says Vetoed; the real one often says In Floor Process) is left out");
  assert.ok(result.text.includes("# SECTION 1.") && result.text.includes("Enrolled text frontier0"));
  assert.equal(result.versionId, "20230SB104788ENR");
  assert.ok(result.billText.startsWith("# Legislative Counsel's Digest") && result.text.includes(result.billText.split("\n\n# SECTION 1.")[0]!), "billText is the digest and the sections: no header, no history");
  assert.ok(!result.billText.includes("Legislative history") && !result.billText.includes("# Bill:"));
});

test("a vetoed bill whose status BILL_TBL gives as In Floor Process has the veto line and no status line", async () => {
  const cacheDir = await nextDir();
  const bill: FixtureBill = { ...sb1047(), currentStatus: "In Floor Process" };
  bill.history!.push({ date: "2024-09-29", text: "In Senate.  Consideration of Governor's veto pending.", seq: 35 });
  const server = serveRanges({ [archiveUrl("2023")]: pubinfoZip([bill]).zip });
  const result = await leginfoBillText(SB1047_URL, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  const history = result.text.slice(result.text.indexOf("# Legislative history"), result.text.indexOf("# SECTION 1."));
  assert.ok(history.includes("2024-09-29 — Vetoed by the Governor."));
  assert.ok(history.includes("2024-09-29 — In Senate. Consideration of Governor's veto pending."));
  assert.ok(!result.text.includes("Current status"));
});

test("a chaptered bill has no status line", async () => {
  const cacheDir = await nextDir();
  const bill: FixtureBill = {
    ...sb53(),
    currentStatus: "Chaptered",
    history: [
      { date: "2025-09-29", text: "Chaptered by Secretary of State.  Chapter 138, Statutes of 2025.", seq: 37 },
      { date: "2025-09-29", text: "Approved by the Governor.", seq: 36 },
    ],
  };
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([bill]).zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    result.text.includes(
      ["# Legislative history", "2025-09-29 — Approved by the Governor.", "2025-09-29 — Chaptered by Secretary of State. Chapter 138, Statutes of 2025.", "# SECTION 1."].join("\n\n"),
    ),
    result.text.slice(0, 600),
  );
  assert.ok(!result.text.includes("Current status"));
});

test("a bill that is still moving keeps its status line", async () => {
  const cacheDir = await nextDir();
  const bill: FixtureBill = {
    ...sb53(),
    currentStatus: "In Floor Process",
    history: [
      { date: "2026-08-21", text: "Read second time. Ordered to third reading.", seq: 40 },
      { date: "2025-02-20", text: "Introduced.  Read first time.", seq: 1 },
    ],
  };
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([bill]).zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    result.text.includes(
      ["# Legislative history", "2025-02-20 — Introduced. Read first time.", "2026-08-21 — Read second time. Ordered to third reading.", "Current status: In Floor Process", "# SECTION 1."].join("\n\n"),
    ),
    result.text.slice(0, 600),
  );
});

test("a bill with no history rows gets no history section, and the read goes on", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip }); // sb53() has no history and no status
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(headingsOf(result.text), ["# Bill: SB 53 (2025-2026) \u2014 Artificial intelligence models: large developers.", "# Legislative Counsel's Digest", "# SECTION 1."]);
  assert.ok(!result.text.includes("Legislative history") && !result.text.includes("Current status"));
});

test("a status with no history rows still gets a short history section", async () => {
  const cacheDir = await nextDir();
  const bill = { ...sb53(), currentStatus: "Chaptered" };
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([bill]).zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok && result.text.includes("# Legislative history\n\nCurrent status: Chaptered\n\n# SECTION 1."), result.ok ? result.text.slice(0, 400) : result.detail);
  assert.ok(result.ok && headingsOf(result.text).slice(1, 3).join("|") === "# Legislative Counsel's Digest|# Legislative history");
});

// ---------------------------------------------------------------------------------------------------------------------
// The header in front of the text (R23)

test("the header names the measure type, number, session years and subject, whatever the session", async () => {
  const cacheDir = await nextDir();
  const bill: FixtureBill = {
    session: "202320240",
    type: "AB",
    num: 1008,
    subject: "California Consumer Privacy Act of 2018: personal information.",
    versions: [{ stage: "CHP", versionNum: 93, date: "2024-09-28", body: `Text ${wordsOf(30)}` }],
  };
  const server = serveRanges({ [archiveUrl("2023")]: pubinfoZip([bill]).zip });
  const result = await leginfoBillText("https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240AB1008", { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.text.split("\n")[0], "# Bill: AB 1008 (2023-2024) \u2014 California Consumer Privacy Act of 2018: personal information.");
});

test("the header survives the passage splitter: the first passage's heading is the header and its text is the bill's title", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()]).zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  const [first, second] = splitPassages("ca-sb-53-2025", result.text);
  assert.equal(first!.heading, "Bill: SB 53 (2025-2026) \u2014 Artificial intelligence models: large developers.");
  assert.equal(first!.text, "An act relating to fixtures.", "a header with no line under it would be dropped as an empty section");
  assert.equal(second!.heading, "Legislative Counsel's Digest");
});

test("a table with no subject for the version falls back to the XML's subject, and a bill with neither gets a bare header that still survives", async () => {
  const cacheDir = await nextDir();
  const xml = billXml({ subject: "Subject from the XML.", digest: ["Existing law."], sections: [{ num: "SECTION 1.", paragraphs: [`Body ${wordsOf(30)}`] }] });
  const bill: FixtureBill = { ...sb53(), versions: [{ stage: "CHP", versionNum: 90, date: "2025-09-29", xml }], subject: "" };
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([bill]).zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.text.split("\n")[0], "# Bill: SB 53 (2025-2026) \u2014 Subject from the XML.");

  const bare = billXml({ subject: "", digest: ["Existing law."], sections: [{ num: "SECTION 1.", paragraphs: [`Body ${wordsOf(30)}`] }] }).replace(/<caml:Title>.*?<\/caml:Title>/, "");
  const noSubject: FixtureBill = { ...bill, versions: [{ stage: "CHP", versionNum: 90, date: "2025-09-29", xml: bare }] };
  const bareDir = await nextDir();
  const bareResult = await leginfoBillText(NAV53, { cacheDir: bareDir, fetchImpl: serveRanges({ [archiveUrl("2025")]: pubinfoZip([noSubject]).zip }).fetch });
  assert.ok(bareResult.ok, JSON.stringify(bareResult));
  assert.equal(bareResult.text.split("\n")[0], "# Bill: SB 53 (2025-2026)");
  const [first] = splitPassages("x", bareResult.text);
  assert.ok(first!.heading?.startsWith("Bill: SB 53 (2025-2026)") && first!.text.includes("SB 53"), JSON.stringify(first));
});

test("a version index cached before the subject was kept still gives the header, from the XML's subject", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53(), sb1()]).zip });
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  const path = join(cacheDir, "leginfo", "2025-versions.json");
  const cached = JSON.parse(await readFile(path, "utf8")) as { versions: Record<string, unknown>[] };
  for (const v of cached.versions) delete v.subject;
  await writeFile(path, JSON.stringify(cached));

  const before = server.requests.length;
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok && result.text.split("\n")[0] === "# Bill: SB 53 (2025-2026) \u2014 Artificial intelligence models: large developers.", result.ok ? result.text.slice(0, 160) : result.detail);
  assert.ok(server.requests.length - before <= 3, "the old index was used, not read again");
});

test("identity, summary and status evidence all sit in the first 1,000 words, ahead of the bill's sections", async () => {
  const cacheDir = await nextDir();
  const digest = Array.from({ length: 4 }, (_, i) => `Digest paragraph ${i} ${wordsOf(70, `dg${i}x`)}.`);
  const xml = billXml({ subject: "Artificial intelligence models: large developers.", digest, sections: [{ num: "SECTION 1.", paragraphs: [`Sections begin ${wordsOf(3000, "body")}`] }] });
  const bill: FixtureBill = {
    ...sb53(),
    versions: [{ stage: "CHP", versionNum: 90, date: "2025-09-29", xml }],
    currentStatus: "Chaptered",
    history: Array.from({ length: 25 }, (_, i) => ({ date: `2025-03-${String(i + 1).padStart(2, "0")}`, text: `Referred to Com. on JUD. ${wordsOf(12, `act${i}x`)}` })).concat([
      { date: "2025-09-29", text: "Chaptered by Secretary of State.  Chapter 138, Statutes of 2025." },
    ]),
  };
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([bill]).zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok, JSON.stringify(result));
  const words = result.text.split(/\s+/);
  const at = (needle: string) => words.findIndex((w) => w === needle);
  const first1000 = words.slice(0, 1000).join(" ");
  assert.ok(first1000.includes("SB 53 (2025-2026)"), "identity");
  assert.ok(first1000.includes("Digest paragraph 3 dg3x0"), "the whole digest");
  assert.ok(first1000.includes("Chaptered by Secretary of State. Chapter 138, Statutes of 2025."), "the end of the history, where the status is");
  assert.ok(at("Chaptered") > 0 && at("Chaptered") < at("Sections"), "and the bill's own text comes after all of it");
});

const directoryEntry = async (cacheDir: string, year: string, name: string) => {
  const directory = JSON.parse(await readFile(join(cacheDir, "leginfo", `${year}-directory.json`), "utf8")) as { entries: { name: string; compressedSize: number }[] };
  return directory.entries.find((e) => e.name === name);
};

const withHistory = (bill: FixtureBill, text: string): FixtureBill => ({ ...bill, history: [{ date: "2025-03-01", text }], currentStatus: "In Committee Process" });

test("history and status are read once per session and cached, so a bill named in advance costs only its own XML", async () => {
  const cacheDir = await nextDir();
  const bills = [withHistory(sb53(), "Referred to Com. on JUD."), withHistory(sb1(), "Read first time.")];
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip(bills).zip });
  const historyBills = [billIdOf(bills[0]!), billIdOf(bills[1]!)];

  const first = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch, historyBills });
  assert.ok(first.ok && first.text.includes("2025-03-01 — Referred to Com. on JUD."), JSON.stringify(first).slice(0, 300));
  const cache = JSON.parse(await readFile(join(cacheDir, "leginfo", "2025-history.json"), "utf8"));
  assert.deepEqual(Object.keys(cache.bills).sort(), [...historyBills].sort(), "only the bills asked for are kept");
  assert.ok(cache.archive.size > 0);

  const table = await directoryEntry(cacheDir, "2025", "BILL_HISTORY_TBL.dat");
  assert.ok(table);
  assert.equal(server.requests.filter((r) => r.bytes === table.compressedSize).length, 1, "the history table was read once");

  const before = server.requests.length;
  const second = await leginfoBillText(NAV1, { cacheDir, fetchImpl: server.fetch, historyBills });
  assert.ok(second.ok && second.text.includes("2025-03-01 — Read first time.") && second.text.includes("Current status: In Committee Process"));
  assert.equal(server.requests.length - before, 2, "a local header and the data of the bill's own XML, nothing else");
});

test("without a list of bills in advance, a bill the cache does not cover reads the two tables again, once", async () => {
  const cacheDir = await nextDir();
  const bills = [withHistory(sb53(), "Referred to Com. on JUD."), withHistory(sb1(), "Read first time.")];
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip(bills).zip });
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });

  let mark = server.requests.length;
  const second = await leginfoBillText(NAV1, { cacheDir, fetchImpl: server.fetch });
  assert.ok(second.ok && second.text.includes("Read first time."));
  assert.equal(server.requests.length - mark, 2 + 4, "its own XML, then the history table and BILL_TBL.dat");
  assert.ok(server.requests.slice(mark).every((r) => !r.range?.startsWith("bytes=-")), "the archive's directory is not read again");
  const cache = JSON.parse(await readFile(join(cacheDir, "leginfo", "2025-history.json"), "utf8"));
  assert.equal(Object.keys(cache.bills).length, 2, "the bills read so far are all kept");

  mark = server.requests.length;
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  await leginfoBillText(NAV1, { cacheDir, fetchImpl: server.fetch });
  assert.equal(server.requests.length - mark, 4, "both are covered now: two requests each for the XML");
});

test("historyBills 'all' keeps every bill's history in the cache", async () => {
  const cacheDir = await nextDir();
  const bills = [withHistory(sb53(), "Referred to Com. on JUD."), withHistory(sb1(), "Read first time.")];
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip(bills).zip });
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch, historyBills: "all" });
  const cache = JSON.parse(await readFile(join(cacheDir, "leginfo", "2025-history.json"), "utf8"));
  assert.equal(cache.all, true);
  assert.equal(Object.keys(cache.bills).length, 2);
  const before = server.requests.length;
  await leginfoBillText(NAV1, { cacheDir, fetchImpl: server.fetch, historyBills: "all" });
  assert.equal(server.requests.length - before, 2);
});

test("refresh reads the history tables again, once per run", async () => {
  const cacheDir = await nextDir();
  const bills = [withHistory(sb53(), "Referred to Com. on JUD."), withHistory(sb1(), "Read first time.")];
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip(bills).zip });
  const historyBills = bills.map(billIdOf);
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch, historyBills });
  const table = (await directoryEntry(cacheDir, "2025", "BILL_HISTORY_TBL.dat"))!;
  const reads = (from: number) => server.requests.slice(from).filter((r) => r.bytes === table.compressedSize).length;

  let mark = server.requests.length;
  await leginfoBillText(NAV1, { cacheDir, fetchImpl: server.fetch, historyBills });
  assert.equal(reads(mark), 0);

  mark = server.requests.length;
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch, historyBills, refresh: true });
  assert.equal(reads(mark), 1, "a refresh reads the table again");
  mark = server.requests.length;
  await leginfoBillText(NAV1, { cacheDir, fetchImpl: server.fetch, historyBills, refresh: true });
  assert.equal(reads(mark), 0, "but not for every bill");
});

test("when the archive is rebuilt, the history is read again too, so a later action shows up", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([withHistory(sb53(), "Referred to Com. on JUD.")]).zip });
  const first = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(first.ok && !first.text.includes("Signed"));

  const later: FixtureBill = { ...withHistory(sb53(), "Referred to Com. on JUD."), currentStatus: "Chaptered" };
  later.history!.push({ date: "2025-09-29", text: "Approved by the Governor. Signed." });
  server.files.set(archiveUrl("2025"), pubinfoZip([later], { comment: "rebuilt" }).zip);
  const second = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(second.ok && second.text.includes("2025-09-29 — Approved by the Governor. Signed.") && second.text.includes("Current status: Chaptered"), JSON.stringify(second).slice(0, 300));
});

test("a history cache written for another version of the archive is not used, even when the directory had to be read again anyway", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([withHistory(sb53(), "Referred to Com. on JUD.")]).zip });
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });

  server.files.set(archiveUrl("2025"), pubinfoZip([withHistory(sb53(), "Re-referred to Com. on APPR.")], { comment: "rebuilt" }).zip);
  await rm(join(cacheDir, "leginfo", "2025-directory.json")); // the directory is read again; nothing else tells the history cache that the archive changed
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok && result.text.includes("Re-referred to Com. on APPR.") && !result.text.includes("Referred to Com. on JUD."), JSON.stringify(result).slice(0, 300));
});

test("a cached directory from before the history tables were read is read again, not trusted", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([withHistory(sb53(), "Referred to Com. on JUD.")]).zip });
  await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  const path = join(cacheDir, "leginfo", "2025-directory.json");
  const old = JSON.parse(await readFile(path, "utf8"));
  old.entries = old.entries.filter((e: { name: string }) => !/HISTORY|^BILL_TBL\.dat$/.test(e.name));
  await writeFile(path, JSON.stringify(old));
  await rm(join(cacheDir, "leginfo", "2025-history.json"));

  const before = server.requests.length;
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(result.ok && result.text.includes("Referred to Com. on JUD."), JSON.stringify(result).slice(0, 300));
  assert.ok(server.requests.slice(before).some((r) => r.range?.startsWith("bytes=-")), "the directory was read again");
});

test("an archive with no history table fails as 'loading failed' and names the table", async () => {
  const cacheDir = await nextDir();
  const server = serveRanges({ [archiveUrl("2025")]: pubinfoZip([sb53()], { omitTables: ["BILL_HISTORY_TBL.dat"] }).zip });
  const result = await leginfoBillText(NAV53, { cacheDir, fetchImpl: server.fetch });
  assert.ok(!result.ok && result.reason === "loading failed" && /BILL_HISTORY_TBL\.dat/.test(result.detail), JSON.stringify(result));
});
