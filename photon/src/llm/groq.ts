// A small Groq chat-completions client that returns zod-validated structured output.
// Worker-safe by design (the chatbot reuses it): only `fetch` and zod. No node: imports, no dotenv, no env reads;
// callers pass the key and model in.
//
// The defaults suit batch builds (the snapshot script): up to 4 retries with a 2 s backoff that doubles, and a 60 s
// timeout on each HTTP exchange, so one call can run for several minutes before it gives up. A Worker request cannot
// wait that long: Worker callers must pass a tight `timeoutMs` and `maxRetries` (and `baseDelayMs`) of their own.
//
// Groq docs this follows (checked 2026-10-15):
//   https://console.groq.com/docs/structured-outputs  (json_schema modes, supported models, schema subset)
//   https://console.groq.com/docs/models              (production vs preview models)
import { z } from "zod/v4";

/** Asks a model for one JSON object that must satisfy `schema`. `name` labels the schema in the request. */
export type LlmRequest<T> = { system: string; user: string; schema: z.ZodType<T>; name: string };
export type Llm = <T>(req: LlmRequest<T>) => Promise<T>;

/**
 * The models used when the environment does not override them. Both are production models (not preview) that support
 * `response_format: json_schema`, including `strict: true`; llama-3.1-8b-instant and llama-3.3-70b-versatile are
 * production too but only support json_object. Override with GROQ_ENRICH_MODEL / GROQ_VERIFY_MODEL (see resolveModels).
 */
export const DEFAULT_MODELS: { enrich: string; verify: string } = {
  enrich: "openai/gpt-oss-120b", // the strongest production model with structured output
  verify: "openai/gpt-oss-20b", // faster and cheaper; a different model from enrich, so the checker does not share its blind spots
};

/** Applies the GROQ_ENRICH_MODEL / GROQ_VERIFY_MODEL overrides from an environment the caller supplies. Blank values are ignored. */
export function resolveModels(env: Record<string, string | undefined>): { enrich: string; verify: string } {
  return {
    enrich: env.GROQ_ENRICH_MODEL?.trim() || DEFAULT_MODELS.enrich,
    verify: env.GROQ_VERIFY_MODEL?.trim() || DEFAULT_MODELS.verify,
  };
}

/**
 * The models the chatbot uses when GROQ_CHAT_MODEL / GROQ_ROUTER_MODEL are not set (see resolveChatModels): the strong
 * model writes the answer and the fast one routes the question. Both are production models with strict json_schema.
 */
export const DEFAULT_CHAT_MODELS: { compose: string; router: string } = {
  compose: "openai/gpt-oss-120b",
  router: "openai/gpt-oss-20b",
};

/** Applies the GROQ_CHAT_MODEL / GROQ_ROUTER_MODEL overrides from an environment the caller supplies. Blank values are ignored. */
export function resolveChatModels(env: Record<string, string | undefined>): { compose: string; router: string } {
  return {
    compose: env.GROQ_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODELS.compose,
    router: env.GROQ_ROUTER_MODEL?.trim() || DEFAULT_CHAT_MODELS.router,
  };
}

/**
 * True when `model` is one Groq lists as a reasoning model, the only kind that takes `reasoning_effort`: `openai/gpt-oss-*`
 * and the `qwen/qwen3*` family. GROQ_CHAT_MODEL and GROQ_ROUTER_MODEL can name any model, and a model without the setting
 * may answer a request that has it with a 400, so the field is sent only when this is true.
 */
export function supportsReasoningEffort(model: string): boolean {
  return /^(openai\/gpt-oss-|qwen\/qwen3)/.test(model.trim().toLowerCase());
}

/** Models the docs list under "Models with Strict Mode" (constrained decoding). */
const STRICT_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);

/**
 * JSON Schema keywords left out of strict requests. The docs only promise a subset (types, enum, anyOf, $defs/$ref), and
 * Groq community reports show 400s for schemas using `pattern` and `format`, so a schema using any of these is sent best-effort.
 */
const KEYWORDS_NOT_FOR_STRICT = new Set([
  ...["pattern", "format", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "contains", "prefixItems"],
  ...["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  ...["minProperties", "maxProperties", "patternProperties", "propertyNames"],
  ...["const", "default", "allOf", "oneOf", "not", "if", "then", "else"],
]);

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MAX_WAIT_MS = 60_000; // a longer rate-limit wait (e.g. a daily quota) is reported instead of stalling the build
const DEFAULT_TIMEOUT_MS = 60_000;

export class LlmError extends Error {
  status?: number;
  /** Groq's error code, e.g. "json_validate_failed". */
  code?: string;
  /** What the model produced before a 400 "failed generation", if Groq says. */
  failedGeneration?: string;
  /**
   * How the call failed, so a caller need not parse the message: `http` (Groq answered with `status`), `timeout` (no
   * answer in time), `network` (the request never completed), or `invalid-output` (the reply was unusable after the repair).
   */
  kind?: "http" | "timeout" | "network" | "invalid-output";
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export type GroqOptions = {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** Retries of a 429, 5xx or network error. Default 4. */
  maxRetries?: number;
  /** The first backoff wait; it doubles each retry. Default 2000. */
  baseDelayMs?: number;
  /** How long one HTTP exchange (request sent to body read) may take before it is aborted. A timeout is retried like any network error. Default 60000. */
  timeoutMs?: number;
  /**
   * How hard the model thinks before it answers, sent as `reasoning_effort` (Groq's gpt-oss models take low, medium or
   * high and default to medium). Less thinking is fewer tokens and a faster answer, which matters on a small
   * tokens-per-minute plan. Left out when unset, and left out for any model that is not a reasoning model
   * (`supportsReasoningEffort`), so a model that has no such setting is never sent one.
   */
  reasoningEffort?: "low" | "medium" | "high";
  /** For tests: replaces the real wait. */
  sleep?: (ms: number) => Promise<void>;
};

type Message = { role: "system" | "user" | "assistant"; content: string };
type Mode = "strict" | "schema" | "object";
type Reply = { content: string; finish?: string; failure?: string };

/** True when every object in the schema is closed with all properties required and no keyword outside the strict subset. */
function strictCompatible(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return true;
  const n = node as Record<string, any>;
  if (Object.keys(n).some((k) => KEYWORDS_NOT_FOR_STRICT.has(k))) return false;
  if (n.type === "object" || n.properties) {
    if (n.additionalProperties !== false) return false;
    const required: unknown[] = Array.isArray(n.required) ? n.required : [];
    if (!Object.keys(n.properties ?? {}).every((k) => required.includes(k))) return false;
  }
  const children = [Object.values(n.properties ?? {}), Object.values(n.$defs ?? {}), n.anyOf ?? [], n.items ?? []].flat();
  return children.every(strictCompatible);
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

const stripFence = (text: string) => text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

function describeIssues(error: z.ZodError): string {
  const lines = error.issues.slice(0, 15).map((i) => `- ${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`);
  if (error.issues.length > 15) lines.push(`- ...and ${error.issues.length - 15} more`);
  return lines.join("\n");
}

const GENERATION_FAILURE = /json_validate_failed|failed_generation|generated json|failed to generate json/i;
const MODE_REJECTION = /json_schema|response_format|structured output|strict/i;

export function groqLlm(opts: GroqOptions): Llm {
  const { apiKey, model } = opts;
  const maxRetries = opts.maxRetries ?? 4;
  const baseDelay = opts.baseDelayMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const effort = opts.reasoningEffort && supportsReasoningEffort(model) ? { reasoning_effort: opts.reasoningEffort } : {};
  if (!(timeoutMs > 0) || !Number.isFinite(timeoutMs)) throw new RangeError(`timeoutMs must be a positive number, got ${timeoutMs}`);
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  /** `${schema name}:${mode}` pairs Groq has refused for this model, so later calls skip them. */
  const refused = new Set<string>();

  const redact = (text: string) => (apiKey ? text.replaceAll(apiKey, "***") : text);

  const apiError = (status: number, body: string, note = "") => {
    let detail = body.slice(0, 500);
    let code: string | undefined;
    let generation: string | undefined;
    try {
      const parsed = JSON.parse(body)?.error;
      if (parsed?.message) detail = String(parsed.message);
      if (typeof parsed?.code === "string") code = parsed.code;
      if (typeof parsed?.failed_generation === "string") generation = parsed.failed_generation;
    } catch {
      // not JSON: keep the raw text
    }
    const error = new LlmError(redact(`Groq API error ${status}: ${detail}${note}`), status);
    error.code = code;
    error.failedGeneration = generation;
    error.kind = "http";
    return error;
  };

  /** One HTTP exchange, retrying 429, 5xx, timeouts and network errors with exponential backoff. */
  async function post(body: object): Promise<{ content: string; finish?: string }> {
    for (let attempt = 0; ; attempt++) {
      const backoff = Math.min(baseDelay * 2 ** attempt, MAX_WAIT_MS);
      const signal = AbortSignal.timeout(timeoutMs); // covers the response body too, so a stalled stream cannot hang the build
      let res: Response;
      let text: string;
      try {
        res = await doFetch(ENDPOINT, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        text = await res.text();
      } catch (cause) {
        if (attempt >= maxRetries) {
          const why = signal.aborted ? `timed out after ${timeoutMs}ms` : cause instanceof Error ? cause.message : String(cause);
          const failure = new LlmError(redact(`Groq request failed: ${why}`));
          failure.kind = signal.aborted ? "timeout" : "network";
          throw failure;
        }
        await sleep(backoff);
        continue;
      }
      if (res.ok) {
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          // not JSON: treated below as an empty reply
        }
        const choice = json?.choices?.[0];
        const content = choice?.message?.content;
        return { content: typeof content === "string" ? content : "", finish: choice?.finish_reason };
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const wait = retryAfterMs(res.headers.get("retry-after")) ?? backoff;
        if (wait > MAX_WAIT_MS) throw apiError(res.status, text, ` (retry-after ${Math.ceil(wait / 1000)}s is too long to wait)`);
        await sleep(wait);
        continue;
      }
      throw apiError(res.status, text);
    }
  }

  return async function llm<T>({ system, user, schema, name }: LlmRequest<T>): Promise<T> {
    const { $schema: _dropped, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
    const schemaName = name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "response";
    const modes: Mode[] = [...(STRICT_MODELS.has(model) && strictCompatible(jsonSchema) ? (["strict"] as const) : []), "schema", "object"];

    const requestBody = (mode: Mode, messages: Message[]) => {
      if (mode === "object") {
        const note = `\n\nReply with a single JSON object and nothing else. It must conform to this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
        return { model, temperature: 0, ...effort, messages: [{ ...messages[0]!, content: messages[0]!.content + note }, ...messages.slice(1)], response_format: { type: "json_object" } };
      }
      const format = { name: schemaName, ...(mode === "strict" ? { strict: true } : {}), schema: jsonSchema };
      return { model, temperature: 0, ...effort, messages, response_format: { type: "json_schema", json_schema: format } };
    };

    /** Tries the modes in order of strength, moving on when Groq says the model or schema cannot do one. */
    async function complete(messages: Message[]): Promise<Reply> {
      for (const mode of modes) {
        if (refused.has(`${schemaName}:${mode}`)) continue;
        try {
          return await post(requestBody(mode, messages));
        } catch (e) {
          if (!(e instanceof LlmError) || e.status !== 400) throw e;
          if (GENERATION_FAILURE.test(`${e.code ?? ""} ${e.message}`) || e.failedGeneration !== undefined) {
            return { content: e.failedGeneration ?? "", failure: e.message }; // the model's own output was bad: repair it
          }
          if (mode !== "object" && MODE_REJECTION.test(e.message)) {
            refused.add(`${schemaName}:${mode}`);
            continue;
          }
          throw e;
        }
      }
      const refused400 = new LlmError(`Groq refused every response format for "${schemaName}" on ${model}`, 400);
      refused400.kind = "http";
      throw refused400;
    }

    /** The validated value, or what is wrong with the reply. */
    function check(reply: Reply): { value: T } | { problem: string } {
      if (reply.failure) return { problem: reply.failure };
      const cutOff = reply.finish === "length" ? " The reply was cut off at the length limit, so keep it shorter." : "";
      if (!reply.content.trim()) return { problem: `The reply was empty.${cutOff}` };
      let json: unknown;
      try {
        json = JSON.parse(stripFence(reply.content));
      } catch (e) {
        return { problem: `The reply was not valid JSON (${e instanceof Error ? e.message : "parse error"}).${cutOff}` };
      }
      const parsed = schema.safeParse(json);
      return parsed.success ? { value: parsed.data } : { problem: `The JSON did not match the schema:\n${describeIssues(parsed.error)}` };
    }

    const messages: Message[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    const first = await complete(messages);
    const firstCheck = check(first);
    if ("value" in firstCheck) return firstCheck.value;

    // Exactly one repair call, which sees its own previous reply and what was wrong with it.
    const repair: Message[] = [
      ...messages,
      ...(first.content ? [{ role: "assistant", content: first.content } as const] : []),
      { role: "user", content: `${firstCheck.problem}\nReply again with only the corrected JSON object.` },
    ];
    const second = await complete(repair);
    const secondCheck = check(second);
    if ("value" in secondCheck) return secondCheck.value;
    const invalid = new LlmError(`Groq output for "${schemaName}" was still invalid after one repair. ${secondCheck.problem}`);
    invalid.kind = "invalid-output";
    throw invalid;
  };
}
