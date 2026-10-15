// The chat pipeline end to end (docs/superpowers/specs/2026-10-15-chatbot-synthesis-design.md §3 to §5):
//   route -> retrieve -> rank -> compose -> cite, with the failure behaviour of §5.
// `chat()` never throws. The surfaces (the /api/ask endpoint, voice and Telegram) call it through ask.ts.
import type { SourceItem, SourceName } from "../contracts.ts";
import type { D1Like } from "../data/d1.ts";
import { STOP_WORDS } from "../data/fts.ts";
import { getManifest, getRecord } from "../data/store.ts";
import { groqLlm, resolveChatModels } from "../llm/groq.ts";
import type { Llm } from "../llm/groq.ts";
import { searchPublicBluesky } from "../sources/bsky-search.ts";
import type { PublicBskyPost } from "../sources/bsky-search.ts";
import { citationOf, finalize, stripMarkers } from "./cite.ts";
import { compose, COMPOSE_TIMEOUT_MS, MAX_COMPOSE_SOURCES, shapeOf } from "./compose.ts";
import { rank, typesafeScorer } from "./rank.ts";
import type { Scorer } from "./rank.ts";
import { retrieve } from "./retrieve.ts";
import { fallbackRoute, route as routeQuestion, ROUTER_TIMEOUT_MS } from "./route.ts";
import type { ChatInput, ChatResponse, ChatTurn, Citation, Mode, Route, Source } from "./types.ts";
import { warnFailure } from "./warn.ts";

// ---- fixed copy ----------------------------------------------------------------------------------------------

export const GREETING = "Hi — ask me what's going on in California or Singapore tech policy.";
export const FALLBACK_REPLY = "I couldn't write a summary just now — here are the most relevant records.";
export const EMPTY_REPLY = "No policy data is loaded yet.";
/** Said when the answer could not be built at all and there are no records to point at. */
export const FAIL_REPLY = "I could not check that just now. Try again in a minute.";
/** Asked when the router wants more input but has no question of its own to put. */
export const CLARIFY_REPLY = "Which policy or topic do you mean? Name a bill or law, or say California or Singapore.";
/** The label for text that did not come from Politik's sources. */
export const GENERAL_LABEL = "Not from Politik's sources — unverified";

/** Suggested questions after a greeting (and a clarifying question): the front end's empty-state examples. */
export const GREETING_FOLLOW_UPS: readonly string[] = ["What's going on in California AI policy?", "Explain Singapore's PDPA", "What does SB 53 mean for a state agency?"];

// ---- the request ---------------------------------------------------------------------------------------------

export const MAX_MESSAGE_CHARS = 1000;
export const MAX_HISTORY_TURNS = 8;
export const MAX_TURN_CHARS = 600;
/** Saved posts a client may pass along, and how long their text and title may be. */
export const MAX_KNOWLEDGE_ITEMS = 50;
const MAX_KNOWLEDGE_TEXT_CHARS = 1200;
const MAX_KNOWLEDGE_TITLE_CHARS = 300;
const MAX_KNOWLEDGE_URL_CHARS = 2048;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** `text` cut to at most `max` characters, never between the halves of a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

/** A string trimmed and cut, or "" when it is not a string. */
const text = (value: unknown, max: number): string => (typeof value === "string" ? clip(value.trim(), max) : "");

/** The most recent turns that have a role and some text, oldest first, each cut to the turn limit. Anything else in a turn is ignored. */
function normalizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (let i = raw.length - 1; i >= 0 && turns.length < MAX_HISTORY_TURNS; i--) {
    const row = raw[i];
    if (!isRecord(row) || (row.role !== "user" && row.role !== "assistant")) continue;
    const turn = text(row.text, MAX_TURN_CHARS);
    if (turn) turns.push({ role: row.role, text: turn });
  }
  return turns.reverse();
}

/** The posts a client saved (from /saying), as source items. Only the fields below are kept. */
function normalizeKnowledge(raw: unknown): SourceItem[] {
  if (!Array.isArray(raw)) return [];
  const items: SourceItem[] = [];
  for (let i = 0; i < raw.length && items.length < MAX_KNOWLEDGE_ITEMS; i++) {
    const row = raw[i];
    if (!isRecord(row) || typeof row.title !== "string" || typeof row.plain !== "string") continue;
    const title = text(row.title, MAX_KNOWLEDGE_TITLE_CHARS);
    const plain = text(row.plain, MAX_KNOWLEDGE_TEXT_CHARS);
    if (!title && !plain) continue;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const happenedAt = text(row.happenedAt, 64);
    const author = text(row.author, 200);
    const jurisdiction = text(row.jurisdiction, 64);
    items.push({
      id: text(row.id, 200) || `kb-${i}`,
      source: (text(row.source, 64) || "bluesky") as SourceName,
      title,
      plain,
      ...(url && url.length <= MAX_KNOWLEDGE_URL_CHARS ? { url } : {}),
      ...(happenedAt ? { happenedAt } : {}),
      ...(author ? { author } : {}),
      ...(jurisdiction && jurisdiction !== "Unplaced" ? { jurisdiction } : {}),
    });
  }
  return items;
}

/**
 * What a client may send to /api/ask, cut to the limits (spec §4): a message of at most 1,000 characters, the last
 * 8 turns of at most 600, and up to 50 saved posts. Too much is cut, never refused; a missing or odd field is empty.
 */
export function normalizeChatRequest(body: unknown): ChatInput {
  const o = isRecord(body) ? body : {};
  return { message: text(o.message, MAX_MESSAGE_CHARS), history: normalizeHistory(o.history), knowledge: normalizeKnowledge(o.knowledge) };
}

// ---- the dependencies ------------------------------------------------------------------------------------------

export type ChatEnv = {
  DB: D1Like;
  GROQ_API_KEY?: string;
  GROQ_CHAT_MODEL?: string;
  GROQ_ROUTER_MODEL?: string;
  TYPESAFE_API_KEY?: string;
};

export type ChatDeps = {
  router?: Llm;
  composer?: Llm;
  scorer?: Scorer;
  bluesky?: (q: string) => Promise<SourceItem[]>;
  /** For tests: how long the compose model gets before the fallback (default 8,000 ms). */
  composeTimeoutMs?: number;
};

/**
 * Words that say nothing about what a post is about, beside what full-text search already drops. The two place names
 * are here because the post search is not tied to a place: "California" in a question must not let any post that merely
 * mentions California through.
 */
const FILLER = new Set("about people think thinks thought saying says said public opinion opinions feel feels talk talking tell california singapore".split(" "));

/** The words of a question worth looking for in a post: four letters or more, no filler, "centre" spelled "center". */
function queryWords(query: string): string[] {
  const words = query.normalize("NFKC").toLowerCase().replaceAll("centre", "center").split(/[^\p{L}\p{N}]+/u);
  return [...new Set(words.filter((w) => w.length >= 4 && !STOP_WORDS.has(w) && !FILLER.has(w)))];
}

/**
 * Public Bluesky posts for a question, as source items. The search behind it is fixed on data centres and takes no
 * query, so a post is kept only when it mentions a word of the question: a question about something else gets no
 * posts, not unrelated ones.
 */
export async function publicBlueskyItems(query: string, search: () => Promise<{ posts: PublicBskyPost[] }> = searchPublicBluesky): Promise<SourceItem[]> {
  const wanted = queryWords(query);
  if (wanted.length === 0) return [];
  const { posts } = await search();
  return posts.flatMap((post, i) => {
    const haystack = `${post.title} ${post.plain}`.toLowerCase().replaceAll("centre", "center");
    if (!wanted.some((word) => haystack.includes(word))) return [];
    return [{ id: `bsky-${i}`, source: "bluesky", title: post.title, plain: post.plain, url: post.url, happenedAt: post.happenedAt, author: post.author }];
  });
}

/**
 * The Worker's dependencies from its environment. The Groq client's own defaults (60 s, 5 attempts) are for batch
 * builds, so the router gets 3 s and no retry and compose 8 s and one retry. Both think at `low` effort: routing and
 * writing a cited brief from numbered sources need little reasoning, and on Groq's free tier (8,000 tokens a minute)
 * the default medium effort spends the budget on thinking. With no GROQ_API_KEY there are no models (the rule-based
 * route and the fallback reply are used); with no TYPESAFE_API_KEY there is no ranking.
 */
export function chatDepsFromEnv(env: ChatEnv, make: typeof groqLlm = groqLlm): ChatDeps {
  const deps: ChatDeps = { bluesky: (q) => publicBlueskyItems(q) };
  const groqKey = env.GROQ_API_KEY?.trim();
  if (groqKey) {
    const models = resolveChatModels({ GROQ_CHAT_MODEL: env.GROQ_CHAT_MODEL, GROQ_ROUTER_MODEL: env.GROQ_ROUTER_MODEL });
    deps.router = make({ apiKey: groqKey, model: models.router, timeoutMs: ROUTER_TIMEOUT_MS, maxRetries: 0, reasoningEffort: "low" });
    deps.composer = make({ apiKey: groqKey, model: models.compose, timeoutMs: COMPOSE_TIMEOUT_MS, maxRetries: 1, reasoningEffort: "low" });
  }
  const typesafeKey = env.TYPESAFE_API_KEY?.trim();
  if (typesafeKey) deps.scorer = typesafeScorer(typesafeKey);
  return deps;
}

// ---- responses ----------------------------------------------------------------------------------------------------

/** A response that is not an answer: no records, no suggestions. */
function notAnAnswer(reply: string, asOf: string): ChatResponse {
  return { reply, mode: "fallback", citations: [], followUps: [], asOf };
}

/** The response when the answer could not be built at all (an unexpected error). `asOf` is the snapshot date if it was already read. */
export function failureResponse(asOf = ""): ChatResponse {
  return notAnAnswer(FAIL_REPLY, asOf);
}

const greeting = (asOf: string): ChatResponse => ({ reply: GREETING, mode: "greeting", citations: [], followUps: [...GREETING_FOLLOW_UPS], asOf });

const sameWords = (a: string, b: string) => {
  const flat = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return flat(a) === flat(b);
};

/** The router's question to the user, unless it only repeats what they said. */
function clarify(route: Route, message: string, asOf: string): ChatResponse {
  const asked = stripMarkers(route.standalone).trim();
  const reply = asked && !sameWords(asked, message) ? asked : CLARIFY_REPLY;
  return { reply, mode: "clarify", citations: [], followUps: [...GREETING_FOLLOW_UPS], asOf };
}

/** `sentiment` and `out-of-scope` are their own modes; anything else takes the shape the answer was composed in. */
function modeOf(route: Route): Mode {
  if (route.intent === "sentiment" || route.intent === "out-of-scope") return route.intent;
  return shapeOf(route);
}

/**
 * `citations` with `fetched` (YYYY-MM-DD) added to each policy citation, read from its full record (spec §6: a card shows
 * when the source was fetched). One read per distinct record, all at once. A read that fails, or a record that is gone,
 * leaves that citation without `fetched`; this never throws.
 */
async function withFetched(citations: Citation[], db: D1Like): Promise<Citation[]> {
  const ids = [...new Set(citations.flatMap((c) => (c.kind === "policy" && c.recordId ? [c.recordId] : [])))];
  if (ids.length === 0) return citations;
  const days = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const day = /^\d{4}-\d{2}-\d{2}/.exec((await getRecord(db, id))?.fetched ?? "")?.[0];
        if (day) days.set(id, day);
      } catch (error) {
        console.warn("chat: could not read when a record was fetched", id, error);
      }
    }),
  );
  return citations.map((c) => {
    const fetched = c.recordId ? days.get(c.recordId) : undefined;
    return fetched ? { ...c, fetched } : c;
  });
}

/** True when `reply` has a letter or digit outside its [n] markers: a reply that is only markers says nothing. */
const hasWords = (reply: string): boolean => /[\p{L}\p{N}]/u.test(stripMarkers(reply));

const FALLBACK_RECORDS = 3;

/**
 * The fallback (spec §5): the top records that were retrieved, each quoting the start of its summary. A source with no
 * usable link is skipped, and so is a record that is already listed. With none left it is a plain failure reply.
 */
async function fallback(sources: Source[], asOf: string, db: D1Like): Promise<ChatResponse> {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const source of sources) {
    if (citations.length === FALLBACK_RECORDS) break;
    const key = source.kind === "post" ? `post:${source.post?.url}` : `policy:${source.record?.id}`;
    if (seen.has(key)) continue;
    // A record is quoted from its summary, not from the passage that was retrieved (unless it has no summary).
    const quoted: Source = source.kind === "policy" && source.record?.summary.trim() ? { kind: "policy", record: source.record } : source;
    const citation = citationOf(quoted, citations.length + 1);
    if (!citation) continue; // no usable link
    seen.add(key);
    citations.push(citation);
  }
  return { reply: citations.length ? FALLBACK_REPLY : FAIL_REPLY, mode: "fallback", citations: await withFetched(citations, db), followUps: [], asOf };
}

// ---- the pipeline ----------------------------------------------------------------------------------------------------

/**
 * Answers a message from the policy dataset (spec §3 and §5). Whatever goes wrong, this returns a response: a missing
 * dataset is "No policy data is loaded yet.", a compose failure is the fallback with the top 3 records, and an
 * unexpected error is a plain failure reply. `deps` overrides what `chatDepsFromEnv(env)` builds.
 */
export async function chat(input: ChatInput, env: ChatEnv, deps: ChatDeps = {}): Promise<ChatResponse> {
  // The snapshot date, once it has been read, so that an error after that still says what the data is as of (M9).
  const known = { asOf: "" };
  try {
    const req = normalizeChatRequest(input);
    const built = chatDepsFromEnv(env);
    return await respond(
      req,
      env.DB,
      {
        router: deps.router ?? built.router,
        composer: deps.composer ?? built.composer,
        scorer: deps.scorer ?? built.scorer,
        bluesky: deps.bluesky ?? built.bluesky,
        composeTimeoutMs: deps.composeTimeoutMs,
      },
      known,
    );
  } catch (error) {
    warnFailure("answer", error);
    return failureResponse(known.asOf);
  }
}

async function respond(req: ChatInput, db: D1Like, deps: ChatDeps, known: { asOf: string }): Promise<ChatResponse> {
  const manifest = await getManifest(db);
  if (!manifest) return notAnAnswer(EMPTY_REPLY, "");
  const asOf = manifest.snapshotDate;
  known.asOf = asOf;

  // A blank message has nothing to ask; it gets the greeting without a model call.
  if (!req.message) return greeting(asOf);
  const decided = deps.router ? await routeQuestion(req.message, req.history, deps.router) : fallbackRoute(req.message, req.history);
  if (decided.intent === "greeting") return greeting(asOf);
  if (decided.intent === "clarify") return clarify(decided, req.message, asOf);

  const retrieved = await retrieve(decided, db, { manifest, bluesky: deps.bluesky, knowledge: req.knowledge });
  // An out-of-scope question the dataset does cover is answered as an explain.
  const route: Route = retrieved.promoted ? { ...decided, intent: "explain" } : decided;
  // Retrieval and ranking may hold up to 12 sources; only the best 8 go to the model and into the answer's numbering.
  const sources = (await rank(route, retrieved.sources, deps.scorer)).slice(0, MAX_COMPOSE_SOURCES);

  if (!deps.composer) return fallback(sources, asOf, db);
  try {
    const raw = await compose(route, sources, deps.composer, asOf, { timeoutMs: deps.composeTimeoutMs });
    const { reply, citations: cited, valid } = finalize(raw, sources);
    // No valid marker, or no words outside the markers ("[1]" alone), is a compose failure (spec §3.5).
    if (valid && hasWords(reply)) {
      return {
        reply,
        mode: modeOf(route),
        citations: await withFetched(cited, db),
        ...(raw.general ? { general: raw.general } : {}),
        followUps: raw.followUps,
        asOf,
      };
    }
  } catch (error) {
    warnFailure("compose", error);
  }
  return fallback(sources, asOf, db);
}
