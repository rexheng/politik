import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const SentimentSchema = z.enum(["for", "against", "unsure"]);

const CommentsSchema = z.object({
  comments: z
    .array(
      z.object({
        text: z.string(),
        sentiment: SentimentSchema,
      }),
    )
    .max(20),
});

export type BlueskySentiment = z.infer<typeof SentimentSchema>;

export interface BlueskyComment {
  text: string;
  sentiment: BlueskySentiment;
}

/**
 * Read visible comments and replies on a Bluesky profile via Browserbase Stagehand.
 * Node-only — do not import from the Cloudflare worker.
 */
export async function readBlueskyComments(opts: {
  apiKey?: string;
  profileUrl: string;
}): Promise<BlueskyComment[]> {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) return [];

  let browser: Awaited<ReturnType<typeof browserbase.launch>> | undefined;
  let stagehand: Awaited<ReturnType<typeof Stagehand.create>> | undefined;

  try {
    browser = await browserbase.launch({ apiKey });
    stagehand = await Stagehand.create({ browser });

    const [page] = await browser.context.pages();
    await page.goto(opts.profileUrl);

    const { data } = await stagehand.extract(
      "This Bluesky profile belongs to Data Center Knowledge. Extract up to 20 comments and replies whose text is visible on the page. Include reply text under posts and posts that are themselves replies. Skip the profile bio, the display name, and follower counts. Do not invent text that is not visible. For each item, text is the comment or reply body, and sentiment is for if it supports data centers, against if it opposes them, or unsure if it takes no clear side.",
      CommentsSchema,
    );

    const comments = Array.isArray(data.comments) ? data.comments.slice(0, 20) : [];
    return comments
      .filter(
        (comment) =>
          comment.text?.trim() &&
          (comment.sentiment === "for" ||
            comment.sentiment === "against" ||
            comment.sentiment === "unsure"),
      )
      .map((comment) => ({
        text: comment.text.trim(),
        sentiment: comment.sentiment,
      }));
  } catch {
    return [];
  } finally {
    try {
      await stagehand?.close();
    } catch {
      /* ignore close errors */
    }
    try {
      await browser?.close();
    } catch {
      /* ignore close errors */
    }
  }
}
