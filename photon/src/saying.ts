import type { Category, SourceName, TaggedItem } from "./contracts.ts";
import { categorise } from "./categoriser.ts";
import type { Env } from "./ask.ts";
import { searchPublicBluesky, type PublicBskyPost } from "./sources/bsky-search.ts";

export const GROUP_URL = "https://www.facebook.com/groups/saynotodatacenters/";

export const BLUESKY_URL = "https://bsky.app/profile/datacenter.bsky.social";

/** Last Browserbase read of the group. The page was a login wall and returned no posts. */
export const FACEBOOK_READ_AT = "2026-09-26T21:56:10.387Z";

export const FACEBOOK_NOTE =
  "No public posts. The group reader returned none, and the mobile page redirects to Facebook login.";

export type CommentSentiment = "for" | "against" | "unsure";

export interface SayingComment {
  text: string;
  sentiment: CommentSentiment;
}

export interface SayingItem {
  title: string;
  plain: string;
  url?: string;
  happenedAt?: string;
  fetchedAt?: string;
  author?: string;
  source: string;
  category: Category;
  tags: Array<{ text: string; significance: number }>;
  sentiment?: CommentSentiment;
}

export interface SayingPayload {
  groupUrl: string;
  blueskyUrl: string;
  scannedAt: string;
  items: SayingItem[];
  facebook: SayingItem[];
  bluesky: SayingItem[];
  comments: SayingComment[];
  facebookNote?: string;
  facebookReadAt?: string;
}

async function tagPost(
  row: PublicBskyPost,
  source: SourceName,
  fetchedAt: string,
  apiKey?: string,
): Promise<SayingItem> {
  let category: Category = "other";
  let tags: SayingItem["tags"] = [{ text: "other", significance: 0.2 }];
  try {
    const judged = await categorise(`${row.title}. ${row.plain}`, apiKey, source);
    category = judged.category;
    tags = [...judged.tags].sort((a, b) => b.significance - a.significance);
  } catch {
    /* keep fallbacks */
  }

  const out: SayingItem = {
    title: row.title,
    plain: row.plain,
    url: row.url,
    source,
    category,
    tags,
    fetchedAt,
    sentiment: row.sentiment,
    author: row.author,
  };
  if (row.happenedAt) out.happenedAt = row.happenedAt;
  return out;
}

export async function buildSaying(env: Env): Promise<SayingPayload> {
  const bluesky = await searchPublicBluesky();
  const blueskyItems = await Promise.all(
    bluesky.posts.map((post) => tagPost(post, "bluesky", bluesky.fetchedAt, env.TYPESAFE_API_KEY)),
  );

  const comments: SayingComment[] = blueskyItems.map((item) => ({
    text: item.plain,
    sentiment: item.sentiment ?? "unsure",
  }));

  return {
    groupUrl: GROUP_URL,
    blueskyUrl: BLUESKY_URL,
    scannedAt: bluesky.fetchedAt,
    items: blueskyItems,
    facebook: [],
    bluesky: blueskyItems,
    comments,
    facebookNote: FACEBOOK_NOTE,
    facebookReadAt: FACEBOOK_READ_AT,
  };
}

export function asKnowledge(items: SayingItem[]): TaggedItem[] {
  return items.map((item, i) => {
    const out: TaggedItem = {
      id: `saying-${i}`,
      source: item.source as SourceName,
      title: item.title,
      plain: item.plain,
      category: item.category,
      tags: item.tags.map((tag) => tag.text),
    };
    if (item.url) out.url = item.url;
    if (item.happenedAt) out.happenedAt = item.happenedAt;
    return out;
  });
}
