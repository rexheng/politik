import type { Category, TaggedItem } from "./contracts.ts";

const MAX_LEAD_WORDS = 40;
const OPENAI_MODEL = "gpt-4.1-mini";

const TOPIC: Record<Category, string | undefined> = {
  "bill-stuck": "bills",
  "local-worry": "local disputes",
  "lab-money": "labs and funding",
  research: "research",
  speech: "speeches",
  other: undefined,
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function pickItems(category: Category, items: TaggedItem[]): TaggedItem[] {
  const matched = items.filter((item) => item.category === category);
  const pool = matched.length > 0 ? matched : items;
  return pool.slice(0, 2);
}

export const GREETING = "What do you want to know?";
const EMPTY_REPLY = "I do not have a fresh update on that yet.";
const ERROR_REPLY = "I could not check that just now.";

const POLICY_ASK =
  /\b(?:bills?|votes?|voting|laws?|statutes?|legislation|senate|house|congress|committees?|filibusters?|hearings?|speeches|speech|transcripts?|data\s*cent(?:er|re)s?|datacent(?:er|re)s?|towns?|cities|city|counties|county|districts?|neighborhoods?|communities|community|places?|california|water|noise|grids?|power|sources?|papers?|studies|study|journals?|research|funding|funds|funded|labs?|startups?|investments?|investors?|chips?|transparency|policies|policy|regulations?|ai|saying|briefings?|updates?|happening|watch)\b|\b(?:sb|ab|hb|hr)\s*\d+\b|\bgoing on\b|\bcatch me up\b|\bbrief me\b|\bwhat(?:'s| is) new\b|\bpeople are saying\b|\bwhat to watch\b/;

export function wantsPolicy(message: string): boolean {
  const text = message
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  return POLICY_ASK.test(text);
}

function leadIn(items: TaggedItem[]): string {
  const single = items.length === 1;
  const count = single ? "One update" : "Two updates";
  const topics = new Set(
    items.map((item) => TOPIC[item.category]).filter((topic): topic is string => Boolean(topic)),
  );
  if (topics.size === 1) return `${count} on ${[...topics][0]}.`;
  return single ? "One update matches that." : "Two updates match that.";
}

function cardText(reply: string, items: TaggedItem[]): boolean {
  const lower = reply.toLowerCase();
  for (const item of items) {
    const title = item.title.trim().toLowerCase();
    if (title.length >= 12 && lower.includes(title)) return true;
    const plain = item.plain.trim().toLowerCase().slice(0, 48);
    if (plain.length >= 24 && lower.includes(plain)) return true;
  }
  return false;
}

function shapeReply(raw: string, items: TaggedItem[]): string {
  const fallback = items.length === 0 ? EMPTY_REPLY : leadIn(items);
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(/^david evan harris\b[\s,.:;]+/i, "").trim();
  if (!text || /one thing to know is/i.test(text) || cardText(text, items)) return fallback;

  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = (parts.length > 0 ? parts : [text]).slice(0, items.length === 0 ? 1 : 2);
  const joined = kept.join(" ");
  if (wordCount(joined) > (items.length === 0 ? 16 : MAX_LEAD_WORDS)) return fallback;
  if (cardText(joined, items)) return fallback;
  return /[.!?]$/.test(joined) ? joined : `${joined}.`;
}

function deterministicReply(message: string, items: TaggedItem[]): string {
  if (!wantsPolicy(message)) return GREETING;
  if (items.length === 0) return EMPTY_REPLY;
  return leadIn(items);
}

function buildFactBrief(items: TaggedItem[]): string {
  return items
    .map((item, i) => `Item ${i + 1}\nTitle: ${item.title}\nSummary: ${item.plain}`)
    .join("\n\n");
}

async function phraseWithOpenAI(
  message: string,
  items: TaggedItem[],
  openaiKey: string,
): Promise<string | null> {
  try {
    const facts =
      items.length === 0
        ? "No facts yet. Say you do not have a fresh update yet. One short sentence. Do not repeat their question."
        : buildFactBrief(items);

    const system = [
      "You write the line above the source cards.",
      "Use one or two short sentences. Use plain words.",
      "The cards already show each title and summary. Do not repeat that text.",
      "Do not name sources. Do not include links.",
      "Do not start with a person's name.",
      'Do not write "One thing to know is".',
      "Do not join two briefings into one paragraph.",
      "If there are no facts, use one sentence: you do not have a fresh update yet.",
      "Use only the facts. Do not add details.",
    ].join(" ");

    const user = `Their question: ${message}\n\nFacts:\n${facts}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        max_tokens: 80,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    return shapeReply(content, items);
  } catch {
    return null;
  }
}

export async function answer(input: {
  message: string;
  category: Category;
  items: TaggedItem[];
  openaiKey?: string;
}): Promise<string> {
  try {
    const message = input.message ?? "";
    if (!wantsPolicy(message)) return GREETING;

    const selected = pickItems(input.category, input.items ?? []);
    const fallback = deterministicReply(message, selected);

    if (!input.openaiKey) return fallback;

    const phrased = await phraseWithOpenAI(message, selected, input.openaiKey);
    return phrased ?? fallback;
  } catch {
    return ERROR_REPLY;
  }
}
