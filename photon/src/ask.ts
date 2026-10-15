import { chat, normalizeChatRequest } from "./chat/index.ts";
import type { ChatResponse } from "./chat/types.ts";
import type { D1Like } from "./data/d1.ts";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Like;
  GROQ_API_KEY?: string;
  GROQ_CHAT_MODEL?: string;
  GROQ_ROUTER_MODEL?: string;
  TYPESAFE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  DEEPGRAM_API_KEY?: string;
  MAPBOX_ACCESS_TOKEN?: string;
}

/**
 * Answers a question. `knowledge` (posts the client saved from /saying) and `history` (the earlier turns) are read
 * as untrusted input and cut to the limits in `normalizeChatRequest`. It never throws.
 */
export function ask(message: string, env: Env, knowledge?: unknown, history?: unknown): Promise<ChatResponse> {
  return chat(normalizeChatRequest({ message, knowledge, history }), env);
}

const inflightAsks = new Map<string, Promise<ChatResponse>>();

/** What makes two questions the same: the words (case and spacing aside), the saved posts and the earlier turns. */
function askKey(message: string, knowledge: unknown, history: unknown): string {
  const input = normalizeChatRequest({ message, knowledge, history });
  return `${input.message.toLowerCase().replace(/\s+/g, " ")}\n${JSON.stringify(input.knowledge)}\n${JSON.stringify(input.history)}`;
}

/** Like `ask`, but a question already being answered gives the same answer to everyone who asks it meanwhile. */
export function askShared(message: string, env: Env, knowledge?: unknown, history?: unknown): Promise<ChatResponse> {
  const key = askKey(message, knowledge, history);
  const existing = inflightAsks.get(key);
  if (existing) return existing;
  const work = ask(message, env, knowledge, history).finally(() => {
    if (inflightAsks.get(key) === work) inflightAsks.delete(key);
  });
  inflightAsks.set(key, work);
  return work;
}
