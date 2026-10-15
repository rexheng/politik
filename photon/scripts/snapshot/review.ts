// Renders review.md: the landmark records, laid out for a person to check against their sources (spec 5.5).
// Node-only build code: never import this from photon/src.
import type { Passage, PolicyRecord } from "../../src/data/schema.ts";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
/** Square brackets would end a markdown link label early. */
const label = (text: string) => oneLine(text).replace(/\[/g, "(").replace(/\]/g, ")");

const HEADER = `# Landmark review

The policies a pilot user is most likely to ask about. For each one, open the source, check the claims below against it,
then tick the box and add an entry to \`reviewed.json\` next to this file:

\`\`\`json
{ "id": "<record id>", "reviewer": "<your name>", "reviewedAt": "YYYY-MM-DD", "sha256": "<the sha256 shown for the record>" }
\`\`\`

The next build marks a record "human-reviewed" only while its sha256 still matches, so a changed source goes back to
"auto-checked". Nothing blocks on review.
`;

/** A record whose URL was constructed and not seen: what its page opens with, for a person to compare with the title. */
export type ConstructedCheck = { id: string; opens: string };

/**
 * The section that lists the records with a constructed URL. The URL was built from a pattern and nobody has opened
 * it, so a wrong one would show another document's claims under this title. The build also asks the checker model,
 * but a person looking at one line per record catches what it does not.
 */
function renderConstructed(records: PolicyRecord[], checks: ConstructedCheck[]): string {
  const byId = new Map(records.map((r) => [r.id, r]));
  const lines = checks.flatMap((check) => {
    const r = byId.get(check.id);
    return r ? [`- ${r.id}: "${oneLine(r.title)}" opens with "${oneLine(check.opens)}" ([source](${r.url}))`] : [];
  });
  if (lines.length === 0) return "";
  return `## Constructed URLs

These records come from a URL that was built from a pattern and has not been seen. Check that each page opens with what
its title says.

${lines.join("\n")}
`;
}

/**
 * The review page for the landmark records in `records` (others are skipped), in the order given.
 * Every claim is followed by the passages it cites, each linking to the record's source document.
 * `constructed` adds the list of records with a constructed URL (see `renderConstructed`) at the end.
 */
export function renderReview(records: PolicyRecord[], passages: Passage[], constructed: ConstructedCheck[] = []): string {
  const landmarks = records.filter((r) => r.landmark);
  const tail = renderConstructed(records, constructed);
  if (landmarks.length === 0) return `${HEADER}\nNo landmark records in this snapshot.\n${tail ? `\n${tail}` : ""}`;

  const byId = new Map(passages.map((p) => [p.id, p]));

  const section = (r: PolicyRecord): string => {
    const cites = (support: string[]) =>
      support
        .map((id) => {
          const heading = byId.get(id)?.heading;
          return `[${label(heading ? `${id}: ${heading}` : id)}](${r.url})`;
        })
        .join(", ");
    const claim = (text: string, support: string[]) => `- ${oneLine(text)} (${cites(support)})`;
    const list = (title: string, items: string[]) => (items.length > 0 ? [`**${title}**`, ...items, ""] : [`**${title}**: none`, ""]);

    const reviewed =
      r.review.state === "human-reviewed"
        ? `human-reviewed${r.review.reviewer ? ` by ${r.review.reviewer}` : ""}${r.review.reviewedAt ? ` on ${r.review.reviewedAt}` : ""}`
        : "auto-checked";

    return [
      `## ${r.id}`,
      "",
      `${oneLine(r.title)}`,
      "",
      `- Source: ${r.url}`,
      `- Jurisdiction and type: ${r.jurisdiction}, ${r.type}`,
      `- Issuer: ${oneLine(r.issuer)}`,
      `- Review state: ${reviewed}`,
      `- sha256: \`${r.sha256}\``,
      "",
      ...list("Status", [claim(`${r.status.value}${r.statusDate ? ` (from ${r.statusDate})` : ""}`, r.status.support)]),
      ...list("Summary", [claim(r.summary.value, r.summary.support)]),
      ...list("Timeline", r.timeline.map((e) => claim(`${e.date}: ${e.event}`, e.support))),
      ...list("Provisions", r.provisions.map((p) => claim(p.value, p.support))),
      ...list("Affected", r.affected.map((a) => claim(a.value, a.support))),
      "- [ ] reviewed",
      "",
    ].join("\n");
  };

  return `${HEADER}\n${landmarks.length} landmark record${landmarks.length === 1 ? "" : "s"}.\n\n${landmarks.map(section).join("\n")}${tail ? `\n${tail}` : ""}`;
}
