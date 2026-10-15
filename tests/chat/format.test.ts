import assert from "node:assert/strict";
import { describe, test } from "node:test";

// photon/public/format.js is a browser ES module with no DOM in it, so Node can import it as it is. It has no type
// declarations (a .d.ts in photon/public would be served to browsers), so the shapes are written out here.
type Inline = { type: "text" | "bold" | "cite"; text?: string; n?: number };
type Block = { type: "heading" | "para" | "bullets"; items?: Inline[][]; inline?: Inline[] };
type Format = {
  parseAnswer(md: string): Block[];
  formatAsOf(iso: string): string;
  historyTurn(role: string, text: string): { role: string; text: string };
  spokenText(md: string, max?: number): string;
};
const { parseAnswer, formatAsOf, historyTurn, spokenText } = (await import(new URL("../../photon/public/format.js", import.meta.url).href)) as Format;

const text = (t: string): Inline => ({ type: "text", text: t });
const bold = (t: string): Inline => ({ type: "bold", text: t });
const cite = (n: number): Inline => ({ type: "cite", n });

describe("parseAnswer", () => {
  test("bold then a cite, a bullet list, a heading and a paragraph with two cites", () => {
    assert.deepEqual(parseAnswer("**Yes.** [1]\n\n- a [2]\n- b\n\n### Status\ntext [1][3]"), [
      { type: "para", inline: [bold("Yes."), cite(1)] },
      { type: "bullets", items: [[text("a"), cite(2)], [text("b")]] },
      { type: "heading", inline: [text("Status")] },
      { type: "para", inline: [text("text"), cite(1), cite(3)] },
    ]);
  });

  test("model text is never markup: an HTML tag is one text inline holding the literal string", () => {
    assert.deepEqual(parseAnswer("<img src=x onerror=alert(1)>"), [{ type: "para", inline: [text("<img src=x onerror=alert(1)>")] }]);
  });

  test("markup inside bold, bullets and headings stays literal text too", () => {
    assert.deepEqual(parseAnswer("**<b>hi</b>**\n- <script>alert(1)</script> [1]\n## <i>x</i>"), [
      { type: "para", inline: [bold("<b>hi</b>")] },
      { type: "bullets", items: [[text("<script>alert(1)</script>"), cite(1)]] },
      { type: "heading", inline: [text("<i>x</i>")] },
    ]);
  });

  test("a cite inside bold splits the bold around it", () => {
    assert.deepEqual(parseAnswer("**Here is the picture [1].**"), [{ type: "para", inline: [bold("Here is the picture"), cite(1), bold(".")] }]);
  });

  test("a cite takes the place of the space before it, and a word after it keeps its space", () => {
    assert.deepEqual(parseAnswer("It passed [1] and was signed [2][3]. Then more."), [
      { type: "para", inline: [text("It passed"), cite(1), text(" and was signed"), cite(2), cite(3), text(". Then more.")] },
    ]);
  });

  test("a comma group is several cites, and cites with a space between them sit side by side", () => {
    assert.deepEqual(parseAnswer("Both agree [1, 2] [3]."), [{ type: "para", inline: [text("Both agree"), cite(1), cite(2), cite(3), text(".")] }]);
  });

  test("a bracketed year or a zero is not a cite", () => {
    assert.deepEqual(parseAnswer("Tan v Lim [2020] SGCA 5 and item [0]."), [{ type: "para", inline: [text("Tan v Lim [2020] SGCA 5 and item [0].")] }]);
  });

  test("two bold phrases in one line stay two", () => {
    assert.deepEqual(parseAnswer("**One** and **two** [1]"), [{ type: "para", inline: [bold("One"), text(" and "), bold("two"), cite(1)] }]);
  });

  test("an unpaired ** stays as written", () => {
    assert.deepEqual(parseAnswer("2 ** 3 is eight"), [{ type: "para", inline: [text("2 ** 3 is eight")] }]);
  });

  test("a brief: bold lead, bullets, then a closing line that is its own paragraph", () => {
    const md = "**Lead.** [1]\n- one [1]\n- two [2]\nWhat to watch: more to come.";
    assert.deepEqual(parseAnswer(md), [
      { type: "para", inline: [bold("Lead."), cite(1)] },
      { type: "bullets", items: [[text("one"), cite(1)], [text("two"), cite(2)]] },
      { type: "para", inline: [text("What to watch: more to come.")] },
    ]);
  });

  test("headings of any level, and * or a bullet dot for list items", () => {
    assert.deepEqual(parseAnswer("# One\n## Two\n###### Six\n* a\n• b"), [
      { type: "heading", inline: [text("One")] },
      { type: "heading", inline: [text("Two")] },
      { type: "heading", inline: [text("Six")] },
      { type: "bullets", items: [[text("a")], [text("b")]] },
    ]);
  });

  test("lines of one paragraph are joined by a space, and blank lines separate paragraphs", () => {
    assert.deepEqual(parseAnswer("first line\nsecond line\n\n\n\nnext paragraph"), [
      { type: "para", inline: [text("first line second line")] },
      { type: "para", inline: [text("next paragraph")] },
    ]);
  });

  test("CRLF line endings are handled", () => {
    assert.deepEqual(parseAnswer("**A.**\r\n\r\n- b [1]\r\n"), [
      { type: "para", inline: [bold("A.")] },
      { type: "bullets", items: [[text("b"), cite(1)]] },
    ]);
  });

  test("empty and blank input have no blocks, and a hash without a space is not a heading", () => {
    assert.deepEqual(parseAnswer(""), []);
    assert.deepEqual(parseAnswer("  \n\n  "), []);
    assert.deepEqual(parseAnswer("#hashtag"), [{ type: "para", inline: [text("#hashtag")] }]);
  });

  test("a non-string is no blocks, not an exception", () => {
    assert.deepEqual(parseAnswer(undefined as unknown as string), []);
    assert.deepEqual(parseAnswer(null as unknown as string), []);
  });
});

describe("formatAsOf", () => {
  test("an ISO date becomes the footer line, with no zero on the day", () => {
    assert.equal(formatAsOf("2026-10-15"), "Data as of 15 Oct 2026");
    assert.equal(formatAsOf("2026-01-05"), "Data as of 5 Jan 2026");
    assert.equal(formatAsOf("2025-12-31"), "Data as of 31 Dec 2025");
  });

  test("a date with a time keeps the day", () => {
    assert.equal(formatAsOf("2026-10-15T23:30:00Z"), "Data as of 15 Oct 2026");
  });

  test("empty, missing or unreadable is the empty string (an empty database has no date)", () => {
    assert.equal(formatAsOf(""), "");
    assert.equal(formatAsOf(undefined as unknown as string), "");
    assert.equal(formatAsOf("last Tuesday"), "");
    assert.equal(formatAsOf("2026-13-40"), "");
  });
});

describe("historyTurn", () => {
  test("a turn is the role and the text and nothing else", () => {
    assert.deepEqual(historyTurn("user", "What is going on?"), { role: "user", text: "What is going on?" });
    assert.deepEqual(Object.keys(historyTurn("assistant", "A reply [1].")), ["role", "text"]);
  });

  test("text over 600 characters is cut to 600", () => {
    const turn = historyTurn("assistant", "x".repeat(700));
    assert.equal(turn.text.length, 600);
    assert.equal(turn.role, "assistant");
    assert.equal(historyTurn("user", "y".repeat(600)).text.length, 600, "exactly 600 is kept whole");
  });

  test("a cut never leaves half of an emoji", () => {
    const text = "a".repeat(599) + "😀" + "tail";
    const cut = historyTurn("assistant", text).text;
    assert.ok(cut.length <= 600);
    assert.equal(cut, "a".repeat(599));
  });

  test("a missing text is empty", () => {
    assert.equal(historyTurn("user", undefined as unknown as string).text, "");
  });
});

describe("spokenText", () => {
  test("markers and markdown are dropped, and each bullet or heading is a sentence", () => {
    const md = "**Yes, it applies.** [1]\n\n### Status\n- It took effect on 1 January 2026 [2]\n- Fines are up to $1m, [3]\nWhat to watch: the first audits.";
    assert.equal(spokenText(md), "Yes, it applies. Status. It took effect on 1 January 2026. Fines are up to $1m. What to watch: the first audits.");
  });

  test("a long reply is cut at a sentence end within the limit", () => {
    const sentence = "This is one sentence of ordinary length.";
    const spoken = spokenText(Array(40).fill(sentence).join(" "), 100);
    assert.ok(spoken.length <= 100);
    assert.ok(spoken.endsWith("."));
    assert.equal(spoken, `${sentence} ${sentence}`);
  });

  test("a reply of only markers, or no reply, is empty", () => {
    assert.equal(spokenText("[1][2]"), "");
    assert.equal(spokenText(""), "");
    assert.equal(spokenText(undefined as unknown as string), "");
  });
});
