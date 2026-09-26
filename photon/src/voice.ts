import { askShared, type Env } from "./ask.ts";
import type { ChatTurn } from "./contracts.ts";
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

const POLITIK_FN = {
  name: "politik",
  description:
    "Look up what is going on. Call this for every real question. Speak the returned text as the whole reply.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The person's question, in their words.",
      },
    },
    required: ["question"],
  },
};

function publicHttps(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const url = (value as { url?: unknown }).url;
  if (typeof url !== "string") return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function knowledgeFromPrompt(prompt: string): unknown {
  const at = prompt.lastIndexOf(NOTES);
  if (at === -1) return undefined;
  try {
    const parsed = JSON.parse(prompt.slice(at + NOTES.length).trim());
    if (Array.isArray(parsed)) return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}

function tuneSettings(raw: string): { text: string; knowledge: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const msg = parsed as { type?: unknown; agent?: unknown };
  if (msg.type !== "Settings" || !msg.agent || typeof msg.agent !== "object" || Array.isArray(msg.agent)) {
    return null;
  }
  const think = (msg.agent as { think?: unknown }).think;
  if (!think || typeof think !== "object" || Array.isArray(think)) return null;
  const record = think as { endpoint?: unknown; functions?: unknown; prompt?: unknown };
  const prompt = typeof record.prompt === "string" ? record.prompt : "";
  const knowledge = knowledgeFromPrompt(prompt);
  if (publicHttps(record.endpoint)) return { text: raw, knowledge };
  delete record.endpoint;
  record.functions = [POLITIK_FN];
  const instruction =
    "When the person asks a real question, call politik with that question. Speak the function result as the whole reply. Do not answer a real question from your own knowledge.";
  record.prompt = prompt.includes("call politik") ? prompt : `${prompt}\n${instruction}`.trim();
  return { text: JSON.stringify(msg), knowledge };
}

function questionFromArguments(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw) as { question?: unknown };
    return typeof parsed.question === "string" ? parsed.question.trim() : "";
  } catch {
    return "";
  }
}

async function answerFunctionCall(raw: string, env: Env, remote: WebSocket, knowledge: unknown): Promise<boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const msg = parsed as { type?: unknown; functions?: unknown };
  if (msg.type !== "FunctionCallRequest" || !Array.isArray(msg.functions)) return false;
  for (const item of msg.functions) {
    if (!item || typeof item !== "object") continue;
    const fn = item as { id?: unknown; name?: unknown; arguments?: unknown; client_side?: unknown };
    if (fn.client_side === false) continue;
    const name = typeof fn.name === "string" ? fn.name : "";
    const question = questionFromArguments(fn.arguments);
    let content = "I could not check that just now.";
    if (name === "politik" && question) {
      try {
        const result = await askShared(question, env, undefined, knowledge);
        const reply = result.reply?.trim();
        if (reply) content = reply.slice(0, 800);
      } catch {
        content = "I could not check that just now.";
      }
    }
    try {
      remote.send(
        JSON.stringify({
          type: "FunctionCallResponse",
          id: typeof fn.id === "string" ? fn.id : undefined,
          name,
          content,
        }),
      );
    } catch {
      return true;
    }
  }
  return true;
}

async function proxySocket(
  request: Request,
  upstreamUrl: string,
  apiKey: string,
  env?: Env,
): Promise<Response> {
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

  let sessionKnowledge: unknown;
  server.addEventListener("message", (event) => {
    try {
      if (typeof event.data === "string") {
        if (env) {
          const tuned = tuneSettings(event.data);
          if (tuned) {
            sessionKnowledge = tuned.knowledge;
            remote.send(tuned.text);
            return;
          }
        }
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
        if (env) {
          const raw = event.data;
          void answerFunctionCall(raw, env, remote, sessionKnowledge).then(
            (handled) => {
              if (handled || shuttingDown) return;
              try {
                server.send(raw);
              } catch {
                shutdown();
              }
            },
            () => shutdown(),
          );
          return;
        }
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

export function proxyAgent(request: Request, apiKey: string, env: Env): Promise<Response> {
  return proxySocket(request, AGENT_URL, apiKey, env);
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

function historyFromMessages(messages: unknown[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const row of messages) {
    if (!row || typeof row !== "object") continue;
    const record = row as { role?: unknown; content?: unknown };
    if (record.role !== "user" && record.role !== "assistant") continue;
    const text = textContent(record.content);
    if (!text) continue;
    turns.push({ role: record.role, text });
  }
  if (turns.length > 0 && turns[turns.length - 1].role === "user") turns.pop();
  return turns.slice(-8);
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
    const result = await askShared(
      message,
      env,
      undefined,
      knowledgeFromMessages(messages),
      undefined,
      historyFromMessages(messages),
    );
    return completion(result.reply || GREETING, stream);
  } catch {
    return completion("I could not check that just now.", stream);
  }
}
