import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FAIL_REPLY, FALLBACK_REPLY } from "../../photon/src/chat/index.ts";
import { toSpoken, toSpokenResponse } from "../../photon/src/chat/spoken.ts";
import type { Citation } from "../../photon/src/chat/types.ts";

describe("toSpoken", () => {
  test("drops markers and markdown and turns bullets into sentences", () => {
    assert.equal(toSpoken("**SB 53 is law.** [1]\n\n- Rule one [2]\n- Rule two [3]"), "SB 53 is law. Rule one. Rule two.");
  });

  test("headings become short sentences of their own", () => {
    assert.equal(toSpoken("### What it does\nIt sets rules [1].\n### Open questions\nWhen it starts [2]."), "What it does. It sets rules. Open questions. When it starts.");
  });

  test("a line that ends in a colon keeps it, so a label runs into what follows", () => {
    assert.equal(toSpoken("**What to watch:** the rules [1]"), "What to watch: the rules.");
    assert.equal(toSpoken("What to watch:\n- the vote [1]\n- the date [2]"), "What to watch: the vote. the date.");
  });

  test("a bullet with its own full stop, question mark or bracketed ending gets no second one", () => {
    assert.equal(toSpoken("- Done.\n- Really?\n- Yes (see above)"), "Done. Really? Yes (see above).");
  });

  test("* and • bullets, and stray asterisks, are dropped too", () => {
    assert.equal(toSpoken("* one\n• two\n*three*"), "one. two. three.");
  });

  test("a marker group and a marker glued to a full stop are removed", () => {
    assert.equal(toSpoken("It applies to developers [1, 2]. It starts in 2026.[3]"), "It applies to developers. It starts in 2026.");
  });

  test("other square brackets are kept", () => {
    assert.equal(toSpoken("See [Annex A]."), "See [Annex A].");
  });

  test("runs of blank lines and spaces become single spaces", () => {
    assert.equal(toSpoken("One.\r\n\r\n\r\n   Two.   \n\n"), "One. Two.");
  });

  test("text within the limit is not cut", () => {
    const text = "A short answer. With two sentences.";
    assert.equal(toSpoken(text), text);
  });

  test("nothing in, nothing out", () => {
    assert.equal(toSpoken(""), "");
    assert.equal(toSpoken("   \n\n"), "");
    assert.equal(toSpoken("[1]"), "");
  });

  test("a 2,000-character reply is cut to at most 600 characters, at a sentence end", () => {
    const reply = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something useful [1].`).join(" ");
    assert.ok(reply.length > 2000);
    const spoken = toSpoken(reply);
    assert.ok(spoken.length <= 600, `${spoken.length} chars`);
    assert.ok(spoken.length > 500, "it keeps as many whole sentences as fit");
    assert.ok(spoken.endsWith("."));
    assert.doesNotMatch(spoken, /\[\d+\]/);
    assert.ok(spoken.endsWith("says something useful."), "it ends on a whole sentence");
  });

  test("it cuts at the last sentence end that fits, not the first", () => {
    assert.equal(toSpoken("One two three. Four five six. Seven eight nine.", 30), "One two three. Four five six.");
    assert.equal(toSpoken("One two three. Four five six. Seven eight nine.", 29), "One two three. Four five six.");
    assert.equal(toSpoken("One two three. Four five six. Seven eight nine.", 28), "One two three.");
  });

  test("a question mark or exclamation mark also ends a sentence", () => {
    assert.equal(toSpoken("Is it law? Yes! And more words follow here.", 20), "Is it law? Yes!");
  });

  test("an abbreviation or a decimal is not a sentence end", () => {
    const text = "The U.S. Sec. 5 rule costs 3.5 million dollars and more. Then a second sentence follows it here.";
    const spoken = toSpoken(text, 40);
    assert.ok(spoken.length <= 40);
    assert.ok(spoken.endsWith("."));
    assert.ok(!/(U\.S\.|Sec\.|3\.)$/.test(spoken), spoken);
  });

  test("a single sentence longer than the limit is cut at a word and given a full stop", () => {
    const spoken = toSpoken("word ".repeat(400));
    assert.ok(spoken.length <= 600);
    assert.ok(spoken.endsWith("word."));
  });

  test("a long run with no spaces is cut hard and still ends in a full stop within the limit", () => {
    const spoken = toSpoken("a".repeat(2000));
    assert.equal(spoken.length, 600);
    assert.ok(spoken.endsWith("."));
  });

  test("a 2,000-character input with no full stops still ends in one", () => {
    const spoken = toSpoken("Alpha, bravo; charlie - ".repeat(100));
    assert.ok(spoken.length <= 600);
    assert.ok(spoken.endsWith("."));
    assert.doesNotMatch(spoken, /[,;-]\.$/);
  });

  test("a closing quote after the full stop stays with the sentence", () => {
    const spoken = toSpoken('He said "it is law." Then more words that go on and on and on.', 25);
    assert.equal(spoken, 'He said "it is law."');
  });

  test("the limit is a parameter", () => {
    assert.equal(toSpoken("One. Two. Three.", 10), "One. Two.");
    assert.equal(toSpoken("One. Two. Three.", 0), "");
  });
});

describe("I3: a spoken fallback names the records", () => {
  const cite = (n: number, title: string, shortTitle?: string): Citation => ({ n, kind: "policy", recordId: `r${n}`, title, ...(shortTitle ? { shortTitle } : {}), url: `https://example.org/${n}`, quote: "q" });
  const fallback = (citations: Citation[]) => ({ reply: FALLBACK_REPLY, mode: "fallback" as const, citations });

  test("up to three titles, by short title where there is one", () => {
    const spoken = toSpokenResponse(fallback([cite(1, "Transparency in Frontier Artificial Intelligence Act", "SB 53"), cite(2, "Personal Data Protection Act 2012", "PDPA"), cite(3, "Colocation tender")]));
    assert.equal(spoken, "I couldn't write a summary just now. The most relevant records are SB 53, PDPA and Colocation tender.");
  });

  test("two titles, one title, and no more than three", () => {
    assert.equal(toSpokenResponse(fallback([cite(1, "A", "SB 53"), cite(2, "B")])), "I couldn't write a summary just now. The most relevant records are SB 53 and B.");
    assert.equal(toSpokenResponse(fallback([cite(1, "Only record")])), "I couldn't write a summary just now. The most relevant records are Only record.");
    const four = toSpokenResponse(fallback([cite(1, "A"), cite(2, "B"), cite(3, "C"), cite(4, "D")]));
    assert.match(four, /are A, B and C\.$/);
    assert.doesNotMatch(four, /\bD\b/);
  });

  test("the spoken fallback has no markers, markdown or brackets", () => {
    const spoken = toSpokenResponse(fallback([cite(1, "Act [2020]", "**SB 53**")]));
    assert.doesNotMatch(spoken, /[\[\]]/);
    assert.doesNotMatch(spoken, /\*\*/);
  });

  test("a fallback with no records, and every other mode, is toSpoken(reply)", () => {
    assert.equal(toSpokenResponse({ reply: FAIL_REPLY, mode: "fallback", citations: [] }), toSpoken(FAIL_REPLY));
    assert.equal(toSpokenResponse({ reply: "**Yes [1].** More.", mode: "brief", citations: [cite(1, "A")] }), "Yes. More.");
    assert.equal(toSpokenResponse({ reply: FALLBACK_REPLY, mode: "brief", citations: [cite(1, "A")] }), toSpoken(FALLBACK_REPLY), "only the fallback mode lists titles");
  });

  test("it respects the character limit", () => {
    const long = Array.from({ length: 3 }, (_, i) => cite(i + 1, `${"Very long record title ".repeat(10)}${i}`));
    assert.ok(toSpokenResponse(fallback(long), 120).length <= 120);
  });
});
