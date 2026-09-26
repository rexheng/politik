import type { SourceItem } from "../contracts.ts";

const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const MODEL_ID = "scribe_v2";
const MAX_PLAIN_WORDS = 24;

type SpeechToTextResponse = {
  text?: string;
  transcription_id?: string | null;
};

function toShortLaymanSentence(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";

  const first = cleaned.match(/^[^.!?]+[.!?]*/)?.[0]?.trim() || cleaned;
  const words = first.split(/\s+/).filter(Boolean);
  let sentence =
    words.length > MAX_PLAIN_WORDS
      ? words.slice(0, MAX_PLAIN_WORDS).join(" ")
      : words.join(" ");

  if (!/[.!?]$/.test(sentence)) sentence += ".";
  return sentence;
}

function filenameFromUrl(audioUrl: string): string {
  try {
    const path = new URL(audioUrl).pathname;
    const base = path.split("/").filter(Boolean).pop();
    if (base && /\.[a-z0-9]+$/i.test(base)) return base;
  } catch {
    // ignore
  }
  return "audio";
}

export async function transcribeSpeech(opts: {
  apiKey?: string;
  audioUrl?: string;
}): Promise<SourceItem[]> {
  try {
    const apiKey = opts.apiKey?.trim();
    const audioUrl = opts.audioUrl?.trim();
    if (!apiKey || !audioUrl) return [];

    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return [];

    const audioBlob = await audioRes.blob();
    const form = new FormData();
    form.append("file", audioBlob, filenameFromUrl(audioUrl));
    form.append("model_id", MODEL_ID);

    const sttRes = await fetch(STT_URL, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      body: form,
    });

    if (!sttRes.ok) return [];

    const data = (await sttRes.json()) as SpeechToTextResponse;
    const raw = typeof data.text === "string" ? data.text.trim() : "";
    if (!raw) return [];

    const short = toShortLaymanSentence(raw);
    if (!short) return [];

    const item: SourceItem = {
      id:
        (typeof data.transcription_id === "string" && data.transcription_id) ||
        `elevenlabs:${audioUrl}`,
      source: "elevenlabs",
      title: "Speech transcript",
      plain: `${short} This is a transcript.`,
      url: audioUrl,
    };

    return [item];
  } catch {
    return [];
  }
}
