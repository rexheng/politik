// Rate limiting for the public endpoints that run the chat pipeline (/api/ask, /api/voice/think, the voice agent's
// function call and /telegram). Each run costs Groq tokens, and the free tier allows only 8,000 a minute, so one caller
// must not be able to use them all. The limit is the Workers Rate Limiting binding `ASK_LIMITER` (wrangler.jsonc),
// keyed on the caller's IP address as Cloudflare reports it in `CF-Connecting-IP`.
// With no binding (tests, `wrangler dev` without it) or no IP there is nothing to key on, so nothing is limited.
import type { ChatResponse } from "./chat/types.ts";

/** What a caller who is over the limit is told. */
export const BUSY_REPLY = "Politik is busy — please try again in a minute.";

/** The part of the Workers Rate Limiting binding this uses. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The response for a caller who is over the limit: the fallback mode with its one fixed line and nothing else. */
export function busyResponse(): ChatResponse {
  return { reply: BUSY_REPLY, mode: "fallback", citations: [], followUps: [], asOf: "" };
}

/** The address Cloudflare saw the request come from, or "" when it did not say (a local run). */
export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")?.trim() ?? "";
}

/**
 * True when the caller `key` (an IP address) has used up its allowance. With no limiter or no key it is false, and so is
 * a limiter that fails: a fault in the rate limiter must not turn every question away.
 */
export async function overLimit(env: { ASK_LIMITER?: RateLimiter }, key: string): Promise<boolean> {
  const limiter = env.ASK_LIMITER;
  if (!limiter || !key) return false;
  try {
    return !(await limiter.limit({ key })).success;
  } catch (error) {
    console.warn("limit: the rate limiter failed, so the request goes ahead", error instanceof Error ? error.name : "");
    return false;
  }
}
