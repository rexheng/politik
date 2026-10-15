import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ChatTurn, Route } from "../../photon/src/chat/types.ts";
import { fallbackRoute, route, ROUTER_TIMEOUT_MS, RouteSchema } from "../../photon/src/chat/route.ts";
import { TOPICS } from "../../photon/src/data/schema.ts";
import { groqLlm } from "../../photon/src/llm/groq.ts";
import type { Llm } from "../../photon/src/llm/groq.ts";

type Req = Parameters<Llm>[0];

/** A fake Llm that records what it was asked and answers with `reply`, as the real one does after checking it against the schema. */
function fakeLlm(reply: unknown): { llm: Llm; calls: Req[] } {
  const calls: Req[] = [];
  const llm = (async (req: Req) => {
    calls.push(req);
    return reply;
  }) as Llm;
  return { llm, calls };
}

const sb53History: ChatTurn[] = [
  { role: "user", text: "Tell me about SB 53" },
  { role: "assistant", text: "SB 53 is California's frontier AI transparency law [1]." },
];

describe("fallbackRoute", () => {
  test("a short greeting is a greeting", () => {
    const r = fallbackRoute("hi", []);
    assert.equal(r.intent, "greeting");
    assert.equal(r.search, "");
    assert.deepEqual(r.recordHints, []);
    assert.equal(r.detail, false);
  });

  test("each greeting word works, in any case and with punctuation, up to three words", () => {
    for (const m of ["Hello", "HEY!", "Thanks.", "thank you", "Thanks a lot", "yo", "morning", "hi there!", "Hello, Politik"]) {
      assert.equal(fallbackRoute(m, []).intent, "greeting", m);
    }
  });

  test("a greeting word does not make a longer question a greeting", () => {
    assert.notEqual(fallbackRoute("hi what is SB 53", []).intent, "greeting");
    assert.notEqual(fallbackRoute("hello can you explain the PDPA", []).intent, "greeting");
  });

  test("a short message that does not start with a greeting word is not a greeting", () => {
    assert.notEqual(fallbackRoute("explain PDPA", []).intent, "greeting");
    assert.notEqual(fallbackRoute("SB 53", []).intent, "greeting");
  });

  test("a message with no keyword is a brief with an empty search", () => {
    const r = fallbackRoute("What is going on?", []);
    assert.equal(r.intent, "brief");
    assert.equal(r.search, "");
    assert.deepEqual(r.recordHints, []);
    assert.equal(r.detail, false);
    for (const m of ["what's new?", "Anything new?", "what is happening", "tell me what's going on", "", "   ", "???"]) {
      const b = fallbackRoute(m, []);
      assert.equal(b.intent, "brief", JSON.stringify(m));
      assert.equal(b.search, "", JSON.stringify(m));
    }
  });

  test("a question with keywords is an explain, and the keywords are the search", () => {
    const r = fallbackRoute("What are California's rules on data centres?", []);
    assert.equal(r.intent, "explain");
    assert.equal(r.detail, false);
    assert.equal(r.search, "california rules data centres");
    assert.equal(r.standalone, "What are California's rules on data centres?");
  });

  test("search is lowercase, deduplicated keywords without stop words or request words", () => {
    const r = fallbackRoute("Please explain the AI rules and the AI law", []);
    assert.equal(r.search, "ai rules law");
  });

  test("detail is set by the depth phrases, and those words stay out of the search", () => {
    for (const m of ["Explain SB 53 in detail", "walk me through the PDPA", "Give me a deep dive on SB 53", "explain fully what AB 2013 does", "IN DETAIL please: SB 53"]) {
      assert.equal(fallbackRoute(m, []).detail, true, m);
    }
    assert.equal(fallbackRoute("What is SB 53?", []).detail, false);
    const r = fallbackRoute("Explain SB 53 in detail", []);
    assert.equal(r.intent, "explain");
    assert.equal(r.detail, true);
    assert.ok(r.recordHints.includes("SB 53"));
    assert.equal(r.search, "sb 53");
  });

  test("record hints: bill numbers are normalised, acronyms of three or more capitals are kept", () => {
    assert.deepEqual(fallbackRoute("Explain SB 53", []).recordHints, ["SB 53"]);
    assert.deepEqual(fallbackRoute("what is sb53", []).recordHints, ["SB 53"]);
    assert.deepEqual(fallbackRoute("compare AB 2013 and sb 1047", []).recordHints, ["AB 2013", "SB 1047"]);
    assert.deepEqual(fallbackRoute("What does the PDPA require?", []).recordHints, ["PDPA"]);
    assert.deepEqual(fallbackRoute("PDPA and SB 53", []).recordHints, ["SB 53", "PDPA"]);
    assert.deepEqual(fallbackRoute("SB 53 vs SB 53 and the PDPA, PDPA", []).recordHints, ["SB 53", "PDPA"]);
  });

  test("record hints: two-letter caps, ordinary words and plain numbers are not hints", () => {
    assert.deepEqual(fallbackRoute("what does AI do in the US?", []).recordHints, []);
    assert.deepEqual(fallbackRoute("Tell me about data centres in 2025", []).recordHints, []);
    assert.deepEqual(fallbackRoute("WHAT IS GOING ON", []).recordHints, []);
    assert.deepEqual(fallbackRoute("absb 12 and sb", []).recordHints, []);
  });

  test("a follow-up with a pronoun also searches the keywords of the last user turn", () => {
    const r = fallbackRoute("what does that mean for agencies", sb53History);
    assert.ok(r.search.split(" ").includes("sb"));
    assert.ok(r.search.split(" ").includes("53"));
    assert.ok(r.search.split(" ").includes("agencies"));
    assert.equal(r.intent, "explain");
    // the assistant's turn is not mined
    assert.ok(!r.search.includes("transparency"));
  });

  test("the last user turn is the one used, and its keywords come after the message's", () => {
    const history: ChatTurn[] = [
      { role: "user", text: "Tell me about the PDPA" },
      { role: "assistant", text: "The PDPA is Singapore's data protection law." },
      { role: "user", text: "And SB 53?" },
      { role: "assistant", text: "SB 53 is a California law." },
    ];
    const r = fallbackRoute("What does it require of agencies?", history);
    assert.equal(r.search, "require agencies sb 53");
    assert.ok(!r.search.includes("pdpa"));
  });

  test("each pronoun triggers it, as a whole word only", () => {
    for (const p of ["it", "that", "this", "they", "those"]) {
      const r = fallbackRoute(`how does ${p} affect agencies`, sb53History);
      assert.ok(r.search.split(" ").includes("sb"), p);
    }
    // "item", "thatch" and "theme" are not pronouns
    assert.ok(!fallbackRoute("what about the item and theme", sb53History).search.includes("sb"));
  });

  test("no pronoun, no history or no user turn in the history: only the message is searched", () => {
    assert.ok(!fallbackRoute("what about agencies", sb53History).search.includes("sb"));
    assert.equal(fallbackRoute("what does that mean for agencies", []).search, "agencies");
    assert.equal(fallbackRoute("what does that mean for agencies", [{ role: "assistant", text: "Hello SB 53" }]).search, "agencies");
  });

  test("a message with no keyword stays a brief even when it has a pronoun, but still carries the history", () => {
    const r = fallbackRoute("what about that?", sb53History);
    assert.equal(r.intent, "brief");
    assert.equal(r.search, "sb 53");
  });

  test("the result is a plain Route with no undefined keys", () => {
    for (const r of [fallbackRoute("hi", []), fallbackRoute("What is going on?", []), fallbackRoute("Explain SB 53 in detail", sb53History)]) {
      assert.deepEqual(Object.keys(r).sort(), ["detail", "intent", "recordHints", "search", "standalone"]);
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    }
  });

  describe("a catch-up question is a brief, scoped by the place and topic it names", () => {
    test("what's going on in California AI policy", () => {
      const r = fallbackRoute("What's going on in California AI policy?", []);
      assert.equal(r.intent, "brief");
      assert.equal(r.jurisdiction, "US-CA");
      assert.ok(r.topics?.includes("ai-governance"));
      assert.equal(r.detail, false);
      assert.deepEqual(r.recordHints, []);
    });

    test("each catch-up phrase works, in any case and with a curly apostrophe", () => {
      for (const m of [
        "What is going on with AI in California?",
        "WHAT'S NEW in Singapore privacy",
        "what’s new in Singapore privacy",
        "whats new in California cybersecurity",
        "the latest on Singapore data centres",
        "any update on California online safety?",
        "what changed in Singapore procurement this year?",
        "what is happening with California AI",
      ]) {
        assert.equal(fallbackRoute(m, []).intent, "brief", m);
      }
    });

    test("a named instrument makes it an explain, however it is asked", () => {
      const r = fallbackRoute("What's new on SB 53?", []);
      assert.equal(r.intent, "explain");
      assert.deepEqual(r.recordHints, ["SB 53"]);
      assert.ok(!("jurisdiction" in r) && !("topics" in r));
      assert.equal(fallbackRoute("What's the latest on the PDPA?", []).intent, "explain");
      assert.equal(fallbackRoute("any update on AB 2013", []).intent, "explain");
    });

    test("an ordinary question about a place and topic is still an explain, with no scope set", () => {
      for (const m of ["What does California require of data centres?", "How does Singapore regulate AI?", "Explain Singapore privacy rules"]) {
        const r = fallbackRoute(m, []);
        assert.equal(r.intent, "explain", m);
        assert.ok(!("jurisdiction" in r) && !("topics" in r), m);
      }
    });

    test("California, CA, Singapore and SG name the jurisdiction as whole words", () => {
      const jurisdictionOf = (m: string) => fallbackRoute(m, []).jurisdiction;
      assert.equal(jurisdictionOf("what's going on in California"), "US-CA");
      assert.equal(jurisdictionOf("what's going on in CA"), "US-CA");
      assert.equal(jurisdictionOf("what's going on in Singapore"), "SG");
      assert.equal(jurisdictionOf("what's going on in SG"), "SG");
      assert.equal(jurisdictionOf("what's going on in Sgt Pepper"), undefined);
      assert.equal(jurisdictionOf("what's going on in Californian schools"), undefined);
    });

    test("two places, or none, leave the jurisdiction out", () => {
      assert.ok(!("jurisdiction" in fallbackRoute("what's going on in California and Singapore AI policy?", [])));
      assert.ok(!("jurisdiction" in fallbackRoute("what's going on in AI policy?", [])));
      assert.ok(!("topics" in fallbackRoute("what's going on in Singapore?", [])));
    });

    test("every topic can be named", () => {
      const cases: [string, string][] = [
        ["AI", "ai-governance"],
        ["artificial intelligence", "ai-governance"],
        ["data centres", "data-centres"],
        ["data centers", "data-centres"],
        ["privacy", "privacy-data"],
        ["data protection", "privacy-data"],
        ["cybersecurity", "cybersecurity"],
        ["cyber incidents", "cybersecurity"],
        ["online safety", "online-safety"],
        ["procurement", "gov-tech-procurement"],
        ["tenders", "gov-tech-procurement"],
        ["digital infrastructure", "digital-infrastructure"],
        ["broadband", "digital-infrastructure"],
      ];
      for (const [words, topic] of cases) {
        const r = fallbackRoute(`what's going on with ${words}?`, []);
        assert.equal(r.intent, "brief", words);
        assert.deepEqual(r.topics, [topic], words);
      }
    });

    test("several topics are all kept, once each, in the order of the topic list", () => {
      const r = fallbackRoute("what's the latest on cybersecurity, AI and AI safety, plus privacy?", []);
      assert.deepEqual(r.topics, ["ai-governance", "privacy-data", "cybersecurity"]);
    });

    test("'AI' is a whole word", () => {
      assert.ok(!("topics" in fallbackRoute("what's going on in Hainan, Taiwan and Spain?", [])));
    });

    test("a plain Route again: no undefined keys, and it survives JSON", () => {
      const r = fallbackRoute("What's going on in California AI policy?", []);
      assert.deepEqual(Object.keys(r).sort(), ["detail", "intent", "jurisdiction", "recordHints", "search", "standalone", "topics"]);
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    });
  });

  describe("a follow-up keeps the records named in the user's previous question", () => {
    test("a pronoun and history: the hints of the last user turn are added", () => {
      const r = fallbackRoute("what does that mean for agencies", sb53History);
      assert.ok(r.recordHints.includes("SB 53"));
      assert.deepEqual(r.recordHints, ["SB 53"]);
    });

    test("the message's own hints come first, and a hint found twice is kept once", () => {
      const history: ChatTurn[] = [{ role: "user", text: "Compare SB 53 with the PDPA" }, { role: "assistant", text: "Here is how they differ." }];
      assert.deepEqual(fallbackRoute("does it apply to AB 2013 as well as SB 53", history).recordHints, ["AB 2013", "SB 53", "PDPA"]);
    });

    test("only the last user turn is used, and the assistant's turns are not", () => {
      const history: ChatTurn[] = [
        { role: "user", text: "Tell me about the PDPA" },
        { role: "assistant", text: "The PDPA is Singapore's law. SB 53 is California's." },
        { role: "user", text: "And SB 53?" },
        { role: "assistant", text: "Here is SB 53 and the CCPA." },
      ];
      assert.deepEqual(fallbackRoute("what does that mean for agencies", history).recordHints, ["SB 53"]);
    });

    test("without a pronoun, without history or without a user turn, only the message's hints are used", () => {
      assert.deepEqual(fallbackRoute("what about agencies", sb53History).recordHints, []);
      assert.deepEqual(fallbackRoute("what does that mean for agencies", []).recordHints, []);
      assert.deepEqual(fallbackRoute("what does that mean for agencies", [{ role: "assistant", text: "SB 53" }]).recordHints, []);
    });

    test("a catch-up follow-up that names no record but relies on history becomes an explain about that record", () => {
      const r = fallbackRoute("is there an update on it for agencies?", sb53History);
      assert.equal(r.intent, "explain");
      assert.deepEqual(r.recordHints, ["SB 53"]);
      assert.ok(!("jurisdiction" in r) && !("topics" in r));
    });
  });

  test("hostile and odd input never throws", () => {
    for (const m of ["", "\0", "'; DROP TABLE records; --", "a".repeat(5000), "🙂🙂🙂", "SB ".repeat(300), "<script>alert(1)</script>", "NEAR(a b) * AND OR NOT"]) {
      const r = fallbackRoute(m, sb53History);
      assert.equal(typeof r.search, "string");
      assert.ok(Array.isArray(r.recordHints));
    }
  });
});

describe("route", () => {
  const valid: Route = {
    intent: "implications",
    detail: false,
    standalone: "What does California SB 53 mean for a state agency?",
    search: "sb 53 state agency",
    jurisdiction: "US-CA",
    topics: ["ai-governance"],
    recordHints: ["SB 53"],
    sinceDays: 90,
  };

  test("a valid Route from the model comes back as it is", async () => {
    const { llm } = fakeLlm(valid);
    assert.deepEqual(await route("What does that mean for a state agency?", sb53History, llm), valid);
  });

  test("a Route with no optional fields comes back without them", async () => {
    const minimal: Route = { intent: "brief", detail: false, standalone: "What is going on?", search: "", recordHints: [] };
    const { llm } = fakeLlm(minimal);
    const got = await route("What is going on?", [], llm);
    assert.deepEqual(got, minimal);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(minimal).sort());
  });

  test("the nulls a strict-schema model sends for 'not given' are dropped", async () => {
    const { llm } = fakeLlm({ intent: "explain", detail: true, standalone: "q", search: "pdpa", jurisdiction: null, topics: [], recordHints: ["PDPA"], sinceDays: null });
    assert.deepEqual(await route("q", [], llm), { intent: "explain", detail: true, standalone: "q", search: "pdpa", recordHints: ["PDPA"] });
  });

  test("a sinceDays that cannot be a number of days is dropped; a good one is whole days", async () => {
    const base = { intent: "brief", detail: false, standalone: "q", search: "", jurisdiction: null, topics: [], recordHints: [] };
    for (const bad of [0, -3, 0.5]) {
      const got = await route("q", [], fakeLlm({ ...base, sinceDays: bad }).llm);
      assert.ok(!("sinceDays" in got), String(bad));
    }
    assert.equal((await route("q", [], fakeLlm({ ...base, sinceDays: 7.9 }).llm)).sinceDays, 7);
    assert.equal((await route("q", [], fakeLlm({ ...base, sinceDays: 1e9 }).llm)).sinceDays, 3650);
  });

  test("it calls the model once, named route, with the zod schema", async () => {
    const { llm, calls } = fakeLlm(valid);
    await route("hello", [], llm);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.name, "route");
    assert.equal(calls[0]!.schema, RouteSchema);
  });

  test("the system prompt names both jurisdictions, all seven topics and every intent", async () => {
    const { llm, calls } = fakeLlm(valid);
    await route("hello", [], llm);
    const system = calls[0]!.system;
    assert.ok(system.includes("US-CA"));
    assert.ok(system.includes("SG"));
    assert.equal(TOPICS.length, 7);
    for (const t of TOPICS) assert.ok(system.includes(t), t);
    for (const i of ["greeting", "brief", "explain", "implications", "sentiment", "out-of-scope", "clarify"]) assert.ok(system.includes(i), i);
  });

  test("the user prompt carries the message and the earlier turns, oldest first", async () => {
    const { llm, calls } = fakeLlm(valid);
    await route("What does that mean for a state agency?", sb53History, llm);
    const user = calls[0]!.user;
    assert.ok(user.includes("What does that mean for a state agency?"));
    assert.ok(user.includes("Tell me about SB 53"));
    assert.ok(user.includes("frontier AI transparency law"));
    assert.ok(user.indexOf("Tell me about SB 53") < user.indexOf("What does that mean for a state agency?"));
    assert.ok(user.indexOf("Tell me about SB 53") < user.indexOf("frontier AI transparency law"));
  });

  test("with no history the prompt says so", async () => {
    const { llm, calls } = fakeLlm(valid);
    await route("hello there", [], llm);
    assert.ok(/no earlier|none/i.test(calls[0]!.user));
    assert.ok(calls[0]!.user.includes("hello there"));
  });

  test("a model that throws gives the rule-based route", async () => {
    const llm = (async () => {
      throw new Error("Groq API error 500");
    }) as Llm;
    for (const [message, history] of [
      ["hi", []],
      ["What is going on?", []],
      ["Explain SB 53 in detail", []],
      ["what does that mean for agencies", sb53History],
    ] as [string, ChatTurn[]][]) {
      assert.deepEqual(await route(message, history, llm), fallbackRoute(message, history), message);
    }
  });

  test("a model that rejects with a non-Error also gives the rule-based route", async () => {
    const llm = (() => Promise.reject("boom")) as unknown as Llm;
    assert.deepEqual(await route("hello", [], llm), fallbackRoute("hello", []));
  });

  test("a synchronous throw from the model also gives the rule-based route", async () => {
    const llm = (() => {
      throw new Error("sync");
    }) as unknown as Llm;
    assert.deepEqual(await route("hello", [], llm), fallbackRoute("hello", []));
  });

  test("a model that never answers is cut off at the deadline and the rule-based route is used", async () => {
    const llm = (() => new Promise(() => {})) as unknown as Llm;
    const started = Date.now();
    const got = await route("What is going on?", [], llm, { timeoutMs: 30 });
    assert.deepEqual(got, fallbackRoute("What is going on?", []));
    assert.ok(Date.now() - started < 1000);
  });

  test("a model that answers inside the deadline is used", async () => {
    const llm = (async () => {
      await new Promise((r) => setTimeout(r, 10));
      return valid;
    }) as unknown as Llm;
    assert.deepEqual(await route("q", [], llm, { timeoutMs: 500 }), valid);
  });

  test("a reply that is not a Route at all gives the rule-based route", async () => {
    for (const junk of [null, undefined, "explain", 42, [], {}, { intent: "explain" }, { ...valid, intent: "dance" }]) {
      assert.deepEqual(await route("What is going on?", [], fakeLlm(junk).llm), fallbackRoute("What is going on?", []), JSON.stringify(junk));
    }
  });

  test("an empty or blank standalone becomes the original message; a real one is kept as it is", async () => {
    const reply = { intent: "explain", detail: false, search: "sb 53", jurisdiction: null, topics: [], recordHints: ["SB 53"], sinceDays: null };
    const message = "What does that mean for a state agency?";
    for (const blank of ["", "   ", "\n\t "]) {
      const got = await route(message, sb53History, fakeLlm({ ...reply, standalone: blank }).llm);
      assert.equal(got.standalone, message, JSON.stringify(blank));
      assert.equal(got.intent, "explain");
      assert.equal(got.search, "sb 53");
    }
    const kept = await route(message, sb53History, fakeLlm({ ...reply, standalone: "What does SB 53 mean for a state agency?" }).llm);
    assert.equal(kept.standalone, "What does SB 53 mean for a state agency?");
    assert.equal(
      (await route(message, sb53History, fakeLlm({ ...reply, standalone: "  padded  " }).llm)).standalone,
      "  padded  ",
    );
  });

  test("a blank standalone from a reply that left out the optional fields is also filled in", async () => {
    const got = await route("What is going on?", [], fakeLlm({ intent: "brief", detail: false, standalone: "", search: "", recordHints: [] }).llm);
    assert.equal(got.standalone, "What is going on?");
  });

  test("the prompt separates a brief (what's going on, scoped by place or topic) from an explain (a named record)", async () => {
    const { llm, calls } = fakeLlm(valid);
    await route("hello", [], llm);
    const lines = calls[0]!.system.split("\n");
    const line = (start: string) => lines.find((l) => l.startsWith(start))!;
    const brief = line("- brief:");
    assert.match(brief, /what is going on/);
    assert.match(brief, /what changed/);
    assert.match(brief, /the latest/);
    assert.match(brief, /optionally narrowed to a place and\/or topic/);
    assert.match(brief, /what's going on in California AI policy\?/);
    assert.match(brief, /jurisdiction/);
    assert.match(brief, /topics/);
    assert.ok(!/no particular subject/.test(calls[0]!.system));
    const explain = line("- explain:");
    assert.match(explain, /specific named bill, law, regulation, framework or tender/);
    assert.match(explain, /or, with no "what's new" angle, what the rules on a topic say/);
    assert.match(explain, /what's new on SB 53\?/);
    const search = line("- search:");
    assert.match(search, /brief/);
    assert.match(search, /place or topic/);
    assert.match(search, /jurisdiction and topics/);
  });

  test("the default deadline is the 3,000 ms router budget", () => {
    assert.equal(ROUTER_TIMEOUT_MS, 3000);
  });
});

describe("RouteSchema", () => {
  const full = { intent: "explain", detail: false, standalone: "q", search: "s", jurisdiction: "SG", topics: ["privacy-data"], recordHints: [], sinceDays: 30 };

  test("accepts a full route, and null for the three optional fields", () => {
    assert.ok(RouteSchema.safeParse(full).success);
    assert.ok(RouteSchema.safeParse({ ...full, jurisdiction: null, sinceDays: null, topics: [] }).success);
  });

  test("rejects an unknown intent, jurisdiction or topic, and a missing required field", () => {
    assert.ok(!RouteSchema.safeParse({ ...full, intent: "dance" }).success);
    assert.ok(!RouteSchema.safeParse({ ...full, jurisdiction: "FR" }).success);
    assert.ok(!RouteSchema.safeParse({ ...full, topics: ["sport"] }).success);
    const { search: _search, ...noSearch } = full;
    assert.ok(!RouteSchema.safeParse(noSearch).success);
  });
});

describe("route through the real Groq client", () => {
  /** A fetch that records the request body and answers with `content` as the model's reply. */
  function fakeFetch(content: string): { fetchImpl: typeof fetch; bodies: any[] } {
    const bodies: any[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
    }) as typeof fetch;
    return { fetchImpl, bodies };
  }
  const client = (fetchImpl: typeof fetch) => groqLlm({ apiKey: "k", model: "openai/gpt-oss-20b", fetchImpl, maxRetries: 0 });

  test("the router schema qualifies for strict structured output, and a reply with nulls becomes a Route", async () => {
    const { fetchImpl, bodies } = fakeFetch(
      JSON.stringify({ intent: "explain", detail: true, standalone: "What does SB 53 do?", search: "sb 53", jurisdiction: "US-CA", topics: [], recordHints: ["SB 53"], sinceDays: null }),
    );
    const got = await route("Explain SB 53 in detail", [], client(fetchImpl));
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].response_format.type, "json_schema");
    assert.equal(bodies[0].response_format.json_schema.strict, true);
    assert.equal(bodies[0].response_format.json_schema.name, "route");
    assert.deepEqual(got, { intent: "explain", detail: true, standalone: "What does SB 53 do?", search: "sb 53", jurisdiction: "US-CA", recordHints: ["SB 53"] });
  });

  test("a reply that is not JSON for the schema is repaired once, then the rule-based route is used", async () => {
    const { fetchImpl, bodies } = fakeFetch(JSON.stringify({ intent: "dance" }));
    const got = await route("What is going on?", [], client(fetchImpl));
    assert.equal(bodies.length, 2); // the first call and the client's one repair call
    assert.deepEqual(got, fallbackRoute("What is going on?", []));
  });
});
