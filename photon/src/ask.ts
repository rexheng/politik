import type {
  AskResponse,
  Category,
  SourceItem,
  SourceName,
  TaggedItem,
} from "./contracts.ts";
import { categorise } from "./categoriser.ts";
import { answer, wantsPolicy } from "./orchestrate.ts";
import { loadBriefings } from "./briefings.ts";
import { knownJurisdiction } from "./place.ts";
import { fetchOpenAlex } from "./sources/openalex.ts";
import { transcribeSpeech } from "./sources/elevenlabs.ts";

export interface Env {
  ASSETS: Fetcher;
  TYPESAFE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  DEEPGRAM_API_KEY?: string;
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
): Promise<AskResponse> {
  if (!wantsPolicy(message)) {
    return {
      reply: await answer({ message, category: "other", items: [] }),
      category: "other",
      items: [],
    };
  }

  const { category } = await categorise(message, env.TYPESAFE_API_KEY);
  const known = normalizeKnowledge(knowledge);

  let pool: TaggedItem[];
  if (known.length > 0) {
    pool = known;
  } else {
    const [openalexItems, speechItems] = await Promise.all([
      fetchOpenAlex(message),
      audioUrl
        ? transcribeSpeech({
            apiKey: env.ELEVENLABS_API_KEY,
            audioUrl,
          })
        : Promise.resolve([] as SourceItem[]),
    ]);
    const taggedSources = await Promise.all(
      [...openalexItems, ...speechItems].map((item) =>
        tagItem(item, env.TYPESAFE_API_KEY),
      ),
    );
    pool = [...loadBriefings(), ...taggedSources];
  }

  const matching = preferMatching(category, pool);
  const reply = await answer({
    message,
    category,
    items: matching,
    openaiKey: env.OPENAI_API_KEY,
  });

  return {
    reply,
    category,
    items: toResponseItems(matching),
  };
}

const inflightAsks = new Map<string, Promise<AskResponse>>();

function askKey(message: string, knowledge: unknown): string {
  const text = message.trim().toLowerCase().replace(/\s+/g, " ");
  let notes = "";
  if (knowledge !== undefined) {
    try {
      notes = JSON.stringify(knowledge);
    } catch {
      notes = "";
    }
  }
  return `${text}\n${notes}`;
}

export function askShared(
  message: string,
  env: Env,
  audioUrl?: string,
  knowledge?: unknown,
  who?: unknown,
): Promise<AskResponse> {
  const key = askKey(message, knowledge);
  const existing = inflightAsks.get(key);
  if (existing) return existing;
  const work = ask(message, env, audioUrl, knowledge, who).finally(() => {
    if (inflightAsks.get(key) === work) inflightAsks.delete(key);
  });
  inflightAsks.set(key, work);
  return work;
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

function preferMatching(category: Category, items: TaggedItem[]): TaggedItem[] {
  const matched = items.filter((item) => item.category === category);
  return matched.length > 0 ? matched : items;
}

const SOURCE_LABEL: Record<string, string> = {
  briefing: "briefing",
  openalex: "openalex",
  browserbase: "facebook group",
  "facebook-group": "facebook group",
  "facebook group": "facebook group",
  bluesky: "bluesky",
};

function auditSource(source: string): string {
  const named = SOURCE_LABEL[source];
  if (named) return named;
  return source.trim();
}

function toResponseItems(items: TaggedItem[]): AskResponse["items"] {
  return items.slice(0, 4).map((item) => {
    const out: AskResponse["items"][number] = {
      title: item.title,
      plain: item.plain,
    };
    const source = auditSource(item.source);
    if (source) out.source = source;
    if (item.url) out.url = item.url;
    if (item.happenedAt) out.fetched = item.happenedAt;
    const place =
      item.jurisdiction && item.jurisdiction !== "Unplaced"
        ? item.jurisdiction
        : knownJurisdiction(`${item.title} ${item.plain}`, item.url);
    if (place) out.jurisdiction = place;
    return out;
  });
}
