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
 * The language model the voice agent thinks with: the server's choice, not the page's. The owner's Deepgram plan pays for
 * every token of it, so whatever provider and model the page's settings name, this is what the agent gets. (It is what the
 * page asks for today.)
 */
export const VOICE_THINK_PROVIDER = { type: "open_ai", model: "gpt-4o-mini" } as const;
/** The voice the agent speaks with: the server's choice too (Deepgram bills each voice at its own rate). The page asks for this one today. */
export const VOICE_SPEAK_PROVIDER = { type: "deepgram", model: "aura-2-thalia-en" } as const;
/** The speech-to-text model the agent listens with, and the provider it runs on: the server's choice too. The page asks for these today. */
export const VOICE_LISTEN_PROVIDER = { type: "deepgram", model: "nova-3" } as const;
/** The most a text frame from the page may be, in bytes. A real message (the settings, with the session notes) is a few kilobytes. */
export const MAX_FRAME_BYTES = 256 * 1024;

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

// ---- what the page may say to the owner's Deepgram agent ---------------------------------------------------------------
// The page is untrusted: anyone can open the voice socket with their own script. Deepgram would follow any URL in the
// think or speak settings (a custom language model, a function that is called over HTTP, a custom voice), and would read
// a lenient parse of a frame that this Worker read differently. So no text frame is ever passed on as the page wrote it:
// it is parsed here (a frame that does not parse is dropped), every URL under a think or speak section is taken out, the
// think provider is the server's, and what is sent is the JSON of what was kept.

/** How deep a message may nest before the rest of it is cut off (a real message is three or four levels deep). */
const MAX_DEPTH = 32;
const DROP = Symbol("drop");
/** The words that make a key name a URL. */
const URL_WORDS = new Set(["url", "urls", "uri", "uris", "href", "hrefs", "endpoint", "endpoints"]);

/**
 * True for a key that names a URL: url, uri, href, endpoint and anything built on them (baseUrl, api_url, webhookUri,
 * endpoints). "endpointing", "security" and "during" are not. The words of a key are found at its separators and
 * at a change from lower to upper case.
 */
function isUrlKey(key: string): boolean {
  if (/(url|uri|href|endpoint)s?$/i.test(key)) return true;
  return key.split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).some((word) => URL_WORDS.has(word.toLowerCase()));
}
/** A string that is a URL, whatever the key: a scheme and `//` (also `//host`), or a scheme that runs code or carries data. */
const URL_VALUE = /^\s*(?:(?:[a-z][a-z0-9+.-]*:)?\/\/|(?:https?|wss?|ftp|file|data|blob|javascript|mailto):)\S/i;

/** A string that holds a JSON object, array or string is the value it holds (some parsers read it so); anything else is itself. */
function unwrapJson(value: unknown): unknown {
  let v = value;
  for (let i = 0; i < 4 && typeof v === "string"; i++) {
    const text = v.trim();
    if (!/^[{["]/.test(text)) break;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "string" && (typeof parsed !== "object" || parsed === null)) break;
      v = parsed;
    } catch {
      break;
    }
  }
  return v;
}

/**
 * `value` with every URL taken out: a key that names one is dropped with its value, a string that is one is dropped from
 * its object or list, and a string that holds JSON is read through and cleaned too. A `prompt` is text for the model,
 * not a setting, so it is kept as written unless it is itself a URL. Too deep a value is dropped.
 */
function scrub(value: unknown, depth = 0, isPrompt = false): unknown {
  if (depth > MAX_DEPTH) return DROP;
  if (typeof value === "string") {
    if (URL_VALUE.test(value)) return DROP;
    if (isPrompt) return value;
    const inner = unwrapJson(value);
    return inner === value ? value : scrub(inner, depth + 1);
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1)).filter((item) => item !== DROP);
  if (isRecord(value)) {
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || isUrlKey(key)) continue;
      const clean = scrub(item, depth + 1, key.toLowerCase() === "prompt");
      if (clean !== DROP) out[key] = clean;
    }
    return out;
  }
  return value;
}

type Tuning = { origin: string; notes: unknown[] };

/** Settings that the Worker sets itself: a page's spelling of them in another letter case is not left beside them. */
const OWN_KEYS = ["prompt", "provider", "functions", "endpoint"];

type SectionKind = "think" | "speak" | "listen";

/**
 * One think, speak or listen section, safe to hand to the owner's Deepgram agent. All three are the page's with their URLs
 * taken out, and then:
 * - a speak section's provider and model are the server's (`VOICE_SPEAK_PROVIDER`);
 * - a listen section's provider type and model are the server's (`VOICE_LISTEN_PROVIDER`), and the page's other listen
 *   settings (keyterms and the like) stay;
 * - a think section's provider and model are the server's (`VOICE_THINK_PROVIDER`); a page that asks for a custom think
 *   endpoint (any `endpoint` key) is given the Worker's own /api/voice/think, with no headers of its own, and none of its
 *   functions (a function can carry an endpoint that Deepgram would call); otherwise (or on an origin Deepgram cannot reach)
 *   the agent gets the `politik` function, which it calls on this socket, and the prompt tells it to use it. The session
 *   notes found in the think prompt go to `tuning.notes`.
 */
function tuneSection(section: Record<string, unknown>, kind: SectionKind, tuning: Tuning): Record<string, unknown> {
  const clean = scrub(section) as Record<string, unknown>;
  if (kind === "speak") {
    clean.provider = { ...VOICE_SPEAK_PROVIDER };
    return clean;
  }
  if (kind === "listen") {
    clean.provider = { ...(isRecord(clean.provider) ? clean.provider : {}), ...VOICE_LISTEN_PROVIDER };
    return clean;
  }
  const wantsEndpoint = Object.keys(section).some((key) => key.toLowerCase() === "endpoint");
  let prompt = typeof clean.prompt === "string" ? clean.prompt : "";
  for (const key of Object.keys(clean)) {
    if (key !== key.toLowerCase() && OWN_KEYS.includes(key.toLowerCase())) {
      if (key.toLowerCase() === "prompt" && !prompt && typeof clean[key] === "string") prompt = clean[key] as string;
      delete clean[key];
    }
  }
  tuning.notes.push(knowledgeFromPrompt(prompt));
  clean.provider = { ...VOICE_THINK_PROVIDER };
  const own = wantsEndpoint ? ownThinkEndpoint(tuning.origin) : null;
  if (own) {
    if (prompt) clean.prompt = prompt;
    clean.endpoint = own;
    delete clean.functions;
    return clean;
  }
  delete clean.endpoint;
  clean.functions = [POLITIK_FN];
  clean.prompt = prompt.includes("call politik") ? prompt : `${prompt}\n${INSTRUCTION}`.trim();
  return clean;
}

/** A think, speak or listen setting, as an object or a list of objects (or either written as a JSON string); anything else is no section and is left out. */
function tuneSections(value: unknown, kind: SectionKind, tuning: Tuning): unknown {
  const unwrapped = unwrapJson(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped
      .map(unwrapJson)
      .filter(isRecord)
      .map((section) => tuneSection(section, kind, tuning));
  }
  return isRecord(unwrapped) ? tuneSection(unwrapped, kind, tuning) : DROP;
}

/** Keys whose value is a setting object, never text: a JSON string there is read as the object it holds. */
const STRUCTURAL_KEYS = new Set(["agent", "audio", "context"]);

/**
 * `node` with every think, speak and listen section in it, wherever it sits, replaced by its safe form, and a key that
 * names a URL dropped with its value, in any message. With `whole` (the message is not free text) a string that is a URL is
 * dropped from its object or list too; in free text (`FREE_TEXT_TYPES`) only the keys are cleaned, and what people wrote
 * is left as it is. A JSON string is read through only where a setting object belongs (`STRUCTURAL_KEYS`), not in text such
 * as a history message's function-call arguments.
 */
function tuneNode(node: unknown, tuning: Tuning, depth: number, whole: boolean): unknown {
  if (depth > MAX_DEPTH) return DROP;
  if (typeof node === "string") return whole && URL_VALUE.test(node) ? DROP : node;
  if (Array.isArray(node)) return node.map((item) => tuneNode(item, tuning, depth + 1, whole)).filter((item) => item !== DROP);
  if (!isRecord(node)) return node;
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(node)) {
    if (key === "__proto__") continue;
    const lower = key.toLowerCase();
    const section = lower === "think" || lower === "speak" || lower === "listen";
    if (!section && isUrlKey(key)) continue; // in free text too: a key is never what people write
    const tuned = section ? tuneSections(value, lower as SectionKind, tuning) : tuneNode(STRUCTURAL_KEYS.has(lower) ? unwrapJson(value) : value, tuning, depth + 1, whole);
    if (tuned !== DROP) out[section ? lower : key] = tuned;
  }
  return out;
}

/** Message types that carry what people say, not settings: a URL as their whole text is text. */
const FREE_TEXT_TYPES = new Set(["injectusermessage", "injectagentmessage", "functioncallresponse", "functioncallrequest"]);

/**
 * True when the message is free text: it has a `type` key, and every key that reads as `type` (in any letter case, with or
 * without spaces around it, because a parser may read the key that way) holds a string that is one of `FREE_TEXT_TYPES`
 * (also in any letter case). A message that says it is something else under another spelling of the key is not free text.
 */
function isFreeText(message: Record<string, unknown>): boolean {
  const types = Object.entries(message).filter(([key]) => key.trim().toLowerCase() === "type");
  return types.length > 0 && types.every(([, value]) => typeof value === "string" && FREE_TEXT_TYPES.has(value.trim().toLowerCase()));
}

/**
 * The text to send Deepgram for a text frame from the page, with the session notes found in the think prompt; null when
 * the frame is dropped, which is when it is over `MAX_FRAME_BYTES`, does not parse as JSON (NaN, a byte-order mark, text
 * after the JSON, plain text), or is not a JSON object. The raw text is never sent: what is sent is the JSON of the parsed
 * message with every think, speak and listen section made safe (`tuneSection`) in any message, whatever its `type` says,
 * because a parser that reads the type differently, or the same message twice, must find nothing to follow. Unless the
 * message is free text (`FREE_TEXT_TYPES`), every URL in the rest of it is taken out too. `origin` is the Worker's own origin,
 * taken from the request that opened the socket.
 */
export function tuneSettings(raw: string, origin: string): { text: string; knowledge: unknown } | null {
  if (raw.length > MAX_FRAME_BYTES || new TextEncoder().encode(raw).byteLength > MAX_FRAME_BYTES) return null;
  try {
    const parsed = unwrapJson(JSON.parse(raw));
    if (!isRecord(parsed)) return null;
    const tuning: Tuning = { origin, notes: [] };
    const tuned = tuneNode(parsed, tuning, 0, !isFreeText(parsed));
    if (!isRecord(tuned)) return null;
    return { text: JSON.stringify(tuned), knowledge: tuning.notes.find((found) => found !== undefined) };
  } catch {
    return null;
  }
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

/** The part of a WebSocket that the bridge uses (a Workers WebSocket, or a fake in a test). */
export type BridgeSocket = {
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  accept(options?: { allowHalfOpen?: boolean }): void;
};

/** The timer functions the session guard uses; a test gives it ones that only move when it says so. */
export type Timers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };

/** The longest a voice session may last. Deepgram bills agent time, and a socket the page never closes would run for ever. */
export const MAX_SESSION_MS = 10 * 60_000;
/** How long a session may go without a frame from the page (audio, or a keep-alive) before it is closed. */
export const IDLE_MS = 60_000;

/**
 * Ends a session that has gone on too long or has gone quiet: `onExpire("session limit")` after `maxMs` from the start,
 * or `onExpire("idle")` after `idleMs` with no `touch()` (a frame from the page). It fires once and leaves no timer
 * running; `stop()` cancels it for a session that ended by itself.
 */
export function sessionGuard(opts: {
  onExpire(reason: "session limit" | "idle"): void;
  maxMs?: number;
  idleMs?: number;
  timers?: Timers;
}): { touch(): void; stop(): void } {
  const timers: Timers = opts.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };
  const idleMs = opts.idleMs ?? IDLE_MS;
  let done = false;
  let idle: unknown;
  let limit: unknown;
  const stop = () => {
    done = true;
    timers.clearTimeout(idle);
    timers.clearTimeout(limit);
  };
  const expire = (reason: "session limit" | "idle") => {
    if (done) return;
    stop();
    opts.onExpire(reason);
  };
  const arm = () => timers.setTimeout(() => expire("idle"), idleMs);
  idle = arm();
  limit = timers.setTimeout(() => expire("session limit"), opts.maxMs ?? MAX_SESSION_MS);
  return {
    touch() {
      if (done) return;
      timers.clearTimeout(idle);
      idle = arm();
    },
    stop,
  };
}

/**
 * Joins the page's socket (`server`) to Deepgram's (`remote`) and accepts both. Audio goes through as it is. A text frame
 * from the page goes through `tuneSettings`, so Deepgram only ever gets a rewritten copy, and a frame that does not parse
 * is dropped. A text frame from Deepgram is checked for the agent's `politik` function call (`answerFunctionCall`), and
 * otherwise goes on to the page. Both sockets are closed after `MAX_SESSION_MS`, and after `IDLE_MS` with no frame from
 * the page that was passed on (a frame that is dropped is not a sign of life, so garbage cannot keep a session open).
 */
export function bridgeSockets(opts: {
  server: BridgeSocket;
  remote: BridgeSocket;
  /** With the environment the agent's function calls are answered; the listen proxy has none. */
  env?: Env;
  /** The Worker's own origin, for the think endpoint it offers. */
  origin: string;
  /** The rate limit's key for the caller, for the questions of this session. */
  ip: string;
  timers?: Timers;
  maxSessionMs?: number;
  idleMs?: number;
  /** For tests: replaces `answerFunctionCall`. */
  answerCall?: typeof answerFunctionCall;
}): void {
  const { server, remote, env, origin } = opts;
  const answerCall = opts.answerCall ?? answerFunctionCall;

  let shuttingDown = false;
  const shutdown = (code = 1011, reason = "unavailable") => {
    if (shuttingDown) return;
    shuttingDown = true;
    guard.stop();
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
  const guard = sessionGuard({ onExpire: (reason) => shutdown(1000, reason), timers: opts.timers, maxMs: opts.maxSessionMs, idleMs: opts.idleMs });

  const forwardClose = (from: BridgeSocket, to: BridgeSocket) => {
    from.addEventListener("close", (event) => {
      guard.stop();
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
  const session: FunctionCallSession = { client: server as unknown as WebSocket, ip: opts.ip, history: [] };
  server.addEventListener("message", (event) => {
    try {
      if (typeof event.data === "string") {
        const tuned = tuneSettings(event.data, origin);
        if (!tuned) return; // not JSON the Worker can read, or too big: not passed on, and not a sign of life either
        guard.touch();
        if (tuned.knowledge !== undefined) sessionKnowledge = tuned.knowledge;
        remote.send(tuned.text);
        return;
      }
      const bytes = asBytes(event.data);
      if (bytes) {
        guard.touch();
        remote.send(bytes);
        return;
      }
      if (event.data instanceof Blob) {
        guard.touch();
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
          void answerCall(raw, env, remote as unknown as WebSocket, sessionKnowledge, session).then(
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

  bridgeSockets({ server, remote, env, origin: new URL(request.url).origin, ip: limitKey(request) });

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
