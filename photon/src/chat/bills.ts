// Bill numbers are written many ways: "SB 53", "SB53", "SB-53", "sb.53", "Senate Bill 53", "Senate Bill No. 53". The
// router's hints and a record's titles must be compared in one form, or "SB53" finds nothing in a record titled "SB 53".

/** A bill number as people write it: the kind (AB, SB, Assembly Bill, Senate Bill), any dash, dot or "No.", then the digits. */
const BILL = /\b(ab|sb|assembly bill|senate bill)\s*[-.]?\s*(?:no\.?)?\s*(\d+)\b/gi;

/**
 * `text` with each bill number written the same way, "sb 53" or "ab 2013": "SB53", "SB-53", "Senate Bill 53" and
 * "sb 53" all become "sb 53" (leading zeros dropped). Everything else is left as it was.
 */
export function normaliseBill(text: string): string {
  return text.replace(BILL, (_match, kind: string, number: string) => `${/^a/i.test(kind) ? "ab" : "sb"} ${number.replace(/^0+(?=\d)/, "")}`);
}
