import { ask, type Env } from "./ask.ts";
import { GENERAL_LABEL } from "./chat/index.ts";
import type { ChatResponse } from "./chat/types.ts";
import { BUSY_REPLY, overLimit, telegramLimitKey } from "./limit.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Text for Telegram, which shows plain text: no **bold** stars and no "### " heading marks. */
const plain = (text: string): string => text.replaceAll("**", "").replace(/^[ \t]*#{1,6}[ \t]+/gm, "");

/** The reply with its markers (but not its markdown), then any general-knowledge text under its label, then one "[n] title — url" line per source. */
export function formatTelegramReply(result: ChatResponse): string {
  const parts = [plain(result.reply)];
  if (result.general) parts.push(`${GENERAL_LABEL}:\n${plain(result.general)}`);
  if (result.citations.length > 0) parts.push(result.citations.map((c) => `[${c.n}] ${c.title} — ${c.url}`).join("\n"));
  return parts.join("\n\n");
}

/** True when the two strings are equal, found out in the same time whatever they hold, so the secret cannot be guessed a character at a time. */
function sameSecret(given: string, expected: string): boolean {
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function handleTelegram(request: Request, env: Env): Promise<Response> {
  // When TELEGRAM_WEBHOOK_SECRET is set, only Telegram (which sends it with every update once setWebhook was given the
  // same secret_token) may use this endpoint. An update that passed that check is `verified`: its chat id can be trusted.
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret && !sameSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", secret)) {
    return new Response("Forbidden", { status: 401 });
  }
  const verified = Boolean(secret);

  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return new Response("ok");

  // Anyone can post to this endpoint (until the secret is set), so the body is read as untrusted: whatever it is, the
  // answer is 200 "ok" (Telegram sends an update again when it gets an error), and only a text from a numbered chat is run.
  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return new Response("ok");
  }
  const message = isRecord(update) && isRecord(update.message) ? update.message : null;
  const chat = message && isRecord(message.chat) ? message.chat : null;
  const chatId = typeof chat?.id === "number" && Number.isFinite(chat.id) ? chat.id : null;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (chatId === null || !text || text.startsWith("/")) {
    if (chatId !== null && text.startsWith("/")) {
      await sendQuietly(token, chatId, "Ask what is going on.", "the command reply");
    }
    return new Response("ok");
  }

  if (await overLimit(env, telegramLimitKey(request, chatId, verified))) {
    await sendQuietly(token, chatId, BUSY_REPLY, "the busy reply");
    return new Response("ok");
  }

  try {
    const result = await ask(text, env, undefined, []);
    await sendMessage(token, chatId, formatTelegramReply(result));
  } catch {
    await sendQuietly(token, chatId, "I could not check that just now.", "the apology");
  }
  return new Response("ok");
}

/**
 * `sendMessage`, except that a failure is logged and not thrown. Telegram sends an update again when it gets an error
 * back, so a reply that cannot be sent must not become one. Only the error's name is logged: the request URL holds the
 * bot token.
 */
async function sendQuietly(token: string, chatId: number, text: string, what: string): Promise<void> {
  try {
    await sendMessage(token, chatId, text);
  } catch (error) {
    console.warn(`telegram: could not send ${what}`, error instanceof Error ? error.name : "");
  }
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  });
}
