import { choice, score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Category } from "./contracts.ts";

const CATEGORIES = [
  "bill-stuck",
  "local-worry",
  "lab-money",
  "research",
  "speech",
  "other",
] as const satisfies readonly Category[];

const CATEGORY_SET = new Set<string>(CATEGORIES);

/** Mengesha et al., arXiv:2604.21412, Table 2. */
export type Relevance = "high" | "medium" | "low" | "abstain";

const RELEVANCE_SET = new Set<string>(["high", "medium", "low", "abstain"]);

const RELEVANCE_WEIGHT: Record<Relevance, number> = {
  high: 1,
  medium: 0.62,
  low: 0.28,
  abstain: 0.08,
};

const SIGNIFICANCE_LEVELS = [
  "abstain",
  "low",
  "medium",
  "high",
] as const satisfies readonly Relevance[];

export type ScoredTag = { text: string; significance: number };

const MONITORING_QUESTION =
  "Among California communities where a data center is proposed or operating, how many disputes over water, power, noise, or jobs show up in a season?";

const FRAMEWORK =
  "Mengesha et al. 2026 (arXiv:2604.21412) Table 2. High is Tier 1, direct retrieval from an authoritative source. Medium is Tier 2, a partial record or proxy. Low is Tier 3, only an impression that would need expert elicitation. Abstain is Tier 4, the text cannot support even a rough estimate of harm or exposure.";

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

function isRelevance(value: unknown): value is Relevance {
  return typeof value === "string" && RELEVANCE_SET.has(value);
}

function tagFor(relevance: Relevance): ScoredTag[] {
  return [{ text: relevance, significance: RELEVANCE_WEIGHT[relevance] }];
}

function keywordCategory(text: string): Category {
  const lower = text.toLowerCase();
  if (/\b(bill|vote|filibuster|committee|statute)\b/.test(lower)) return "bill-stuck";
  if (/\b(data\s*center|town|district|neighborhood|water|noise|power)\b/.test(lower)) {
    return "local-worry";
  }
  if (/\b(funding|lab|startup|investment)\b/.test(lower)) return "lab-money";
  if (/\b(paper|study|journal)\b/.test(lower)) return "research";
  if (/\b(speech|hearing|transcript)\b/.test(lower)) return "speech";
  return "other";
}

function inMonitoringScope(text: string): boolean {
  const lower = text.toLowerCase();
  const california = /\bcalifornia\b/.test(lower);
  const exposure = /data[\s-]*centers?/.test(lower);
  const harm = /\b(water|power|grid|noise|jobs|dispute|permit)\b/.test(lower);
  return california && exposure && harm;
}

function fallbackRelevance(text: string): Relevance {
  if (!inMonitoringScope(text)) return "abstain";
  const lower = text.toLowerCase();
  if (/\b(registry|transparency report|official count|statute)\b/.test(lower)) return "high";
  if (/\b\d+\b/.test(lower)) return "medium";
  return "low";
}

function whoFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(resident|neighbor|community|town)\b/.test(lower)) return "residents";
  if (/\b(worker|job)\b/.test(lower)) return "workers";
  if (/\b(water|power|grid|ratepayer)\b/.test(lower)) return "water and power users";
  if (/\b(bill|vote|legislature|board|commission)\b/.test(lower)) return "lawmakers";
  if (/\b(company|lab|startup|developer)\b/.test(lower)) return "a company";
  return "no one named";
}

function significanceFromScore(value: number): Relevance {
  const index = Math.max(0, Math.min(SIGNIFICANCE_LEVELS.length - 1, Math.round(value)));
  return SIGNIFICANCE_LEVELS[index] ?? "abstain";
}

async function judgeWithJev(
  text: string,
  apiKey: string,
  source?: string,
): Promise<{ category: Category; relevance: Relevance; who: string } | null> {
  const client = new TypeSafeClient({ apiKey });
  const response = await client.systemOne({
    state: {
      monitoringQuestion: MONITORING_QUESTION,
      framework: FRAMEWORK,
      record: { source: source ?? "unknown", text },
    },
    questions: {
      who: choice("Who does `record` affect?", {
        residents: "People who live near the place in the record.",
        workers: "People whose jobs are at stake.",
        "water and power users": "People or towns whose water or electricity is affected.",
        "a company": "A lab, utility, or developer.",
        lawmakers: "A legislature, agency, or board that has to decide.",
        "no one named": "The record does not name a person or group that is affected.",
      }),
      significance: score(
        "How significant is `record` for `monitoringQuestion`, using the evidence tiers in `framework`?",
        [
          "Abstain. It cannot support a count of harm or exposure.",
          "Low. Only an impression, which would need an expert to guess a range.",
          "Medium. A partial record or proxy that could bound the count.",
          "High. An authoritative count that could be copied.",
        ],
      ),
      desk: choice("Which desk should read `record`?", {
        "bill-stuck": "A bill, vote, committee, or statute that has not moved.",
        "local-worry": "A community dispute over a place, water, power, noise, or jobs.",
        "lab-money": "Lab funding, a startup, or an investment.",
        research: "A study or a paper.",
        speech: "A speech, hearing, or transcript.",
        other: "None of the other desks.",
      }),
    },
  });
  const who = response.answers.who.choice;
  const category = response.answers.desk.choice;
  const relevance = significanceFromScore(response.answers.significance.score);
  if (typeof who !== "string" || !isCategory(category) || !isRelevance(relevance)) return null;
  return { category, relevance, who };
}

export async function categorise(
  text: string,
  apiKey?: string,
  source?: string,
): Promise<{ category: Category; relevance: Relevance; tags: ScoredTag[] }> {
  const fallback = {
    category: keywordCategory(text),
    relevance: fallbackRelevance(text),
  };

  if (typeof apiKey === "string" && apiKey.trim() !== "") {
    try {
      const remote = await judgeWithJev(text, apiKey.trim(), source);
      if (remote) {
        const weight = RELEVANCE_WEIGHT[remote.relevance];
        return {
          category: remote.category,
          relevance: remote.relevance,
          tags: [
            { text: remote.who, significance: weight },
            { text: remote.relevance, significance: weight },
          ],
        };
      }
    } catch {
      /* key missing or request failed */
    }
  }

  const weight = RELEVANCE_WEIGHT[fallback.relevance];
  return {
    category: fallback.category,
    relevance: fallback.relevance,
    tags: [
      { text: whoFromText(text), significance: weight },
      { text: fallback.relevance, significance: weight },
    ],
  };
}
