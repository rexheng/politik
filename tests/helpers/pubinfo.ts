// Test fixtures for the Legislature's pubinfo archive: a tiny pubinfo_<year>.zip with a BILL_VERSION_TBL.dat, the
// bill XML ("LOB") files it names, a BILL_HISTORY_TBL.dat and a BILL_TBL.dat, written in the same formats as the real
// download (see photon/scripts/snapshot/leginfo.ts).
import { randomBytes } from "node:crypto";

import { buildZip, type ZipEntrySpec, type ZipOptions } from "./zip.ts";

export const ARCHIVE_HOST = "https://downloads.leginfo.legislature.ca.gov";
export const archiveUrl = (year: string) => `${ARCHIVE_HOST}/pubinfo_${year}.zip`;

const ACTIONS = { INT: "Introduced", AMD: "Amended Senate", ENR: "Enrolled", CHP: "Chaptered" } as const;
export type Stage = keyof typeof ACTIONS;

/** n distinct words, so a text built from them clears the 150-word gate. */
export const wordsOf = (n: number, prefix = "w") => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

export interface FixtureVersion {
  stage: Stage;
  /** The pubinfo version counter: 99 for the introduced text, falling by one with each later version. */
  versionNum: number;
  /** YYYY-MM-DD */
  date: string;
  /** The XML the version's LOB file holds. Default: a bill with a digest and one section of about 200 words. */
  xml?: string;
  /** The text the default XML's SECTION 1 holds. */
  body?: string;
}

/** One row of BILL_HISTORY_TBL.dat. Give them in any order: the real file is not in date order. */
export interface FixtureAction {
  /** YYYY-MM-DD */
  date: string;
  text: string;
  /** ACTION_SEQUENCE. Default: the row's position among the bill's rows. */
  seq?: number;
  /** ACTION_STATUS. Default "Applied". */
  status?: string;
}

export interface FixtureBill {
  /** For example "202520260". */
  session: string;
  type: "SB" | "AB";
  num: number;
  versions: FixtureVersion[];
  subject?: string;
  /** The bill's rows in BILL_HISTORY_TBL.dat. Default: none. */
  history?: FixtureAction[];
  /** The CURRENT_STATUS column of BILL_TBL.dat, for example "Chaptered". Default: NULL. */
  currentStatus?: string;
}

export const billIdOf = (b: FixtureBill) => `${b.session}${b.type}${b.num}`;
export const versionIdOf = (b: FixtureBill, v: FixtureVersion) => `${b.session.slice(0, 4)}0${b.type}${b.num}${v.versionNum}${v.stage}`;

/** The XML for one bill version, shaped like the real CAML files (a Description with the digest, then the Bill). */
export function billXml(options: { subject: string; digest: string[]; sections: { num: string; paragraphs: string[] }[] }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><caml:MeasureDoc version="1.0" xmlns:caml="http://lc.ca.gov/legalservices/schemas/caml.1#" xmlns:xlink="http://www.w3.org/1999/xlink">\n` +
    `<!-- Copyright © Legislative Counsel Bureau, State of California. -->\n` +
    `<caml:Description xmlns="http://www.w3.org/1999/xhtml"><caml:Id>fixture</caml:Id><caml:Title> An act relating to fixtures. </caml:Title>` +
    `<caml:GeneralSubject><caml:Subject>${esc(options.subject)}</caml:Subject></caml:GeneralSubject>` +
    `<caml:DigestText>${options.digest.map((p) => `<p>${esc(p)}</p>`).join("")}</caml:DigestText>` +
    `<caml:DigestKey><caml:VoteRequired>MAJORITY</caml:VoteRequired></caml:DigestKey></caml:Description>` +
    `<caml:Bill id="bill" xmlns="http://www.w3.org/1999/xhtml"><caml:Preamble>The people of the State of California do enact as follows:</caml:Preamble>` +
    options.sections
      .map(
        (s) =>
          `<caml:BillSection id="id_${s.num.replace(/\W/g, "")}"><caml:Num>${esc(s.num)}</caml:Num><caml:Content>` +
          s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("") +
          `</caml:Content></caml:BillSection>`,
      )
      .join("") +
    `</caml:Bill></caml:MeasureDoc>`
  );
}

/** One BILL_VERSION_TBL.dat row, in the real column order and quoting. `lob` is the LOB file's number. */
export function datRow(bill: FixtureBill, v: FixtureVersion, lob: number): string {
  const q = (s: string) => `\`${s}\``;
  return [
    q(versionIdOf(bill, v)),
    q(billIdOf(bill)),
    String(v.versionNum),
    `${v.date} 00:00:00`,
    q(ACTIONS[v.stage]),
    "NULL", // request_num
    q(bill.subject ?? "A fixture subject."), // subject
    q("Majority"), // vote_required
    q("No"), // appropriation
    q("Yes"), // fiscal_committee
    q("No"), // local_program
    "NULL", // substantive_changes
    q("No"), // urgency
    q("No"), // taxlevy
    `BILL_VERSION_TBL_${lob}.lob`,
    q("Y"), // active_flg
    q("LEG_ESI"), // trans_uid
    `${v.date} 10:45:15`, // trans_update
  ].join("\t");
}

let historyId = 118_000_000;

/** BILL_HISTORY_TBL.dat rows for a bill, in the real column order and quoting. */
export function historyRows(bill: FixtureBill): string[] {
  const q = (t: string) => `\`${t}\``;
  return (bill.history ?? []).map((a, i) =>
    [
      q(billIdOf(bill)),
      String((historyId += 1)),
      `${a.date} 00:00:00`,
      q(a.text),
      q("LEG_ESI"),
      `${a.date} 16:22:14`,
      String(a.seq ?? i + 1),
      q("126"),
      q(a.status ?? "Applied"),
      q("Senate"),
      "NULL",
      "NULL",
      q("In Floor Process"),
    ].join("\t"),
  );
}

/** A BILL_TBL.dat row (19 columns). */
export function billTblRow(bill: FixtureBill): string {
  const q = (t: string) => `\`${t}\``;
  const last = bill.versions[bill.versions.length - 1]!;
  return [
    q(billIdOf(bill)),
    q(`${bill.session.slice(0, 8)}`),
    q(bill.session.slice(8)),
    q(bill.type),
    String(bill.num),
    q(ACTIONS[last.stage]),
    "NULL",
    "NULL",
    "NULL",
    "NULL",
    q(versionIdOf(bill, last)),
    q("Y"),
    q("HS_INT"),
    "2025-12-02 16:22:14",
    "NULL",
    "NULL",
    q("Senate"),
    bill.currentStatus ? q(bill.currentStatus) : "NULL",
    "2025-02-07 00:00:00",
  ].join("\t");
}

export interface PubinfoFixture {
  zip: Uint8Array;
  /** The LOB file name of each version, keyed by versionId. */
  lobOf: Map<string, string>;
}

/**
 * A pubinfo-style archive holding `bills`. Other tables' files are in it too, since the real archive has them.
 * `fillerBytes` adds an incompressible LAW_SECTION file of that size, to make the archive big.
 */
export function pubinfoZip(bills: FixtureBill[], options: ZipOptions & { fillerBytes?: number; omitTables?: string[] } = {}): PubinfoFixture {
  const rows: string[] = [];
  const lobs: ZipEntrySpec[] = [];
  const lobOf = new Map<string, string>();
  let lob = 0;
  for (const bill of bills) {
    for (const v of bill.versions) {
      lob += 1;
      const name = `BILL_VERSION_TBL_${lob}.lob`;
      lobOf.set(versionIdOf(bill, v), name);
      rows.push(datRow(bill, v, lob));
      const xml =
        v.xml ??
        billXml({
          subject: bill.subject ?? "A fixture subject.",
          digest: [`Existing law covers fixtures in version ${v.versionNum}.`, "This bill would cover them better."],
          sections: [{ num: "SECTION 1.", paragraphs: [v.body ?? `The Legislature finds ${wordsOf(200)}.`] }],
        });
      lobs.push({ name, data: xml });
    }
  }
  const history = bills.flatMap(historyRows);
  const entries: ZipEntrySpec[] = [
    { name: "BILL_ANALYSIS_TBL.dat", data: "`not`\t`this`\n" },
    // The real file is not in date order, and a bill's rows are spread through it.
    { name: "BILL_HISTORY_TBL.dat", data: history.length ? `${[...history].reverse().join("\n")}\n` : "" },
    { name: "BILL_TBL.dat", data: `${bills.map(billTblRow).join("\n")}\n` },
    { name: "BILL_VERSION_TBL.dat", data: `${rows.join("\n")}\n` },
    { name: "LAW_SECTION_TBL.dat", data: "`nor`\t`this`\n" },
    ...lobs,
    { name: "BILL_ANALYSIS_TBL_1.lob", data: "analysis" },
    { name: "LAW_SECTION_TBL_1.lob", data: "law section" },
    ...(options.fillerBytes ? [{ name: "LAW_SECTION_TBL_2.lob", data: randomBytes(options.fillerBytes) }] : []),
  ];
  const { fillerBytes: _filler, omitTables, ...zipOptions } = options;
  const kept = entries.filter((e) => !omitTables?.includes(e.name));
  return { zip: buildZip(kept, zipOptions), lobOf };
}
