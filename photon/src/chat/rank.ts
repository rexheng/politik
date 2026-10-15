// Step 3 of the chat pipeline: put the retrieved sources in order of importance.
// One TypeSafe (Jev) call scores every candidate. The call is optional and has a deadline: with no scorer, a timeout, an
// error or an answer that is not scores, the store's order is kept. Ranking only reorders; it never adds or drops a source.
// Spec §3.3; the call follows `dropWeakRelated` in ../orchestrate.ts and .agents/skills/typesafe-ai/SKILL.md.
import { score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Route, Source } from "./types.ts";

/** The 2,500 ms rank budget. */
export const RANK_TIMEOUT_MS = 2500;

/** Who a brief's candidates are judged to matter to. */
const BRIEF_AUDIENCE = "a California or Singapore tech policymaker";

/** What a brief's candidates are judged on. */
export const BRIEF_JUDGEMENT = `significance to ${BRIEF_AUDIENCE}`;

const RELEVANCE_PREFIX = "relevance to: ";

/** What every other intent's candidates are judged on. */
export const relevanceJudgement = (standalone: string) => `${RELEVANCE_PREFIX}${standalone}`;

/** Scores candidates against a judgement: a higher number is a better fit. A candidate it leaves out sorts last. */
export type Scorer = (question: string, candidates: { id: string; text: string }[]) => Promise<Record<string, number>>;

/** The candidate's passage or post is cut to this many characters before it is scored, to keep the request small. */
const CANDIDATE_CHARS = 600;

/**
 * The levels of a brief's "significance", from nothing to the most weighty. Each describes a concrete kind of event
 * and stands on its own (TypeSafe reads the levels without the question's other context).
 */
export const SIGNIFICANCE_LEVELS = [
  "A routine announcement or minor procedural step that changes nothing for policymakers, such as a meeting notice, a technical correction or a reprint of an existing text.",
  "A development worth knowing about that does not yet change anyone's obligations, such as a bill introduced, a consultation opened, or a guidance note or report published.",
  "A material step that moves a measure forward or sets its direction, such as a bill passing a chamber, a regulator proposing a rule, a non-binding framework released, or a large government contract awarded.",
  "A new binding law, regulation or major ruling that changes obligations or powers in California or Singapore tech policy, such as a bill signed or vetoed, or a rule taking effect.",
] as const;

/** The levels of how well a candidate answers the user's question, from unrelated to a direct answer. */
export const RELEVANCE_LEVELS = [
  "About something else: it has no bearing on what was asked, even if it is also California or Singapore tech policy.",
  "The same general area but a different subject: another law, another place, or a side issue the question did not ask about.",
  "Bears on the question: it covers part of what was asked, or the right subject without the specific point wanted.",
  "Answers the question directly: it states the rule, status, date, effect or (for a public post) the view that the question asks about.",
] as const;

interface Plan {
  /** What every question shares besides the candidates. */
  state: Record<string, string>;
  levels: readonly [string, string, ...string[]];
  /** One candidate's question. */
  ask(index: number): string;
}

/** What one TypeSafe call asks for, depending on the judgement. */
function judgementPlan(judgement: string): Plan {
  if (judgement === BRIEF_JUDGEMENT) {
    return {
      state: { audience: BRIEF_AUDIENCE },
      levels: SIGNIFICANCE_LEVELS,
      ask: (i: number) =>
        `How significant is the item at \`candidates[${i}].text\` to \`audience\`? It is either policy text or a public social-media post; weigh what it changes or signals for them, not its length or tone.`,
    };
  }
  return {
    state: { question: judgement.startsWith(RELEVANCE_PREFIX) ? judgement.slice(RELEVANCE_PREFIX.length) : judgement },
    levels: RELEVANCE_LEVELS,
    ask: (i: number) =>
      `How relevant is the item at \`candidates[${i}].text\` to \`question\`? It is either policy text or a public social-media post; weigh how directly it addresses what was asked, not its length or tone.`,
  };
}

/** The part of TypeSafeClient the scorer uses, so a test can stand in for it. */
export type SystemOne = Pick<TypeSafeClient, "systemOne">;

/**
 * A scorer backed by TypeSafe's Jev model: one `systemOne` call with one score question per candidate, each judged
 * against the same `judgement`. A brief's significance and a question's relevance have their own wording and levels.
 * The call has no retries and gives up after the rank budget. The client is made on first use, so a bad key is an
 * error at that point (which `rank` absorbs) rather than at construction.
 */
export function typesafeScorer(apiKey: string, client?: SystemOne): Scorer {
  let own: SystemOne | undefined;
  return async (judgement, candidates) => {
    if (candidates.length === 0) return {};
    const typesafe = client ?? (own ??= new TypeSafeClient({ apiKey }));
    const plan = judgementPlan(judgement);
    const questions: Record<string, ReturnType<typeof score>> = {};
    candidates.forEach((_, i) => {
      questions[`fit${i}`] = score(plan.ask(i), [...plan.levels]);
    });
    const response = await typesafe.systemOne(
      { state: { ...plan.state, candidates: candidates.map((c) => ({ text: c.text })) }, questions },
      { timeout: RANK_TIMEOUT_MS, retry: { maxRetries: 0 } },
    );
    const answers = response.answers as Record<string, { score?: unknown } | undefined>;
    const scores: Record<string, number> = {};
    candidates.forEach((c, i) => {
      const value = answers[`fit${i}`]?.score;
      if (typeof value === "number" && Number.isFinite(value)) scores[c.id] = value;
    });
    return scores;
  };
}

/** What the scorer reads for one source: its title and place with the passage or post. */
function candidateText(source: Source): string {
  if (source.kind === "post" && source.post) {
    const { text, author, at } = source.post;
    return `Public post${author ? ` by ${author}` : ""}${at ? ` on ${at}` : ""}: ${text.slice(0, CANDIDATE_CHARS)}`;
  }
  const record = source.record;
  const body = source.passage ? `${source.passage.heading ? `${source.passage.heading}: ` : ""}${source.passage.text}` : (record?.summary ?? "");
  if (!record) return body.slice(0, CANDIDATE_CHARS);
  const name = record.shortTitle ? `${record.shortTitle} (${record.title})` : record.title;
  return `${name}, ${record.jurisdiction} ${record.type}, ${record.status}, last activity ${record.lastActivity}. ${body.slice(0, CANDIDATE_CHARS)}`;
}

/** One candidate per source, each with an id that is unique even if two sources share a passage or URL. */
function candidatesOf(sources: Source[]): { id: string; text: string }[] {
  const used = new Set<string>();
  return sources.map((source, i) => {
    const base = source.passage?.id ?? (source.post?.url ? `post:${source.post.url}` : `source-${i}`);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}~${n}`;
    used.add(id);
    return { id, text: candidateText(source) };
  });
}

/**
 * The sources sorted by score, best first, ties in their input order. A brief is judged on significance to a
 * policymaker, every other intent on relevance to the standalone question. With no scorer, fewer than two sources, a
 * scorer that errors, answers oddly or does not answer within `timeoutMs`, the input comes back as it was.
 */
export async function rank(route: Route, sources: Source[], scorer?: Scorer, timeoutMs = RANK_TIMEOUT_MS): Promise<Source[]> {
  if (!scorer || sources.length < 2) return sources;
  const candidates = candidatesOf(sources);
  const judgement = route.intent === "brief" ? BRIEF_JUDGEMENT : relevanceJudgement(route.standalone);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = (async () => scorer(judgement, candidates))();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`The ranker did not answer within ${timeoutMs} ms`)), timeoutMs);
    });
    const scores = await Promise.race([answer, deadline]);
    if (typeof scores !== "object" || scores === null) return sources;
    const valueOf = (id: string): number => {
      const value = Object.hasOwn(scores, id) ? scores[id] : undefined;
      return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
    };
    return sources
      .map((source, index) => ({ source, index, value: valueOf(candidates[index]!.id) }))
      .sort((a, b) => (a.value === b.value ? a.index - b.index : b.value - a.value))
      .map((entry) => entry.source);
  } catch {
    return sources;
  } finally {
    clearTimeout(timer);
  }
}
