import { askShared, type Env } from "./ask.ts";
import { failureResponse, normalizeChatRequest } from "./chat/index.ts";
import { loadMap } from "./map.ts";
import { BLUESKY_URL, GROUP_URL, buildSaying } from "./saying.ts";
import { loadCatalog } from "./catalog.ts";
import { BUSY_REPLY, busyResponse, limitKey, overLimit } from "./limit.ts";
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
 * Groq and Deepgram keys) from its visitors' browsers. No `Origin` is allowed: a browser sends none for its own page's
 * simple requests, and a script that is not a browser is limited by the rate limit, not by this.
 */
function crossOrigin(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  if (origin === null) return null;
  try {
    if (new URL(origin).host === new URL(request.url).host) return null;
  } catch {
    // an Origin that is not a URL ("null" from a sandboxed page, or nonsense) is not this site
  }
  return json({ error: "Requests from other sites are not allowed." }, 403);
}

/** The 429 for a caller who is over the limit on something that is not a chat answer (an error, not a reply the page shows), or null. */
async function busyError(request: Request, env: Env): Promise<Response | null> {
  return (await overLimit(env, limitKey(request))) ? json({ error: BUSY_REPLY }, 429) : null;
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
        const refused = request.method === "POST" ? crossOrigin(request) : null;
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
        // Each session the Worker opens spends the owner's Deepgram key, so the upgrade is counted like a question.
        const busy = await busyError(request, env);
        if (busy) return busy;
        try {
          return await proxyAgent(request, key, env);
        } catch {
          return new Response("Voice is unavailable.", { status: 502 });
        }
      }

      if (url.pathname === "/api/voice/think" && request.method === "POST") {
        return think(request, env);
      }

      if (url.pathname === "/api/voice/listen" && request.method === "GET") {
        const refused = crossOrigin(request);
        if (refused) return refused;
        const key = env.DEEPGRAM_API_KEY?.trim();
        if (!key) return json({ error: "Voice is unavailable." }, 503);
        const busy = await busyError(request, env);
        if (busy) return busy;
        try {
          return await proxyListen(request, key);
        } catch {
          return new Response("Voice is unavailable.", { status: 502 });
        }
      }

      if (url.pathname === "/api/voice/speak" && request.method === "POST") {
        const key = env.DEEPGRAM_API_KEY?.trim();
        if (!key) return json({ error: "Voice is unavailable." }, 503);
        const busy = await busyError(request, env);
        if (busy) return busy;
        const body = (await request.json()) as { text?: unknown };
        const text = typeof body.text === "string" ? body.text : "";
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
        return handleTelegram(request, env);
      }

      return env.ASSETS.fetch(request);
    } catch {
      if (new URL(request.url).pathname.startsWith("/api/")) return failResponse();
      return new Response("Politik is unavailable.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
};
