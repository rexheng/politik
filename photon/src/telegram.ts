import { ask, type Env } from "./ask.ts";
import { GENERAL_LABEL } from "./chat/index.ts";
import type { ChatResponse } from "./chat/types.ts";
import { BUSY_REPLY, clientIp, overLimit } from "./limit.ts";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
};

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
  // same secret_token) may use this endpoint.
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret && !sameSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", secret)) {
    return new Response("Forbidden", { status: 401 });
  }

  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return new Response("ok");

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("ok");
  }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text?.trim();
  if (chatId == null || !text || text.startsWith("/")) {
    if (chatId != null && text?.startsWith("/")) {
      await sendMessage(token, chatId, "Ask what is going on.");
    }
    return new Response("ok");
  }

  if (await overLimit(env, clientIp(request))) {
    await sendMessage(token, chatId, BUSY_REPLY);
    return new Response("ok");
  }

  try {
    const result = await ask(text, env, undefined, []);
    await sendMessage(token, chatId, formatTelegramReply(result));
  } catch {
    await sendMessage(token, chatId, "I could not check that just now.");
  }
  return new Response("ok");
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  });
}
