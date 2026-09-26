import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import type { SourceItem } from "../contracts.ts";

const PostsSchema = z.object({
  posts: z
    .array(
      z.object({
        text: z.string(),
        title: z.string(),
        plain: z.string(),
      }),
    )
    .max(5),
});

/**
 * Read public posts from a Facebook group via Browserbase Stagehand.
 * Node-only — do not import from the Cloudflare worker.
 */
export async function readGroup(opts: {
  apiKey?: string;
  groupUrl: string;
}): Promise<SourceItem[]> {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) return [];

  let browser: Awaited<ReturnType<typeof browserbase.launch>> | undefined;
  let stagehand: Awaited<ReturnType<typeof Stagehand.create>> | undefined;

  try {
    browser = await browserbase.launch({ apiKey });
    stagehand = await Stagehand.create({ browser });

    const [page] = await browser.context.pages();
    await page.goto(opts.groupUrl);

    const { data } = await stagehand.extract(
      "Extract up to 5 public posts visible on this Facebook group page. For each post: text is the post body (or a short excerpt), title is a short headline, and plain is one layman sentence summarizing the post.",
      PostsSchema,
    );

    const posts = Array.isArray(data.posts) ? data.posts.slice(0, 5) : [];
    return posts
      .filter((p) => p.title?.trim() && p.plain?.trim())
      .map((p, i) => ({
        id: `browserbase-${i + 1}`,
        source: "browserbase" as const,
        title: p.title.trim(),
        plain: p.plain.trim(),
        url: opts.groupUrl,
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
