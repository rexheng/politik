import { loadBriefings } from "../photon/src/briefings.ts";
import { answer } from "../photon/src/orchestrate.ts";
import { catalogItems, siteItems, type ChatTurn } from "../photon/src/select.ts";

const pool = [...loadBriefings(), ...catalogItems(), ...siteItems()];

function fail(message: string): never {
  throw new Error(message);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) fail(message);
}

const singapore = "Like what's AI policy in Singapore looking like";

const hello = await answer({ message: "hello", items: pool, history: [] });
assert(hello.reply === "What do you want to know?", `greeting: ${hello.reply}`);
assert(hello.items.length === 0, "greeting should have no cards");

const local = await answer({
  message: "What's going on with the data center water and noise?",
  items: pool,
  history: [],
});
assert(local.items.length === 1, `data center cards: ${local.items.map((item) => item.title).join(" | ")}`);
assert(/data center/i.test(local.items[0].title), local.items[0].title);
assert(local.items[0].relation === "answers", "data center should answer the question");
assert(!local.placeNote, "data center card should not carry a place warning");
assert(!/one update matches/i.test(local.reply), local.reply);

const bill = await answer({
  message: "What is happening with the AI transparency bill in the House?",
  items: pool,
  history: [],
});
assert(
  bill.items.length === 1 && /transparency/i.test(bill.items[0].title),
  `bill cards: ${bill.items.map((item) => item.title).join(" | ")}\n${bill.reply}`,
);
assert(bill.items[0].relation === "answers", "transparency bill should answer");
assert(/floor vote/i.test(bill.reply), bill.reply);

const trapped = loadBriefings()
  .filter((item) => item.id === "briefing-school-ai-policy")
  .map((item) => ({ ...item, category: "other" as const }));
const trappedReply = await answer({ message: singapore, items: trapped, history: [] });
assert(
  trappedReply.items.length === 0,
  `trapped pool still returned ${trappedReply.items.map((item) => item.title).join(" | ")}`,
);
assert(/HTTP 403/.test(trappedReply.reply), trappedReply.reply);
assert(!/school board/i.test(trappedReply.reply), trappedReply.reply);

const first = await answer({ message: singapore, items: pool, history: [] });
assert(first.items.length === 0, `singapore cards: ${first.items.map((item) => item.title).join(" | ")}`);
assert(/Singapore's AI policy/.test(first.reply), first.reply);
assert(/HTTP 403/.test(first.reply), first.reply);
assert(/GeBIZ/.test(first.reply), first.reply);
assert(/3,485/.test(first.reply), first.reply);
assert(/overview/i.test(first.reply), first.reply);
assert(!/school board/i.test(first.reply), first.reply);
assert(!/one update matches/i.test(first.reply), first.reply);
assert(!/two updates/i.test(first.reply), first.reply);

const history: ChatTurn[] = [
  { role: "user", text: singapore },
  { role: "assistant", text: first.reply, titles: first.items.map((item) => item.title) },
];

const more = await answer({
  message: "Give me more updates and an overview?",
  items: pool,
  history,
});
assert(more.items.length >= 4, `overview cards (${more.items.length}): ${more.items.map((item) => item.title).join(" | ")}`);
assert(more.items.every((item) => item.relation === "related"), JSON.stringify(more.items.map((item) => item.relation)));
assert(more.items.every((item) => item.placeNote === "Not Singapore"), JSON.stringify(more.items.map((item) => item.placeNote)));
assert(/HTTP 403/.test(more.reply), more.reply);
assert(/outside Singapore/i.test(more.reply), more.reply);
assert(/floor vote/i.test(more.reply), more.reply);
assert(/school board/i.test(more.reply), more.reply);
assert(/voluntary AI safety guidelines/i.test(more.reply), more.reply);
assert(/GeBIZ/.test(more.reply), more.reply);
assert(!/one update matches/i.test(more.reply), more.reply);
const titles = more.items.map((item) => item.title);
assert(
  titles.findIndex((title) => /transparency/i.test(title)) < titles.findIndex((title) => /school board/i.test(title)),
  titles.join(" | "),
);

const overview = await answer({ message: "overview", items: pool, history });
assert(overview.items.length >= 4, `bare overview: ${overview.items.map((item) => item.title).join(" | ")}`);
assert(/floor vote/i.test(overview.reply), overview.reply);

const again = await answer({
  message: "Give me more updates",
  items: pool,
  history: [
    ...history,
    { role: "user", text: "Give me more updates and an overview?" },
    { role: "assistant", text: more.reply, titles: more.items.map((item) => item.title) },
  ],
});
assert(/full set/i.test(again.reply), again.reply);
assert(again.items.length >= 4, "full set should still show the cards");

const centres = await answer({
  message: "yo help me understand data centres",
  items: pool,
  history: [],
});
assert(/servers/i.test(centres.reply), centres.reply);
assert(/Sparks/i.test(centres.reply), centres.reply);
assert(/water and noise/i.test(centres.reply), centres.reply);
assert(!/school board/i.test(centres.reply), centres.reply);
assert(!/one update matches/i.test(centres.reply), centres.reply);
assert(
  centres.items.some((item) => /town hall/i.test(item.title)),
  centres.items.map((item) => item.title).join(" | "),
);
assert(
  centres.items.some((item) => item.source === "data centre"),
  centres.items.map((item) => `${item.source}: ${item.title}`).join(" | "),
);

const afterCentres: ChatTurn[] = [
  { role: "user", text: "yo help me understand data centres" },
  { role: "assistant", text: centres.reply, titles: centres.items.map((item) => item.title) },
];
const aboutIt = await answer({ message: "what about it?", items: pool, history: afterCentres });
assert(!/what do you want to know/i.test(aboutIt.reply), aboutIt.reply);
assert(/under construction|stargate/i.test(aboutIt.reply), aboutIt.reply);

const aboutTopic = await answer({
  message: "tell me about the topic?",
  items: pool,
  history: [
    ...afterCentres,
    { role: "user", text: "what about it?" },
    { role: "assistant", text: aboutIt.reply, titles: aboutIt.items.map((item) => item.title) },
  ],
});
assert(!/what do you want to know/i.test(aboutTopic.reply), aboutTopic.reply);
assert(/whole of it/i.test(aboutTopic.reply), aboutTopic.reply);

const lost = await answer({ message: "what about it?", items: pool, history: [] });
assert(lost.reply === "Which part do you mean?", lost.reply);

console.log("select checks passed");
console.log("--- data centres ---");
console.log(centres.reply);
console.log("--- what about it ---");
console.log(aboutIt.reply);
console.log("--- topic ---");
console.log(aboutTopic.reply);
console.log("--- singapore ---");
console.log(first.reply);
console.log("--- overview ---");
console.log(more.reply);
console.log(more.items.map((item) => `${item.placeNote ?? ""} ${item.title}`).join("\n"));
