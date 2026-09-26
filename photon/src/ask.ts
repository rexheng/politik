import type {
  AskResponse,
  Category,
  ChatTurn,
  SourceItem,
  SourceName,
  TaggedItem,
} from "./contracts.ts";
import { categorise } from "./categoriser.ts";
import { answer, wantsPolicy } from "./orchestrate.ts";
import { loadBriefings } from "./briefings.ts";
import { catalogItems, siteItems, topicQuestion } from "./select.ts";
import { fetchOpenAlex } from "./sources/openalex.ts";
import { transcribeSpeech } from "./sources/elevenlabs.ts";

export interface Env {
  ASSETS: Fetcher;
  TYPESAFE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  DEEPGRAM_API_KEY?: string;
  MAPBOX_ACCESS_TOKEN?: string;
}

const CATEGORIES = new Set<string>([
  "bill-stuck",
  "local-worry",
  "lab-money",
  "research",
  "speech",
  "other",
]);

export async function ask(
  message: string,
  env: Env,
  audioUrl?: string,
  knowledge?: unknown,
  _who?: unknown,
  history?: unknown,
): Promise<AskResponse> {
  const turns = normalizeHistory(history);
  if (!wantsPolicy(message, turns)) {
    return answer({ message, items: [], history: turns });
  }

  const known = normalizeKnowledge(knowledge);
  const topic = topicQuestion(message, turns);
  const [openalexItems, speechItems] = await Promise.all([
    fetchOpenAlex(topic.slice(0, 300)),
    audioUrl
      ? transcribeSpeech({
          apiKey: env.ELEVENLABS_API_KEY,
          audioUrl,
        })
      : Promise.resolve([] as SourceItem[]),
  ]);
  const taggedSources = await Promise.all(
    [...openalexItems, ...speechItems].map((item) => tagItem(item, env.TYPESAFE_API_KEY)),
  );
  const pool = dedupe([
    ...loadBriefings(),
    ...catalogItems(),
    ...siteItems(),
    ...known,
    ...taggedSources,
  ]);
  return answer({
    message,
    items: pool,
    history: turns,
    typesafeKey: env.TYPESAFE_API_KEY,
  });
}

const inflightAsks = new Map<string, Promise<AskResponse>>();

function askKey(message: string, knowledge: unknown, history: unknown): string {
  const text = message.trim().toLowerCase().replace(/\s+/g, " ");
  let notes = "";
  let prior = "";
  try {
    if (knowledge !== undefined) notes = JSON.stringify(knowledge);
    if (history !== undefined) prior = JSON.stringify(history);
  } catch {
    notes = "";
    prior = "";
  }
  return `${text}\n${notes}\n${prior}`;
}

export function askShared(
  message: string,
  env: Env,
  audioUrl?: string,
  knowledge?: unknown,
  who?: unknown,
  history?: unknown,
): Promise<AskResponse> {
  const key = askKey(message, knowledge, history);
  const existing = inflightAsks.get(key);
  if (existing) return existing;
  const work = ask(message, env, audioUrl, knowledge, who, history).finally(() => {
    if (inflightAsks.get(key) === work) inflightAsks.delete(key);
  });
  inflightAsks.set(key, work);
  return work;
}

function dedupe(items: TaggedItem[]): TaggedItem[] {
  const seen = new Set<string>();
  const out: TaggedItem[] = [];
  for (const item of items) {
    const key = item.title.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const role = record.role === "assistant" || record.role === "user" ? record.role : null;
    if (!role || typeof record.text !== "string") continue;
    const text = record.text.trim().slice(0, 2000);
    if (!text) continue;
    const titles = Array.isArray(record.titles)
      ? record.titles
          .filter((title): title is string => typeof title === "string" && title.trim() !== "")
          .slice(0, 8)
      : undefined;
    const turn: ChatTurn = { role, text };
    if (titles && titles.length > 0) turn.titles = titles;
    out.push(turn);
  }
  return out.slice(-8);
}

function normalizeKnowledge(raw: unknown): TaggedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TaggedItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.title !== "string" || typeof row.plain !== "string") continue;
    const category =
      typeof row.category === "string" && CATEGORIES.has(row.category)
        ? (row.category as Category)
        : "other";
    const tags = Array.isArray(row.tags)
      ? row.tags
          .map((t) => {
            if (typeof t === "string") return t;
            if (t && typeof t === "object" && typeof (t as { text?: unknown }).text === "string") {
              return (t as { text: string }).text;
            }
            return "";
          })
          .filter(Boolean)
      : [];
    const source =
      typeof row.source === "string" ? (row.source as SourceName) : "briefing";
    const tagged: TaggedItem = {
      id: typeof row.id === "string" ? row.id : `kb-${i}`,
      source,
      title: row.title,
      plain: row.plain,
      category,
      tags,
    };
    if (typeof row.url === "string" && row.url) tagged.url = row.url;
    if (typeof row.happenedAt === "string" && row.happenedAt.trim()) {
      tagged.happenedAt = row.happenedAt.trim();
    }
    if (
      typeof row.jurisdiction === "string" &&
      row.jurisdiction.trim() &&
      row.jurisdiction.trim() !== "Unplaced"
    ) {
      tagged.jurisdiction = row.jurisdiction.trim();
    }
    out.push(tagged);
  }
  return out;
}

async function tagItem(item: SourceItem, apiKey?: string): Promise<TaggedItem> {
  const { category, tags } = await categorise(
    `${item.title}. ${item.plain}`,
    apiKey,
    item.source,
  );
  return { ...item, category, tags: tags.map((t) => t.text) };
}
