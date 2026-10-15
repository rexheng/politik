import { askShared, type Env } from "./ask.ts";
import { failureResponse, normalizeChatRequest } from "./chat/index.ts";
import { loadMap } from "./map.ts";
import { BLUESKY_URL, GROUP_URL, buildSaying } from "./saying.ts";
import { loadCatalog } from "./catalog.ts";
import { BUSY_REPLY, busyResponse, limitKey, overLimit, overVoiceLimit } from "./limit.ts";
import { proxyAgent, proxyListen, speak, think } from "./voice.ts";

export type { Env };

function json(data: unknown, status = 200, cache?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cache) headers["cache-control"] = cache;
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function failResponse(): Response {
  return json(failureResponse());
}

/**
 * A 403 for a browser request that comes from a page on another site, or null. A browser says which page a request comes
 * from in `Origin`; one whose host is not this Worker's own is some other site using our endpoints (and the owner's
 * Groq and Deepgram keys) from its visitors' browsers. A request that has no `Origin`, such as a `<script>`, `<img>` or
 * no-cors fetch from another site, is still told apart by `Sec-Fetch-Site`, which a browser sets on every request itself and a
 * page cannot change: `cross-site` is refused; `same-origin`, `same-site`, `none` (the person typed the address) and no header
 * at all are not. A script that is not a browser can send whatever headers it likes, so this is no defence against scripts:
 * the rate limits are.
 */
function crossOrigin(request: Request): Response | null {
  const refuse = () => json({ error: "Requests from other sites are not allowed." }, 403);
  if (request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase() === "cross-site") return refuse();
  const origin = request.headers.get("Origin");
  if (origin === null) return null;
  try {
    if (new URL(origin).host === new URL(request.url).host) return null;
  } catch {
    // an Origin that is not a URL ("null" from a sandboxed page, or nonsense) is not this site
  }
  return refuse();
}

/**
 * The 429 for a caller who is over the limit on something that is not a chat answer (an error, not a reply the page shows),
 * or null. Opening a voice socket is counted on `VOICE_LIMITER`; everything else on `ASK_LIMITER`.
 */
async function busyError(request: Request, env: Env, limiter: "ask" | "voice" = "ask"): Promise<Response | null> {
  const over = limiter === "voice" ? await overVoiceLimit(env, limitKey(request)) : await overLimit(env, limitKey(request));
  return over ? json({ error: BUSY_REPLY }, 429) : null;
}

/** The most a spoken-reply request may say (characters), and the most body it is read for (bytes). */
const MAX_SPEAK_CHARS = 2000;
const MAX_SPEAK_BODY_BYTES = 10_000;

/**
 * The text of a request body, or null when it is over `maxBytes` or is not valid UTF-8. A `Content-Length` over the limit is
 * refused unread, and otherwise the body is read as a stream that is cancelled the moment it passes the limit, so a body
 * that says nothing about its length (chunked) cannot make the Worker hold megabytes.
 */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      joined.set(chunk, at);
      at += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(joined);
  } catch {
    return null;
  }
}

/** The text of a `POST /api/voice/speak` body (a JSON object with a non-empty string `text` of at most 2,000 characters, in at most 10,000 bytes), or null. */
async function speakText(request: Request): Promise<string | null> {
  const raw = await readCapped(request, MAX_SPEAK_BODY_BYTES);
  if (raw === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const text = (body as { text?: unknown }).text;
  return typeof text === "string" && text.trim() !== "" && text.length <= MAX_SPEAK_CHARS ? text : null;
}

async function handleAsk(request: Request, env: Env): Promise<Response> {
  try {
    const refused = crossOrigin(request);
    if (refused) return refused;
    // Over the limit is an answer, not an error (status 200), so the page shows it like any other reply.
    if (await overLimit(env, limitKey(request))) return json(busyResponse());
    const input = normalizeChatRequest(await request.json());
    if (!input.message) return json({ error: "Ask a question." }, 400);
    return json(await askShared(input.message, env, input.knowledge, input.history));
  } catch {
    return failResponse();
  }
}

async function handleSaying(env: Env): Promise<Response> {
  try {
    return json(await buildSaying(env), 200, "no-store");
  } catch {
    return json({
      groupUrl: GROUP_URL,
      blueskyUrl: BLUESKY_URL,
      scannedAt: new Date().toISOString(),
      items: [],
      facebook: [],
      bluesky: [],
      comments: [],
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/ask" && request.method === "POST") {
        return await handleAsk(request, env);
      }

      if (
        url.pathname === "/api/saying" &&
        (request.method === "GET" || request.method === "POST")
      ) {
        // Each call searches Bluesky and has every post judged by a model, so it is counted like a question.
        const refused = crossOrigin(request);
        if (refused) return refused;
        const busy = await busyError(request, env);
        if (busy) return busy;
        return await handleSaying(env);
      }

      if (url.pathname === "/api/deepgram-token" && request.method === "GET") {
        return new Response("proxy", {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (url.pathname === "/api/voice/v1/agent/converse" && request.method === "GET") {
        const refused = crossOrigin(request);
        if (refused) return refused;
        const key = env.DEEPGRAM_API_KEY?.trim();
        if (!key) return json({ error: "Voice is unavailable." }, 503);
        // Each session the Worker opens spends the owner's Deepgram key, so the upgrade has an allowance of its own.
        const busy = await busyError(request, env, "voice");
        if (busy) return busy;
        try {
          return await proxyAgent(request, key, env);
        } catch {
          return new Response("Voice is unavailable.", { status: 502 });
        }
      }

      if (url.pathname === "/api/voice/think" && request.method === "POST") {
        const refused = crossOrigin(request);
        if (refused) return refused;
        return await think(request, env);
      }

      if (url.pathname === "/api/voice/listen" && request.method === "GET") {
        const refused = crossOrigin(request);
        if (refused) return refused;
        const key = env.DEEPGRAM_API_KEY?.trim();
        if (!key) return json({ error: "Voice is unavailable." }, 503);
        const busy = await busyError(request, env, "voice");
        if (busy) return busy;
        try {
          return await proxyListen(request, key);
        } catch {
          return new Response("Voice is unavailable.", { status: 502 });
        }
      }

      if (url.pathname === "/api/voice/speak" && request.method === "POST") {
        const refused = crossOrigin(request);
        if (refused) return refused;
        const key = env.DEEPGRAM_API_KEY?.trim();
        if (!key) return json({ error: "Voice is unavailable." }, 503);
        // A body that cannot be spoken costs the caller nothing: it is refused before a limiter token is spent.
        const text = await speakText(request);
        if (text === null) return json({ error: `Send JSON with a text of 1 to ${MAX_SPEAK_CHARS} characters.` }, 400);
        const busy = await busyError(request, env);
        if (busy) return busy;
        try {
          return await speak(key, text);
        } catch {
          return new Response("Voice is unavailable.", { status: 502 });
        }
      }

      if (url.pathname === "/api/sources" && request.method === "GET") {
        return json(await loadCatalog(env.DB));
      }

      if (url.pathname === "/api/map-token" && request.method === "GET") {
        const token = env.MAPBOX_ACCESS_TOKEN?.trim();
        if (!token) return new Response("Map is unavailable.", { status: 404 });
        return new Response(token, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (url.pathname === "/api/map" && request.method === "GET") {
        const query = url.searchParams.get("q")?.trim() || "data center";
        return json(await loadMap(query), 200, "no-store");
      }

      if (url.pathname === "/telegram" && request.method === "POST") {
        const { handleTelegram } = await import("./telegram.ts");
        return await handleTelegram(request, env);
      }

      return await env.ASSETS.fetch(request);
    } catch {
      if (new URL(request.url).pathname.startsWith("/api/")) return failResponse();
      return new Response("Politik is unavailable.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
};
