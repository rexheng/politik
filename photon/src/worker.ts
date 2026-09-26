import type { AskResponse } from "./contracts.ts";
import { askShared, type Env } from "./ask.ts";
import { loadMap } from "./map.ts";
import { BLUESKY_URL, GROUP_URL, buildSaying } from "./saying.ts";
import { loadCatalog } from "./catalog.ts";
import { proxyAgent, proxyListen, speak, think } from "./voice.ts";

export type { Env };

const FAIL_REPLY = "I could not check that just now. Try again in a minute.";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function failResponse(): Response {
  const body: AskResponse = {
    reply: FAIL_REPLY,
    category: "other",
    items: [],
  };
  return json(body);
}

async function handleAsk(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      message?: unknown;
      audioUrl?: unknown;
      who?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return json({ error: "Ask a question." }, 400);
    const audioUrl =
      typeof body.audioUrl === "string" && body.audioUrl.trim()
        ? body.audioUrl.trim()
        : undefined;
    return json(await askShared(message, env, audioUrl, body.knowledge, body.who));
  } catch {
    return failResponse();
  }
}

async function handleSaying(env: Env): Promise<Response> {
  try {
    return json(await buildSaying(env));
  } catch {
    return json({
      groupUrl: GROUP_URL,
      blueskyUrl: BLUESKY_URL,
      scannedAt: new Date().toISOString(),
      items: [],
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
        const key = env.DEEPGRAM_API_KEY?.trim();
        if (!key) return json({ error: "Voice is unavailable." }, 503);
        try {
          return await proxyAgent(request, key);
        } catch {
          return new Response("Voice is unavailable.", { status: 502 });
        }
      }

      if (url.pathname === "/api/voice/think" && request.method === "POST") {
        return think(request, env);
      }

      if (url.pathname === "/api/voice/listen" && request.method === "GET") {
        const key = env.DEEPGRAM_API_KEY?.trim();
        if (!key) return json({ error: "Voice is unavailable." }, 503);
        try {
          return await proxyListen(request, key);
        } catch {
          return new Response("Voice is unavailable.", { status: 502 });
        }
      }

      if (url.pathname === "/api/voice/speak" && request.method === "POST") {
        const key = env.DEEPGRAM_API_KEY?.trim();
        if (!key) return json({ error: "Voice is unavailable." }, 503);
        const body = (await request.json()) as { text?: unknown };
        const text = typeof body.text === "string" ? body.text : "";
        return speak(key, text);
      }

      if (url.pathname === "/api/sources" && request.method === "GET") {
        return json(await loadCatalog());
      }

      if (url.pathname === "/api/map" && request.method === "GET") {
        const query = url.searchParams.get("q")?.trim() || "data center";
        return json(await loadMap(query));
      }

      if (url.pathname === "/telegram" && request.method === "POST") {
        const { handleTelegram } = await import("./telegram.ts");
        return handleTelegram(request, env);
      }

      return env.ASSETS.fetch(request);
    } catch {
      return failResponse();
    }
  },
};
