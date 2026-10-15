import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bestQuote, clipQuote, finalize, isCitable, MAX_QUOTE_CHARS, splitSentences, stripMarkers } from "../../photon/src/chat/cite.ts";
import type { ComposeOut, Source } from "../../photon/src/chat/types.ts";
import type { Passage, RecordSummary } from "../../photon/src/data/schema.ts";

function summary(id: string, over: Partial<RecordSummary> = {}): RecordSummary {
  return {
    id,
    jurisdiction: "US-CA",
    type: "bill",
    title: `Title of ${id}`,
    status: "enacted",
    lastActivity: "2025-09-29",
    summary: `Summary of ${id}`,
    url: `https://example.org/${id}`,
    publisher: "Example",
    landmark: false,
    reviewState: "auto-checked",
    ...over,
  };
}

function policy(id: string, text = `Passage text of ${id}.`, over: Partial<RecordSummary> = {}): Source {
  const passage: Passage = { id: `${id}#1`, recordId: id, seq: 1, text };
  return { kind: "policy", record: summary(id, over), passage };
}

function post(url: string, text = "Regulators should move faster.", author = "alice.bsky.social"): Source {
  return { kind: "post", post: { text, url, author, at: "2026-10-01T09:30:00Z" } };
}

const out = (answer: string): ComposeOut => ({ answer, general: null, followUps: [] });

describe("finalize: markers", () => {
  test("drops a marker with no source, renumbers the rest in order of first use, and orders the citations to match", () => {
    const sources = [policy("one"), policy("two"), policy("three")];
    const got = finalize(out("A [2]. B [7]. C [2][1]."), sources);
    assert.equal(got.reply, "A [1]. B. C [1][2].");
    assert.deepEqual(
      got.citations.map((c) => [c.n, c.recordId]),
      [
        [1, "two"],
        [2, "one"],
      ],
    );
    assert.equal(got.valid, true);
  });

  test("an answer with no marker, given sources, is not valid", () => {
    const got = finalize(out("SB 53 is law."), [policy("one"), policy("two")]);
    assert.equal(got.valid, false);
    assert.deepEqual(got.citations, []);
    assert.equal(got.reply, "SB 53 is law.");
  });

  test("an answer whose only markers are out of range is not valid, and the markers are gone", () => {
    const got = finalize(out("A [4]. B [0]. C [99]."), [policy("one"), policy("two"), policy("three")]);
    assert.equal(got.valid, false);
    assert.equal(got.reply, "A. B. C.");
    assert.deepEqual(got.citations, []);
  });

  test("with no sources the answer is valid, has no citations, and loses any marker", () => {
    const got = finalize(out("Politik has nothing on this [1]."), []);
    assert.equal(got.valid, true);
    assert.deepEqual(got.citations, []);
    assert.equal(got.reply, "Politik has nothing on this.");
  });

  test("a source cited twice is one citation, and a source never cited is not listed", () => {
    const got = finalize(out("A [3]. B [3]. C [3]."), [policy("one"), policy("two"), policy("three")]);
    assert.equal(got.reply, "A [1]. B [1]. C [1].");
    assert.deepEqual(
      got.citations.map((c) => [c.n, c.recordId]),
      [[1, "three"]],
    );
  });

  test("a marker group such as [3, 1] becomes separate markers, numbered in the order written", () => {
    const got = finalize(out("A [3, 1]. B [1]."), [policy("one"), policy("two"), policy("three")]);
    assert.equal(got.reply, "A [1][2]. B [2].");
    assert.deepEqual(
      got.citations.map((c) => c.recordId),
      ["three", "one"],
    );
  });

  test("a bad number inside a group is dropped and the good one kept", () => {
    const got = finalize(out("A [9, 2]."), [policy("one"), policy("two")]);
    assert.equal(got.reply, "A [1].");
    assert.equal(got.citations[0]!.recordId, "two");
  });

  test("removing a marker leaves one space between words and none before punctuation", () => {
    const sources = [policy("one")];
    assert.equal(finalize(out("alpha [5] beta [1]."), sources).reply, "alpha beta [1].");
    assert.equal(finalize(out("alpha [5]beta [1]."), sources).reply, "alpha beta [1].");
    assert.equal(finalize(out("alpha [5], beta [1]."), sources).reply, "alpha, beta [1].");
    assert.equal(finalize(out("alpha [1] [5]"), sources).reply, "alpha [1]");
  });

  test("markdown layout is kept, and numbering follows first appearance across lines", () => {
    const sources = [policy("one"), policy("two"), policy("three")];
    const answer = "**Lead [3].**\n\n- first [2]\n- second [3][9]\n\n### Heading\nProse [1].";
    const got = finalize(out(answer), sources);
    assert.equal(got.reply, "**Lead [1].**\n\n- first [2]\n- second [1]\n\n### Heading\nProse [3].");
    assert.deepEqual(
      got.citations.map((c) => c.recordId),
      ["three", "two", "one"],
    );
  });

  test("does not change the sources or the compose output it is given", () => {
    const sources = [policy("one")];
    const raw = out("A [1].");
    const before = JSON.stringify([sources, raw]);
    finalize(raw, sources);
    assert.equal(JSON.stringify([sources, raw]), before);
  });
});

describe("finalize: citations", () => {
  test("a policy source becomes a citation from its record and passage", () => {
    const record = summary("sb-53", {
      title: "Transparency in Frontier Artificial Intelligence Act",
      shortTitle: "SB 53",
      jurisdiction: "US-CA",
      type: "bill",
      status: "in-force",
      reviewState: "human-reviewed",
    });
    const passage: Passage = { id: "sb-53#2", recordId: "sb-53", seq: 2, text: "Large developers must publish a framework." };
    const got = finalize(out("Developers publish a framework [1]."), [{ kind: "policy", record, passage }]);
    assert.deepEqual(got.citations, [
      {
        n: 1,
        kind: "policy",
        recordId: "sb-53",
        passageId: "sb-53#2",
        title: "Transparency in Frontier Artificial Intelligence Act",
        shortTitle: "SB 53",
        url: "https://example.org/sb-53",
        jurisdiction: "US-CA",
        type: "bill",
        status: "in-force",
        reviewState: "human-reviewed",
        quote: "Large developers must publish a framework.",
      },
    ]);
  });

  test("a record with no short title has no shortTitle key, and `fetched` is left out (the record summary does not carry it)", () => {
    const got = finalize(out("A [1]."), [policy("one")]);
    assert.equal("shortTitle" in got.citations[0]!, false);
    assert.equal("fetched" in got.citations[0]!, false);
  });

  test("a post source is a post citation with the post's link and text", () => {
    const got = finalize(out("Some people say regulators are slow [1]."), [post("https://bsky.app/profile/alice/post/1")]);
    assert.deepEqual(got.citations, [
      {
        n: 1,
        kind: "post",
        title: "Public post by alice.bsky.social",
        url: "https://bsky.app/profile/alice/post/1",
        quote: "Regulators should move faster.",
      },
    ]);
    assert.equal(got.valid, true);
  });

  test("a policy source with no passage quotes the record's summary", () => {
    const got = finalize(out("A [1]."), [{ kind: "policy", record: summary("one") }]);
    assert.equal(got.citations[0]!.quote, "Summary of one");
    assert.equal("passageId" in got.citations[0]!, false);
  });

  test("a quote is at most 280 characters, cut at a word with an ellipsis", () => {
    const long = "The department shall publish a framework describing how it assesses catastrophic risk. ".repeat(20);
    const got = finalize(out("A [1]."), [policy("one", long)]);
    const quote = got.citations[0]!.quote;
    assert.ok(quote.length <= MAX_QUOTE_CHARS, `${quote.length} chars`);
    assert.ok(quote.length > 200);
    assert.ok(quote.endsWith("…"));
    assert.ok(long.replace(/\s+/g, " ").startsWith(quote.slice(0, -1)));
    assert.equal(MAX_QUOTE_CHARS, 280);
  });

  test("a post's quote is also capped", () => {
    const got = finalize(out("A [1]."), [post("https://bsky.app/p/1", "word ".repeat(200))]);
    assert.ok(got.citations[0]!.quote.length <= 280);
  });
});

describe("clipQuote", () => {
  test("text within the limit is kept, with its whitespace made single spaces", () => {
    assert.equal(clipQuote("  Line one.\n\nLine   two.  "), "Line one. Line two.");
  });

  test("a long unbroken run is cut hard at the limit", () => {
    const got = clipQuote("x".repeat(1000));
    assert.equal(got.length, 280);
    assert.ok(got.endsWith("…"));
  });

  test("it never leaves half a surrogate pair", () => {
    const got = clipQuote("😀".repeat(400));
    assert.ok(got.length <= 280);
    assert.doesNotMatch(got, /[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});

describe("finalize: a source with no usable link is never cited", () => {
  // A post can arrive with url "" (its original link was not http(s)). A citation must always have a link, so such a
  // source is dropped from the citations and its markers are removed from the reply.
  test("its citation is dropped and its marker is stripped, and the others are numbered without it", () => {
    const sources = [post(""), policy("one"), post("https://bsky.app/p/2")];
    const got = finalize(out("Posts are split [1][3]. The bill is law [2]."), sources);
    assert.equal(got.reply, "Posts are split [1]. The bill is law [2].");
    assert.deepEqual(
      got.citations.map((c) => [c.n, c.kind, c.url]),
      [
        [1, "post", "https://bsky.app/p/2"],
        [2, "policy", "https://example.org/one"],
      ],
    );
    assert.ok(got.citations.every((c) => c.url !== ""));
    assert.equal(got.valid, true);
  });

  test("if that was the only source cited, the answer is not valid", () => {
    const got = finalize(out("Posts are split [1]."), [post(""), policy("one")]);
    assert.equal(got.reply, "Posts are split.");
    assert.deepEqual(got.citations, []);
    assert.equal(got.valid, false);
  });

  test("a link that is not http(s) counts as no link", () => {
    for (const url of ["", "   ", "javascript:alert(1)", "ftp://example.org/x", "not a url"]) {
      assert.equal(isCitable(post(url)), false, JSON.stringify(url));
      assert.equal(isCitable(policy("one", "text", { url })), false, JSON.stringify(url));
    }
    assert.equal(isCitable(post("https://bsky.app/p/1")), true);
    assert.equal(isCitable(post("http://example.org/p/1")), true);
    assert.equal(isCitable(policy("one")), true);
  });

  test("a source that has neither a record nor a post cannot be cited", () => {
    assert.equal(isCitable({ kind: "policy" }), false);
    assert.equal(isCitable({ kind: "post" }), false);
  });
});

describe("stripMarkers", () => {
  test("removes every marker, with the space before it", () => {
    assert.equal(stripMarkers("A fact [1]. Another [2][3], and more [4, 5]."), "A fact. Another, and more.");
  });

  test("a very long run of spaces is not slow", () => {
    const started = Date.now();
    assert.equal(stripMarkers(`${" ".repeat(300_000)}x [1]`), `${" ".repeat(300_000)}x`);
    assert.ok(Date.now() - started < 1000);
  });

  test("leaves other square brackets alone", () => {
    assert.equal(stripMarkers("See [Annex A] and [1a]."), "See [Annex A] and [1a].");
  });
});

describe("markers: what counts as one (B-R10)", () => {
  const sources = [policy("one"), policy("two")];

  test("a bracketed year is text, not a marker", () => {
    const got = finalize(out("In [2024] it passed [1]."), sources);
    assert.equal(got.reply, "In [2024] it passed [1].");
    assert.deepEqual(
      got.citations.map((c) => c.recordId),
      ["one"],
    );
    assert.equal(stripMarkers("In [2024] it passed [1]."), "In [2024] it passed.");
  });

  test("a neutral citation such as [2020] SGCA 5 is left as written", () => {
    assert.equal(stripMarkers("Tan v Lim [2020] SGCA 5"), "Tan v Lim [2020] SGCA 5");
    assert.equal(finalize(out("Tan v Lim [2020] SGCA 5 held this [2]."), sources).reply, "Tan v Lim [2020] SGCA 5 held this [1].");
    assert.equal(finalize(out("Tan v Lim [2020] SGCA 5"), sources).valid, false, "a year is not a marker, so nothing here is cited");
  });

  test("a group may not hide a year either", () => {
    assert.equal(stripMarkers("See [2024, 1]."), "See [2024, 1].");
  });

  test("one or two digits make a marker; three do not", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => policy(`r${i + 1}`));
    const got = finalize(out("A [12]. B [123]."), twelve);
    assert.equal(got.reply, "A [1]. B [123].");
    assert.deepEqual(
      got.citations.map((c) => c.recordId),
      ["r12"],
    );
  });

  test("spaces inside the brackets are allowed: [ 1 ] is marker 1", () => {
    const got = finalize(out("A [ 1 ]. B [ 2 , 1 ]. C [\t2\t]."), sources);
    assert.equal(got.reply, "A [1]. B [1][2]. C [2].");
    assert.deepEqual(
      got.citations.map((c) => c.recordId),
      ["one", "two"],
    );
    assert.equal(stripMarkers("A [ 1 ] and B [ 2, 3 ]."), "A and B.");
  });

  test("spaces inside the brackets do not turn other text into a marker", () => {
    assert.equal(stripMarkers("See [ Annex 1 ] and [ ] and [ a ]."), "See [ Annex 1 ] and [ ] and [ a ].");
  });

  test("line breaks inside the brackets are not a marker", () => {
    assert.equal(stripMarkers("A [\n1\n]."), "A [\n1\n].");
  });
});

describe("splitSentences", () => {
  test("splits at a full stop followed by a capital, keeping the markers with the sentence before them", () => {
    assert.deepEqual(splitSentences("The bill passed [1]. The governor signed it [2][3]. Done."), ["The bill passed [1].", " The governor signed it [2][3].", " Done."]);
    assert.equal(splitSentences("A [1]. B [2]. C.").join(""), "A [1]. B [2]. C.", "the pieces give the line back");
  });

  test("does not split after an abbreviation: U.S., e.g., i.e., Sec., No.", () => {
    assert.deepEqual(splitSentences("The U.S. Congress acted [1]. It passed."), ["The U.S. Congress acted [1].", " It passed."]);
    assert.deepEqual(splitSentences("Large developers (e.g. Meta) must report [1]. Others need not."), ["Large developers (e.g. Meta) must report [1].", " Others need not."]);
    assert.deepEqual(splitSentences("It covers models, i.e. Frontier ones [1]. Other models are out."), ["It covers models, i.e. Frontier ones [1].", " Other models are out."]);
    assert.deepEqual(splitSentences("See Sec. Twelve for duties [1]. Then more."), ["See Sec. Twelve for duties [1].", " Then more."]);
    assert.deepEqual(splitSentences("It is Bill No. Five [1]. Next."), ["It is Bill No. Five [1].", " Next."]);
  });

  test("a line with no full stop is one sentence, and an empty line is one empty piece", () => {
    assert.deepEqual(splitSentences("What to watch: the vote"), ["What to watch: the vote"]);
    assert.deepEqual(splitSentences(""), [""]);
  });
});

describe("I5: the quote is the stretch of the source that the citing sentence rests on", () => {
  const FILLER = "The agency reviews routine administrative matters in the ordinary course of its work. ";
  const FACT = "The zebra registry must be audited every year by the regulator.";
  const long = `${FILLER.repeat(5)}${FACT} ${FILLER.repeat(5)}`;

  test("a fact deep in a long passage is in the quote", () => {
    assert.ok(long.length > 800);
    const got = finalize(out("The zebra registry is audited every year [1]."), [policy("one", long)]);
    const quote = got.citations[0]!.quote;
    assert.ok(quote.includes(FACT), quote);
    assert.ok(quote.length <= MAX_QUOTE_CHARS, `${quote.length} chars`);
    assert.ok(quote.startsWith("…") && quote.endsWith("…"), quote);
  });

  test("with the fact near the start the quote starts at the start, with no leading ellipsis", () => {
    const early = `${FACT} ${FILLER.repeat(10)}`;
    const got = finalize(out("The registry is audited each year [1]."), [policy("one", early)]);
    assert.ok(got.citations[0]!.quote.startsWith("The zebra registry must be audited"));
    assert.ok(got.citations[0]!.quote.length <= MAX_QUOTE_CHARS);
  });

  test("each source's quote follows the sentence that cites it", () => {
    const a = `${FILLER.repeat(5)}Alpha facility must report each incident to the board. ${FILLER.repeat(5)}`;
    const b = `${FILLER.repeat(4)}Beta operators must renew their licence every three years. ${FILLER.repeat(6)}`;
    const got = finalize(out("Alpha reports incidents [1]. Beta operators renew licences [2]. Both are covered [1][2]."), [policy("one", a), policy("two", b)]);
    assert.ok(got.citations[0]!.quote.includes("Alpha facility must report"), got.citations[0]!.quote);
    assert.ok(got.citations[1]!.quote.includes("Beta operators must renew"), got.citations[1]!.quote);
  });

  test("when several sentences cite one source, the window that serves most of them wins", () => {
    const text = `${FILLER.repeat(4)}Operators must file annually. Late filers pay a fine of ten thousand dollars. ${FILLER.repeat(4)}Unrelated tail about parking.`;
    const got = finalize(out("Operators file every year [1]. Late filers pay a fine [1]."), [policy("one", text)]);
    const quote = got.citations[0]!.quote;
    assert.ok(quote.includes("Operators must file annually") && quote.includes("Late filers pay a fine"), quote);
  });

  test("a sentence with no word in common with the source leaves the quote at the start of the source", () => {
    const got = finalize(out("Entirely different words appear here [1]."), [policy("one", long)]);
    assert.equal(got.citations[0]!.quote, clipQuote(long));
  });

  test("a marker with no sentence around it, or a source that is short, keeps the whole text", () => {
    assert.equal(finalize(out("[1]"), [policy("one", "Short passage.")]).citations[0]!.quote, "Short passage.");
    assert.equal(finalize(out("About a short passage [1]."), [policy("one", "Short passage.")]).citations[0]!.quote, "Short passage.");
  });

  test("a post's quote is cut the same way", () => {
    const text = `${"Filler words about nothing much. ".repeat(12)}Quokkas deserve a sanctuary funded annually. ${"More filler words. ".repeat(12)}`;
    const got = finalize(out("One post wants a quokka sanctuary funded [1]."), [post("https://bsky.app/p/1", text)]);
    assert.ok(got.citations[0]!.quote.includes("Quokkas deserve a sanctuary"), got.citations[0]!.quote);
  });

  test("a sentence is not split at U.S.: the claim keeps its words", () => {
    const text = `${FILLER.repeat(5)}Congress in the United States must approve any treaty with a two thirds vote. ${FILLER.repeat(5)}`;
    const got = finalize(out("In the U.S. Congress must approve any treaty [1]."), [policy("one", text)]);
    assert.ok(got.citations[0]!.quote.includes("must approve any treaty"), got.citations[0]!.quote);
  });

  test("it is unchanged for markers beyond the sources, which still drop out", () => {
    const got = finalize(out("The zebra registry is audited [1]. Something else [5]."), [policy("one", long)]);
    assert.equal(got.reply, "The zebra registry is audited [1]. Something else.");
    assert.ok(got.citations[0]!.quote.includes(FACT));
  });

  test("bestQuote never exceeds the limit, even for one long word or an emoji at the edge", () => {
    const wall = `${"a".repeat(400)} zebra ${"😀".repeat(200)}`;
    for (const claim of ["zebra", "aaaa", "nothing in common"]) {
      const quote = bestQuote(wall, claim);
      assert.ok(quote.length <= MAX_QUOTE_CHARS, `${claim}: ${quote.length}`);
      assert.doesNotMatch(quote, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });
});
