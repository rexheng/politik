import { ask, type Env } from "./ask.ts";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
};

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
    const result = await ask(text, env);
    const lines = [result.reply];
    for (const item of result.items.slice(0, 2)) {
      lines.push(item.url ? `${item.title}\n${item.url}` : item.title);
    }
    await sendMessage(token, chatId, lines.join("\n\n"));
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
