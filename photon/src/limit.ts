// Rate limiting for the public endpoints that run the chat pipeline (/api/ask, /api/voice/think, the voice agent's
// function call and /telegram). Each run costs Groq tokens, and the free tier allows only 8,000 a minute, so one caller
// must not be able to use them all. The limit is the Workers Rate Limiting binding `ASK_LIMITER` (wrangler.jsonc),
// keyed on the caller's IP address as Cloudflare reports it in `CF-Connecting-IP`.
// With no binding (tests), no IP, or a local run (`wrangler dev` on localhost simulates the binding, so it would stop
// a developer, or the eval, after ten questions) there is nothing to count, so nothing is limited.
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

/** True for a request to this machine (`wrangler dev`). Cloudflare only routes a request to the Worker by its own host names, so a request in production never has one of these. */
function isLocal(request: Request): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

/** The address to count a request against: the one Cloudflare saw it come from (`CF-Connecting-IP`), or "" when there is none or the request is local, which is never limited. */
export function limitKey(request: Request): string {
  return isLocal(request) ? "" : (request.headers.get("CF-Connecting-IP")?.trim() ?? "");
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
