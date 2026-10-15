// What a failed step of the pipeline writes to the Worker log. The router, the ranker and the compose model all fail
// soft (the answer falls back to something cruder), so without a line in the log a Groq 429 or a bad key looks like a
// quiet drop in quality. One line per failed step per request, with the HTTP status and the kind of failure, never the
// key: an LlmError message is already redacted by groq.ts, and anything that looks like a key is masked again here.

/** Strings that look like an API key or a bearer token, masked before a message is logged. */
const SECRET = /\b(?:gsk_|sk-|tsk_|ts_)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+/gi;

const field = (error: unknown, name: string): unknown => (typeof error === "object" && error !== null ? (error as Record<string, unknown>)[name] : undefined);

/** `status=429 kind=http code=rate_limit_exceeded: the message`, as far as the error carries each part. */
export function describeFailure(error: unknown): string {
  const status = field(error, "status");
  const kind = field(error, "kind");
  const code = field(error, "code");
  const name = field(error, "name");
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const parts = [
    `status=${typeof status === "number" ? status : "none"}`,
    `kind=${typeof kind === "string" ? kind : "none"}`,
    ...(typeof code === "string" ? [`code=${code}`] : []),
  ];
  const text = message.replace(SECRET, "***").replace(/\s+/g, " ").trim().slice(0, 200);
  return `${parts.join(" ")}${text ? `: ${typeof name === "string" && name !== "Error" ? `${name}: ` : ""}${text}` : ""}`;
}

/** Logs `chat: <step> failed (<what happened>)` once. Call it once per failed step. */
export function warnFailure(step: string, error: unknown): void {
  console.warn(`chat: ${step} failed (${describeFailure(error)})`);
}
