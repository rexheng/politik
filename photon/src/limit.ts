// Rate limiting for the public endpoints that run the chat pipeline (/api/ask, /api/voice/think, the voice agent's
// function call and /telegram). Each run costs Groq tokens, and the free tier allows only 8,000 a minute, so one caller
// must not be able to use them all. The limit is the Workers Rate Limiting binding `ASK_LIMITER` (wrangler.jsonc),
// keyed on the caller's IP address as Cloudflare reports it in `CF-Connecting-IP` (an IPv6 address by its /64 prefix; a
// Telegram update whose secret was checked: on the chat id).
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

/**
 * The caller an IP address stands for. An IPv4 address is its own caller. One person holds a whole /64 of IPv6 addresses
 * (and can change address within it at will), so an IPv6 address is counted as its /64 prefix: `2001:db8:1:2::/64`. An
 * IPv4-mapped IPv6 address is the IPv4 address. Anything that is not an address is kept as it was written.
 */
function callerOf(address: string): string {
  if (!address.includes(":")) return address;
  let text = address.replace(/^\[|\]$/g, "").split("%")[0]!.trim();
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const octets = dotted.slice(2).map(Number);
    if (octets.some((n) => n > 255)) return address;
    text = `${dotted[1]}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return address;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  const groups = halves.length === 2 ? (fill >= 1 ? [...head, ...Array<string>(fill).fill("0"), ...tail] : []) : head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return address;
  const words = groups.map((g) => parseInt(g, 16));
  if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) {
    return `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`;
  }
  return `${words.slice(0, 4).map((w) => w.toString(16)).join(":")}::/64`;
}

/** The address to count a request against: the caller behind the one Cloudflare saw it come from (`CF-Connecting-IP`; an IPv6 address counts as its /64), or "" when there is none or the request is local, which is never limited. */
export function limitKey(request: Request): string {
  if (isLocal(request)) return "";
  const address = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  return address ? callerOf(address) : "";
}

/**
 * The key to count a Telegram update against. A `verified` update (TELEGRAM_WEBHOOK_SECRET is set and the request carried
 * it, so only Telegram can have sent it) is counted by the chat it came from, `telegram:<chat id>`: Telegram sends every
 * user's updates from its own few addresses, so the address would make all of them share one allowance. Anything else is
 * counted by the caller's address, because without the secret anyone can post an update with any chat id, and a made-up
 * chat id for each request would be a fresh allowance for each request. A local request is never limited.
 */
export function telegramLimitKey(request: Request, chatId: unknown, verified = false): string {
  if (isLocal(request)) return "";
  return verified && typeof chatId === "number" && Number.isFinite(chatId) ? `telegram:${chatId}` : limitKey(request);
}

/**
 * True when the caller `key` (an IP address, or `telegram:<chat id>`) has used up its allowance. With no limiter or no
 * key it is false, and so is a limiter that fails: a fault in the rate limiter must not turn every question away.
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
