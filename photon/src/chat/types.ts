// The shapes the chat pipeline passes between its steps (route, retrieve, rank, compose, cite) and the
// response `POST /api/ask` returns. See docs/superpowers/specs/2026-10-15-chatbot-synthesis-design.md §3 and §4.
import type { SourceItem } from "../contracts.ts";
import type { Jurisdiction, Passage, RecordSummary, RecordType, Status, Topic } from "../data/schema.ts";

export const INTENTS = ["greeting", "brief", "explain", "implications", "sentiment", "out-of-scope", "clarify"] as const;
export type Intent = (typeof INTENTS)[number];

/** What the router decides about a message. `standalone` is the question to ask the user when `intent` is `clarify`. */
export interface Route {
  intent: Intent;
  /** The user asked for depth ("explain in detail", "walk me through"). */
  detail: boolean;
  /** The follow-up rewritten as a self-contained question. */
  standalone: string;
  /** Keyword query for full-text search ("" when none). */
  search: string;
  jurisdiction?: Jurisdiction;
  topics?: Topic[];
  /** Records the user names, e.g. ["SB 53", "PDPA"]. */
  recordHints: string[];
  /** How far back "recent" reaches, in days (the retriever defaults to 120). */
  sinceDays?: number;
}

/** One numbered source the answer may cite. */
export interface Source {
  kind: "policy" | "post";
  /** When kind = "policy". */
  record?: RecordSummary;
  /** The quotable text, when kind = "policy". */
  passage?: Passage;
  /** When kind = "post". */
  post?: { text: string; url: string; author: string; at: string };
}

export interface Citation {
  /** Renumbered 1..k in order of first use. */
  n: number;
  kind: "policy" | "post";
  recordId?: string;
  passageId?: string;
  title: string;
  shortTitle?: string;
  url: string;
  jurisdiction?: Jurisdiction;
  type?: RecordType;
  status?: Status;
  fetched?: string;
  reviewState?: "auto-checked" | "human-reviewed";
  /** At most 280 characters from the passage or post. */
  quote: string;
}

export type Mode = "greeting" | "brief" | "detail" | "implications" | "sentiment" | "out-of-scope" | "clarify" | "fallback";

export interface ChatResponse {
  /** Markdown subset with [n] markers. */
  reply: string;
  mode: Mode;
  citations: Citation[];
  /** Labelled general knowledge (out-of-scope, or no sources). */
  general?: string;
  /** At most 3 suggested next questions. */
  followUps: string[];
  /** The manifest snapshot date ("" when D1 is empty). */
  asOf: string;
}

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type ChatInput = { message: string; history: ChatTurn[]; knowledge: SourceItem[] };

/** What the compose step's model returns. */
export type ComposeOut = { answer: string; general: string | null; followUps: string[] };
