import { askShared, type Env } from "./ask.ts";
import { GREETING } from "./orchestrate.ts";

const SPEAK_URL = "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en";
const LISTEN_URL =
  "https://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&smart_format=true&interim_results=true&utterance_end_ms=1200&vad_events=true";
const AGENT_URL = "https://agent.deepgram.com/v1/agent/converse";
const NOTES = "Session notes:\n";

function unavailable(): Response {
  return new Response("Voice is unavailable.", { status: 502 });
}

function selectedProtocol(request: Request): string | undefined {
  const raw = request.headers.get("Sec-WebSocket-Protocol");
  if (!raw) return undefined;
  const items = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (items.includes("bearer")) return "bearer";
  if (items.includes("token")) return "token";
  return items[0];
}

function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

async function proxySocket(request: Request, upstreamUrl: string, apiKey: string): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        Authorization: `Token ${apiKey}`,
      },
    });
  } catch {
    return unavailable();
  }

  const remote = upstream.webSocket;
  if (!remote) return unavailable();

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  let shuttingDown = false;
  const shutdown = (code = 1011, reason = "unavailable") => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      remote.close(code, reason);
    } catch {
      // already closed
    }
    try {
      server.close(code, reason);
    } catch {
      // already closed
    }
  };

  const forwardClose = (from: WebSocket, to: WebSocket) => {
    from.addEventListener("close", (event) => {
      if (shuttingDown) return;
      shuttingDown = true;
      try {
        to.close(event.code || 1000, event.reason || "");
      } catch {
        // already closed
      }
    });
  };

  server.addEventListener("message", (event) => {
    try {
      if (typeof event.data === "string") {
        remote.send(event.data);
        return;
      }
      const bytes = asBytes(event.data);
      if (bytes) {
        remote.send(bytes);
        return;
      }
      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then(
          (buffer) => {
            try {
              remote.send(new Uint8Array(buffer));
            } catch {
              shutdown();
            }
          },
          () => shutdown(),
        );
      }
    } catch {
      shutdown();
    }
  });

  remote.addEventListener("message", (event) => {
    try {
      if (typeof event.data === "string") {
        server.send(event.data);
        return;
      }
      const bytes = asBytes(event.data);
      if (bytes) {
        server.send(bytes);
        return;
      }
      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then(
          (buffer) => {
            try {
              server.send(new Uint8Array(buffer));
            } catch {
              shutdown();
            }
          },
          () => shutdown(),
        );
      }
    } catch {
      shutdown();
    }
  });

  forwardClose(server, remote);
  forwardClose(remote, server);
  server.addEventListener("error", () => shutdown());
  remote.addEventListener("error", () => shutdown());

  server.accept({ allowHalfOpen: true });
  remote.accept({ allowHalfOpen: true });

  const headers = new Headers();
  const protocol = selectedProtocol(request);
  if (protocol) headers.set("Sec-WebSocket-Protocol", protocol);
  return new Response(null, { status: 101, webSocket: client, headers });
}

export function proxyListen(request: Request, apiKey: string): Promise<Response> {
  return proxySocket(request, LISTEN_URL, apiKey);
}

export function proxyAgent(request: Request, apiKey: string): Promise<Response> {
  return proxySocket(request, AGENT_URL, apiKey);
}

export async function speak(apiKey: string, text: string): Promise<Response> {
  const spoken = text.replace(/\s+/g, " ").trim().slice(0, 800);
  if (!spoken) return new Response(null, { status: 400 });
  const res = await fetch(SPEAK_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: spoken }),
  });
  if (!res.ok) return new Response(null, { status: 502 });
  return new Response(res.body, {
    headers: { "content-type": res.headers.get("content-type") || "audio/mpeg" },
  });
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join(" ")
    .trim();
}

function latestUserText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i];
    if (!row || typeof row !== "object") continue;
    const record = row as { role?: unknown; content?: unknown };
    if (record.role !== "user") continue;
    const text = textContent(record.content);
    if (text) return text;
  }
  return "";
}

function knowledgeFromMessages(messages: unknown[]): unknown {
  for (const row of messages) {
    if (!row || typeof row !== "object") continue;
    const record = row as { role?: unknown; content?: unknown };
    if (record.role !== "system") continue;
    const text = textContent(record.content);
    const at = text.lastIndexOf(NOTES);
    if (at === -1) continue;
    try {
      const parsed = JSON.parse(text.slice(at + NOTES.length).trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function completion(reply: string, stream: boolean): Response {
  const id = "politik";
  if (!stream) {
    return new Response(
      JSON.stringify({
        id,
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      const chunk = {
        id,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content: reply }, finish_reason: null }],
      };
      const done = {
        id,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(done)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

export async function think(request: Request, env: Env): Promise<Response> {
  let stream = false;
  try {
    const body = (await request.json()) as { messages?: unknown; stream?: unknown };
    stream = body.stream === true;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const message = latestUserText(messages);
    if (!message) return completion(GREETING, stream);
    const result = await askShared(message, env, undefined, knowledgeFromMessages(messages));
    return completion(result.reply || GREETING, stream);
  } catch {
    return completion("I could not check that just now.", stream);
  }
}
