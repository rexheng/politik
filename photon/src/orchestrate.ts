import { score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { AskCard, AskResponse, Category, ChatTurn, TaggedItem } from "./contracts.ts";
import { knownJurisdiction } from "./place.ts";
import {
  coverageNotes,
  discuss,
  focusCentres,
  isDataCentreQuestion,
  mismatchNote,
  present,
  readIntent,
  takeTop,
  topicQuestion,
  wantsExplanation,
  type Ranked,
} from "./select.ts";

export const GREETING = "What do you want to know?";
const EMPTY_REPLY = "I do not have a fresh update on that yet.";
const ERROR_REPLY = "I could not check that just now.";

const POLICY_ASK =
  /\b(?:bills?|votes?|voting|laws?|statutes?|legislation|senate|house|congress|committees?|filibusters?|hearings?|speeches|speech|transcripts?|data\s*cent(?:er|re)s?|datacent(?:er|re)s?|towns?|cities|city|counties|county|districts?|neighborhoods?|communities|community|places?|california|water|noise|grids?|power|sources?|papers?|studies|study|journals?|research|funding|funds|funded|labs?|startups?|investments?|investors?|chips?|transparency|policies|policy|regulations?|ai|saying|briefings?|updates?|happening|watch)\b|\b(?:sb|ab|hb|hr)\s*\d+\b|\bgoing on\b|\bcatch me up\b|\bbrief me\b|\bwhat(?:'s| is) new\b|\bpeople are saying\b|\bwhat to watch\b/;

const SOURCE_LABEL: Record<string, string> = {
  briefing: "briefing",
  openalex: "openalex",
  browserbase: "facebook group",
  "facebook-group": "facebook group",
  "facebook group": "facebook group",
  bluesky: "bluesky",
  "ca-ag": "California Attorney General",
  site: "data centre",
};

const FIT = [
  "Different subject. It would be a mismatch.",
  "Same broad theme, but it does not answer the question.",
  "On the subject, including from a different place or as a side issue.",
  "It answers the question.",
] as const;

function normalizeAsk(message: string): string {
  return message
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wantsPolicy(message: string, history: ChatTurn[] = []): boolean {
  const text = normalizeAsk(message);
  if (!text) return false;
  if (POLICY_ASK.test(text)) return true;
  if (readIntent(message) === "ask") return false;
  return history.some((turn) => turn.role === "user" && POLICY_ASK.test(normalizeAsk(turn.text)));
}

function shownTitles(history: ChatTurn[]): Set<string> {
  const titles = new Set<string>();
  for (const turn of history) {
    if (turn.role !== "assistant") continue;
    for (const title of turn.titles ?? []) {
      const clean = title.trim().toLowerCase();
      if (clean) titles.add(clean);
    }
  }
  return titles;
}

function rowKey(row: Ranked): string {
  return row.item.id || row.item.title;
}

async function dropWeakRelated(
  question: string,
  rows: Ranked[],
  apiKey?: string,
): Promise<Ranked[]> {
  const key = apiKey?.trim();
  const related = rows.filter((row) => row.relation === "related");
  if (!key || related.length === 0) return rows;
  try {
    const client = new TypeSafeClient({ apiKey: key });
    const questions: Record<string, ReturnType<typeof score>> = {};
    related.forEach((_, index) => {
      questions[`fit${index}`] = score(
        `How well does the candidate at \`candidates[${index}]\` answer \`question\`? Read its title, text, and place.`,
        [...FIT],
      );
    });
    const response = await client.systemOne(
      {
        state: {
          question,
          candidates: related.map((row) => ({
            title: row.item.title,
            text: row.item.plain.slice(0, 500),
            place: row.item.jurisdiction ?? "",
          })),
        },
        questions,
      },
      { timeout: 4000, retry: { maxRetries: 0 } },
    );
    const answers = response.answers as Record<string, { score?: number }>;
    const drop = new Set<string>();
    let zeros = 0;
    related.forEach((row, index) => {
      const value = answers[`fit${index}`]?.score;
      if (typeof value !== "number") return;
      if (Math.round(value) <= 0) {
        zeros += 1;
        drop.add(rowKey(row));
      }
    });
    if (zeros > related.length / 2) return rows;
    return rows.filter((row) => !drop.has(rowKey(row)));
  } catch {
    return rows;
  }
}

function sharedCategory(rows: Ranked[]): Category {
  const cats = rows.map((row) => row.item.category).filter((cat) => cat !== "other");
  if (cats.length === 0) return "other";
  const first = cats[0];
  return cats.every((cat) => cat === first) ? first : "other";
}

function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source.trim();
}

function toCard(row: Ranked, question: string): AskCard {
  const item = row.item;
  const card: AskCard = {
    title: item.title,
    plain: item.plain,
    relation: row.relation,
  };
  const source = sourceLabel(item.source);
  if (source) card.source = source;
  if (item.url) card.url = item.url;
  if (item.happenedAt) card.fetched = item.happenedAt;
  const place =
    item.jurisdiction && item.jurisdiction !== "Unplaced"
      ? item.jurisdiction
      : knownJurisdiction(`${item.title} ${item.plain}`, item.url);
  if (place) card.jurisdiction = place;
  if (row.relation === "related") {
    const note = mismatchNote(question, item);
    if (note) card.placeNote = note;
  }
  return card;
}

export async function answer(input: {
  message: string;
  items: TaggedItem[];
  history?: ChatTurn[];
  typesafeKey?: string;
}): Promise<AskResponse> {
  try {
    const message = input.message ?? "";
    const history = input.history ?? [];
    if (!wantsPolicy(message, history)) {
      if (readIntent(message) === "continue") {
        return { reply: "Which part do you mean?", category: "other", items: [] };
      }
      return { reply: GREETING, category: "other", items: [] };
    }

    const question = topicQuestion(message, history);
    const intent = readIntent(message);
    const explain = wantsExplanation(message, intent);
    let ranked = takeTop(question, input.items ?? []);
    if (explain && isDataCentreQuestion(question)) ranked = focusCentres(input.items ?? []);
    const withheld =
      intent === "ask" &&
      ranked.some((row) => row.relation === "related") &&
      !ranked.some((row) => row.relation === "answers");

    let rows = intent === "ask" ? ranked.filter((row) => row.relation === "answers") : ranked;
    if (intent !== "ask" && intent !== "continue" && !isDataCentreQuestion(question)) {
      rows = await dropWeakRelated(question, rows, input.typesafeKey);
    }

    let exhausted = false;
    if (intent === "more" || intent === "both") {
      const titles = shownTitles(history);
      const fresh = rows.filter((row) => !titles.has(row.item.title.trim().toLowerCase()));
      if (fresh.length > 0) rows = fresh;
      else if (rows.length > 0) exhausted = true;
    }

    const ordered = present(rows);
    const notes = coverageNotes(question, ordered);
    const earlier = history
      .filter((turn) => turn.role === "assistant")
      .map((turn) => turn.text)
      .join("\n");
    const reply = discuss({
      question,
      notes,
      items: ordered,
      withheld,
      exhausted,
      explain,
      earlier,
    });
    return {
      reply: reply || EMPTY_REPLY,
      category: explain && isDataCentreQuestion(question) ? "other" : sharedCategory(ordered),
      items: ordered.map((row) => toCard(row, question)),
    };
  } catch {
    return { reply: ERROR_REPLY, category: "other", items: [] };
  }
}
