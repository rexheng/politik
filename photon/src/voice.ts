import { askShared, type Env } from "./ask.ts";
import { GREETING, MAX_HISTORY_TURNS } from "./chat/index.ts";
import { toSpokenResponse } from "./chat/spoken.ts";
import type { ChatResponse, ChatTurn } from "./chat/types.ts";
import { busyResponse, limitKey, overLimit } from "./limit.ts";

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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The think endpoint the Worker offers Deepgram: its own /api/voice/think and nothing the page names. It exists only on
 * an https origin, because Deepgram's servers call it; a local `wrangler dev` (http) has none.
 */
function ownThinkEndpoint(origin: string): { url: string; headers: Record<string, string> } | null {
  try {
    const url = new URL("/api/voice/think", origin);
    return url.protocol === "https:" ? { url: url.href, headers: {} } : null;
  } catch {
    return null;
  }
}

const INSTRUCTION =
  "When the person asks a real question, call politik with that question. Speak the function result as the whole reply. Do not answer a real question from your own knowledge.";

/**
 * Makes one `think` section safe to hand to the owner's Deepgram agent, whatever the page put in it, and returns the
 * session notes found in its prompt. The agent only ever calls the Worker:
 * - A page that asks for a custom think endpoint (any `endpoint`, whatever it names) is given the Worker's own
 *   /api/voice/think, with no headers of its own, and none of its functions: a function can carry an `endpoint` that
 *   Deepgram would call.
 * - Otherwise (the page asks for none, or the origin is not reachable from Deepgram) the agent gets the `politik` function,
 *   which it calls on this socket, and the prompt tells it to use it.
 */
function pinThink(section: Record<string, unknown>, origin: string): unknown {
  const prompt = typeof section.prompt === "string" ? section.prompt : "";
  const knowledge = knowledgeFromPrompt(prompt);
  const own = "endpoint" in section ? ownThinkEndpoint(origin) : null;
  if (own) {
    section.endpoint = own;
    delete section.functions;
    return knowledge;
  }
  delete section.endpoint;
  section.functions = [POLITIK_FN];
  section.prompt = prompt.includes("call politik") ? prompt : `${prompt}\n${INSTRUCTION}`.trim();
  return knowledge;
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

/**
 * The sections of a `think` or `speak` setting as a list of objects, which are the ones that can carry an endpoint: the
 * setting itself when it is an object, or the objects in it when it is a list. A list is cut down to those objects in
 * place, so an entry that is not an object (or a list inside the list) cannot carry one past the pin. Null when the
 * setting is neither.
 */
function sectionsOf(holder: Record<string, unknown>, key: string): Record<string, unknown>[] | null {
  const value = holder[key];
  if (isRecord(value)) return [value];
  if (!Array.isArray(value)) return null;
  const objects = value.filter(isRecord);
  holder[key] = objects;
  return objects;
}

/**
 * The page's messages that set the agent's think or speak section, rewritten so that the agent only calls the Worker or
 * Deepgram's own voices, with the session notes from the think prompt. A think section is pinned by `pinThink`. A speak
 * section loses its `endpoint`: Deepgram would send every spoken line to the URL it names, and the Worker has no speech
 * endpoint of its own to put there. These are `Settings`, and also `UpdateThink` and `UpdateSpeak`, which replace one
 * section in the middle of a session and would otherwise undo the pin. Null for any other message, or one with neither
 * section, which goes on unchanged. `origin` is the Worker's own origin, taken from the request that opened the socket.
 */
export function tuneSettings(raw: string, origin: string): { text: string; knowledge: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  let think: Record<string, unknown>[] | null = null;
  let speak: Record<string, unknown>[] | null = null;
  if (parsed.type === "Settings") {
    if (!isRecord(parsed.agent)) return null;
    think = sectionsOf(parsed.agent, "think");
    speak = sectionsOf(parsed.agent, "speak");
  } else if (parsed.type === "UpdateThink") {
    think = sectionsOf(parsed, "think");
  } else if (parsed.type === "UpdateSpeak") {
    speak = sectionsOf(parsed, "speak");
  }
  if (!think && !speak) return null;
  const notes = (think ?? []).map((section) => pinThink(section, origin)); // every section is pinned, not just the first
  for (const section of speak ?? []) delete section.endpoint;
  return { text: JSON.stringify(parsed), knowledge: notes.find((found) => found !== undefined) };
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

/**
 * The type of the frame that carries a spoken question's full answer down to the page. The voice widget cannot hand the
 * page a `ChatResponse`, and the page must not ask /api/ask again (that would run the pipeline twice for one question), so
 * the Worker, which has just run it, sends the answer along the same socket; the widget ignores a type it does not know,
 * and the page reads the frame off the socket (photon/public/app.js, `tapVoiceAnswers`).
 */
export const VOICE_ANSWER_TYPE = "PolitikAnswer";

const COULD_NOT_CHECK = "I could not check that just now.";

/** What `answerFunctionCall` knows about the session besides the function call itself. */
export type FunctionCallSession = {
  /** The page's side of the socket. Each answer's `ChatResponse` goes to it in a `PolitikAnswer` frame. */
  client?: Pick<WebSocket, "send">;
  /** The caller's IP address, which the rate limit counts. */
  ip?: string;
  /** The questions and replies so far in this voice session: read for each question, and added to after it. */
  history?: ChatTurn[];
};

/** One spoken question, run through the pipeline once: the rate limit, then `askShared` with the session's history. */
async function answerSpokenQuestion(question: string, env: Env, knowledge: unknown, session: FunctionCallSession): Promise<ChatResponse> {
  if (await overLimit(env, session.ip ?? "")) return busyResponse();
  const result = await askShared(question, env, knowledge, session.history);
  if (session.history) {
    session.history.push({ role: "user", text: question }, { role: "assistant", text: result.reply ?? "" });
    while (session.history.length > MAX_HISTORY_TURNS) session.history.shift();
  }
  return result;
}

/**
 * Answers the voice agent's `politik` function call with the reply as speech, and shows the page the same answer (one
 * run of the pipeline for the spoken question, not two). Returns true when `raw` was a function call.
 */
export async function answerFunctionCall(raw: string, env: Env, remote: WebSocket, knowledge: unknown, session: FunctionCallSession = {}): Promise<boolean> {
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
    let content = COULD_NOT_CHECK;
    if (name === "politik" && question) {
      try {
        const result = await answerSpokenQuestion(question, env, knowledge, session);
        const spoken = toSpokenResponse(result);
        if (spoken) content = spoken;
        try {
          session.client?.send(JSON.stringify({ type: VOICE_ANSWER_TYPE, question, response: result }));
        } catch {
          // the page is gone; the agent still gets its answer
        }
      } catch {
        content = COULD_NOT_CHECK;
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

  const origin = new URL(request.url).origin;
  let sessionKnowledge: unknown;
  const session: FunctionCallSession = { client: server, ip: limitKey(request), history: [] };
  server.addEventListener("message", (event) => {
    try {
      if (typeof event.data === "string") {
        if (env) {
          const tuned = tuneSettings(event.data, origin);
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
          void answerFunctionCall(raw, env, remote, sessionKnowledge, session).then(
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
    const result = (await overLimit(env, limitKey(request)))
      ? busyResponse()
      : await askShared(message, env, knowledgeFromMessages(messages), historyFromMessages(messages));
    return completion(toSpokenResponse(result) || GREETING, stream);
  } catch {
    return completion(COULD_NOT_CHECK, stream);
  }
}
