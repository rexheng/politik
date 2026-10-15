import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BRIEF_JUDGEMENT,
  RANK_TIMEOUT_MS,
  RELEVANCE_LEVELS,
  rank,
  relevanceJudgement,
  SIGNIFICANCE_LEVELS,
  typesafeScorer,
} from "../../photon/src/chat/rank.ts";
import type { Scorer } from "../../photon/src/chat/rank.ts";
import type { Route, Source } from "../../photon/src/chat/types.ts";
import type { Passage, RecordSummary } from "../../photon/src/data/schema.ts";

function summary(id: string, over: Partial<RecordSummary> = {}): RecordSummary {
  return {
    id,
    jurisdiction: "US-CA",
    type: "bill",
    title: `Title of ${id}`,
    shortTitle: id.toUpperCase(),
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

function policySource(id: string, seq = 1, text = `Passage text of ${id}.`): Source {
  const passage: Passage = { id: `${id}#${seq}`, recordId: id, seq, text };
  return { kind: "policy", record: summary(id), passage };
}

function postSource(n: number): Source {
  return { kind: "post", post: { text: `A public post, number ${n}.`, url: `https://bsky.app/profile/a/post/${n}`, author: "Ada", at: "2026-09-30T10:00:00Z" } };
}

const route = (over: Partial<Route> = {}): Route => ({ intent: "explain", detail: false, standalone: "What does SB 53 require?", search: "sb 53", recordHints: [], ...over });

const sources = [policySource("a"), policySource("b"), policySource("c"), postSource(1)];
const names = (xs: Source[]) => xs.map((s) => s.record?.id ?? `post${s.post!.url.slice(-1)}`);

/** Scores each candidate by a function of its position, highest first for the largest number. */
const byPosition = (score: (index: number, count: number) => number): Scorer => async (_q, candidates) =>
  Object.fromEntries(candidates.map((c, i) => [c.id, score(i, candidates.length)]));

describe("rank", () => {
  test("sorts by score, highest first (a scorer that reverses the order)", async () => {
    const out = await rank(route(), sources, byPosition((i) => i));
    assert.deepEqual(names(out), ["post1", "c", "b", "a"]);
  });

  test("is stable: equal scores keep their input order", async () => {
    const out = await rank(route(), sources, byPosition((i) => (i < 2 ? 1 : 2)));
    assert.deepEqual(names(out), ["c", "post1", "a", "b"]);
    const flat = await rank(route(), sources, byPosition(() => 5));
    assert.deepEqual(names(flat), ["a", "b", "c", "post1"]);
  });

  test("with no scorer it returns the input order", async () => {
    assert.equal(await rank(route(), sources), sources);
    assert.equal(await rank(route(), sources, undefined), sources);
  });

  test("a scorer that never resolves gives the input order after the timeout", async () => {
    const started = Date.now();
    const out = await rank(route(), sources, () => new Promise(() => {}), 10);
    assert.deepEqual(names(out), ["a", "b", "c", "post1"]);
    assert.ok(Date.now() - started < 1500);
  });

  test("a scorer that throws, rejects or answers with something else gives the input order", async () => {
    const throwing: Scorer = async () => {
      throw new Error("TypeSafe is down");
    };
    const syncThrow = (() => {
      throw new Error("synchronous");
    }) as unknown as Scorer;
    const nonsense = (async () => null) as unknown as Scorer;
    const text = (async () => "high") as unknown as Scorer;
    for (const scorer of [throwing, syncThrow, nonsense, text]) {
      assert.deepEqual(names(await rank(route(), sources, scorer)), ["a", "b", "c", "post1"]);
    }
  });

  test("the default deadline is the 2,500 ms rank budget", () => {
    assert.equal(RANK_TIMEOUT_MS, 2500);
  });

  test("it never adds or drops a source: scores for unknown ids are ignored, a missing or bad score sorts last", async () => {
    const scorer: Scorer = async (_q, candidates) => ({
      [candidates[0]!.id]: -2,
      [candidates[2]!.id]: 9,
      [candidates[3]!.id]: Number.NaN,
      "not-a-candidate": 100,
    });
    const out = await rank(route(), sources, scorer);
    assert.equal(out.length, sources.length);
    assert.deepEqual(names(out), ["c", "a", "b", "post1"]);
    assert.deepEqual(new Set(out), new Set(sources));
  });

  test("it does not change the input array or the sources", async () => {
    const input = [...sources];
    const copies = structuredClone(input);
    const out = await rank(route(), input, byPosition((i) => i));
    assert.deepEqual(input, copies);
    assert.notEqual(out, input);
    for (const s of out) assert.ok(input.includes(s), "the same source objects");
  });

  test("with fewer than two sources the scorer is not asked", async () => {
    const never: Scorer = async () => assert.fail("one source needs no ranking");
    assert.deepEqual(await rank(route(), [], never), []);
    const one = [policySource("a")];
    assert.equal(await rank(route(), one, never), one);
  });

  test("a brief is judged on significance to a California or Singapore tech policymaker", async () => {
    const seen: string[] = [];
    await rank(route({ intent: "brief", standalone: "What is going on?" }), sources, async (q) => {
      seen.push(q);
      return {};
    });
    assert.deepEqual(seen, ["significance to a California or Singapore tech policymaker"]);
    assert.equal(BRIEF_JUDGEMENT, "significance to a California or Singapore tech policymaker");
  });

  test("every other intent is judged on relevance to the standalone question", async () => {
    for (const intent of ["explain", "implications", "sentiment", "out-of-scope"] as const) {
      const seen: string[] = [];
      await rank(route({ intent, standalone: "What does SB 53 mean for a state agency?" }), sources, async (q) => {
        seen.push(q);
        return {};
      });
      assert.deepEqual(seen, ["relevance to: What does SB 53 mean for a state agency?"], intent);
    }
    assert.equal(relevanceJudgement("x"), "relevance to: x");
  });

  test("the scorer gets one candidate per source, with a unique id and the text to judge", async () => {
    const dup = [policySource("a"), policySource("a"), postSource(1), postSource(1)];
    let got: Parameters<Scorer>[1] = [];
    await rank(route(), dup, async (_q, candidates) => {
      got = candidates;
      return {};
    });
    assert.equal(got.length, 4);
    assert.equal(new Set(got.map((c) => c.id)).size, 4);
    assert.ok(got[0]!.text.includes("Passage text of a."));
    assert.ok(got[0]!.text.includes("Title of a"), "the title helps the judgement");
    assert.ok(got[2]!.text.includes("A public post, number 1."));
    assert.ok(got.every((c) => c.id !== "" && c.text.length > 0));
  });

  test("a long passage is cut before it is sent to the scorer", async () => {
    let got: Parameters<Scorer>[1] = [];
    await rank(route(), [policySource("a", 1, "w".repeat(1200)), policySource("b")], async (_q, candidates) => {
      got = candidates;
      return {};
    });
    assert.ok(got[0]!.text.length < 900, String(got[0]!.text.length));
  });

  test("the deadline timer is cleared once the scorer has answered or failed, so nothing is left waiting", async () => {
    const live = new Set<unknown>();
    const { setTimeout: realSet, clearTimeout: realClear } = globalThis;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      const timer = realSet(() => {
        live.delete(timer);
        fn();
      }, ms);
      live.add(timer);
      return timer;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer?: Parameters<typeof clearTimeout>[0]) => {
      live.delete(timer);
      realClear(timer);
    }) as typeof clearTimeout;
    try {
      await rank(route(), sources, byPosition((i) => i), 60_000);
      assert.equal(live.size, 0, "after a scorer that answered");
      await rank(route(), sources, async () => Promise.reject(new Error("no")), 60_000);
      assert.equal(live.size, 0, "after a scorer that failed");
    } finally {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    }
  });
});

describe("typesafeScorer", () => {
  type Request = { state: unknown; questions: Record<string, { type: string; instructions?: unknown; criteria: unknown[] }> };
  type Options = { timeout?: number; retry?: { maxRetries?: number } };

  /** A stand-in for TypeSafeClient that records the request and answers with `answer(name)` for each question. */
  function fakeClient(answer: (name: string, index: number) => unknown) {
    const calls: { request: Request; options: Options | undefined }[] = [];
    const client = {
      async systemOne(request: Request, options?: Options) {
        calls.push({ request, options });
        const answers = Object.fromEntries(Object.keys(request.questions).map((name, i) => [name, answer(name, i)]));
        return { model: "jev-fake", answers, usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
    return { client: client as unknown as NonNullable<Parameters<typeof typesafeScorer>[1]>, calls };
  }

  const candidates = [
    { id: "x#1", text: "First candidate text." },
    { id: "y#1", text: "Second candidate text." },
    { id: "z#1", text: "Third candidate text." },
  ];

  test("makes one call with one score question per candidate, and maps each score back to the candidate's id", async () => {
    const { client, calls } = fakeClient((_name, i) => ({ type: "score", score: 3 - i, confidence: 1 }));
    const scores = await typesafeScorer("key", client)("relevance to: SB 53", candidates);
    assert.deepEqual(scores, { "x#1": 3, "y#1": 2, "z#1": 1 });
    assert.equal(calls.length, 1);
    const { request, options } = calls[0]!;
    assert.equal(Object.keys(request.questions).length, 3);
    for (const q of Object.values(request.questions)) {
      assert.equal(q.type, "score");
      assert.ok(q.criteria.length >= 2);
      assert.equal(typeof q.instructions, "string");
    }
    assert.deepEqual(request.state, {
      question: "SB 53",
      candidates: [{ text: "First candidate text." }, { text: "Second candidate text." }, { text: "Third candidate text." }],
    });
    assert.ok(options!.timeout! <= RANK_TIMEOUT_MS);
    assert.equal(options!.retry?.maxRetries, 0);
  });

  test("each question points at its own candidate, and reads naturally for a brief and for a question", async () => {
    const brief = fakeClient(() => ({ type: "score", score: 1 }));
    await typesafeScorer("key", brief.client)(BRIEF_JUDGEMENT, candidates);
    const relevance = fakeClient(() => ({ type: "score", score: 1 }));
    await typesafeScorer("key", relevance.client)(relevanceJudgement("What does SB 53 require?"), candidates);
    const instructions = (c: typeof brief) => Object.values(c.calls[0]!.request.questions).map((q) => String(q.instructions));
    instructions(brief).forEach((text, i) => {
      assert.ok(text.includes(`\`candidates[${i}].text\``), text);
      assert.match(text, /^How significant is the item at .* to `audience`\?/);
    });
    instructions(relevance).forEach((text, i) => {
      assert.ok(text.includes(`\`candidates[${i}].text\``), text);
      assert.match(text, /^How relevant is the item at .* to `question`\?/);
    });
  });

  test("a brief is asked about its audience and a question about the question itself, each in the shared state", async () => {
    const brief = fakeClient(() => ({ type: "score", score: 1 }));
    await typesafeScorer("key", brief.client)(BRIEF_JUDGEMENT, candidates);
    assert.deepEqual(brief.calls[0]!.request.state, {
      audience: "a California or Singapore tech policymaker",
      candidates: candidates.map((c) => ({ text: c.text })),
    });
    // rank hands the scorer relevanceJudgement(standalone); the question reaches the state without its label.
    const asked = fakeClient(() => ({ type: "score", score: 1 }));
    await rank(route({ standalone: "What does SB 53 mean for a state agency?" }), sources, typesafeScorer("key", asked.client));
    assert.equal((asked.calls[0]!.request.state as { question: string }).question, "What does SB 53 mean for a state agency?");
    const bare = fakeClient(() => ({ type: "score", score: 1 }));
    await typesafeScorer("key", bare.client)("some other judgement", candidates);
    assert.equal((bare.calls[0]!.request.state as { question: string }).question, "some other judgement");
  });

  test("significance and relevance have different level texts, and each set appears in its request", async () => {
    const brief = fakeClient(() => ({ type: "score", score: 1 }));
    await typesafeScorer("key", brief.client)(BRIEF_JUDGEMENT, candidates);
    const relevance = fakeClient(() => ({ type: "score", score: 1 }));
    await typesafeScorer("key", relevance.client)(relevanceJudgement("SB 53"), candidates);

    assert.notDeepEqual([...SIGNIFICANCE_LEVELS], [...RELEVANCE_LEVELS]);
    const shared = SIGNIFICANCE_LEVELS.filter((level) => (RELEVANCE_LEVELS as readonly string[]).includes(level));
    assert.deepEqual(shared, [], "no level text is used by both judgements");
    for (const q of Object.values(brief.calls[0]!.request.questions)) assert.deepEqual(q.criteria, [...SIGNIFICANCE_LEVELS]);
    for (const q of Object.values(relevance.calls[0]!.request.questions)) assert.deepEqual(q.criteria, [...RELEVANCE_LEVELS]);
  });

  test("the levels are concrete situations that stand on their own, from least to most", () => {
    for (const levels of [SIGNIFICANCE_LEVELS, RELEVANCE_LEVELS]) {
      assert.ok(levels.length >= 3);
      assert.equal(new Set(levels).size, levels.length);
      for (const level of levels) {
        assert.ok(level.length > 60, level);
        assert.ok(!level.includes("`"), "no reference to a state path");
        assert.ok(!/\bjudgement\b|\bcandidate\b/i.test(level), level);
      }
    }
    assert.match(SIGNIFICANCE_LEVELS[0], /^A routine announcement or minor procedural step that changes nothing for policymakers/);
    assert.match(SIGNIFICANCE_LEVELS.at(-1)!, /^A new binding law, regulation or major ruling that changes obligations or powers in California or Singapore tech policy/);
    assert.match(RELEVANCE_LEVELS[0], /^About something else/);
    assert.match(RELEVANCE_LEVELS.at(-1)!, /^Answers the question directly/);
  });

  test("an answer without a numeric score leaves that candidate out", async () => {
    const { client } = fakeClient((_n, i) => (i === 1 ? { type: "score" } : i === 2 ? { type: "score", score: "high" } : { type: "score", score: 2 }));
    assert.deepEqual(await typesafeScorer("key", client)("j", candidates), { "x#1": 2 });
  });

  test("no candidates make no call", async () => {
    const { client, calls } = fakeClient(() => ({}));
    assert.deepEqual(await typesafeScorer("key", client)("j", []), {});
    assert.equal(calls.length, 0);
  });

  test("a failing call rejects, so rank falls back to the input order", async () => {
    const client = {
      async systemOne() {
        throw new Error("401");
      },
    } as unknown as NonNullable<Parameters<typeof typesafeScorer>[1]>;
    const scorer = typesafeScorer("key", client);
    await assert.rejects(() => scorer("j", candidates), /401/);
    assert.deepEqual(names(await rank(route(), sources, scorer)), ["a", "b", "c", "post1"]);
  });

  test("with only an API key it builds a real client without calling out", () => {
    assert.equal(typeof typesafeScorer("not-a-real-key"), "function");
  });
});
