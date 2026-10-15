import { ask, type Env } from "./ask.ts";
import { GENERAL_LABEL } from "./chat/index.ts";
import type { ChatResponse } from "./chat/types.ts";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
};

/** The reply with its markers, then any general-knowledge text under its label, then one "[n] title — url" line per source. */
export function formatTelegramReply(result: ChatResponse): string {
  const parts = [result.reply];
  if (result.general) parts.push(`${GENERAL_LABEL}:\n${result.general}`);
  if (result.citations.length > 0) parts.push(result.citations.map((c) => `[${c.n}] ${c.title} — ${c.url}`).join("\n"));
  return parts.join("\n\n");
}

export async function handleTelegram(request: Request, env: Env): Promise<Response> {
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
