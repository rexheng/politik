import snapshotJson from "../../data/bluesky-pull.json";

const ENDPOINT = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";

type CommentSentiment = "for" | "against" | "unsure";

const QUERIES = [
  "data center California",
  "data center water California",
  "data center power California",
  "data center noise",
  "data center jobs California",
];

const POST_LIMIT = 10;

export interface PublicBskyPost {
  title: string;
  plain: string;
  url: string;
  happenedAt: string;
  author: string;
  sentiment: CommentSentiment;
}

interface NormalPost {
  uri: string;
  url: string;
  handle: string;
  displayName: string;
  text: string;
  createdAt: string;
}

interface SearchHit {
  uri?: string;
  indexedAt?: string;
  author?: { handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string };
}

interface SnapshotFile {
  fetchedAt?: string;
  posts?: Array<{
    uri?: string;
    url?: string;
    handle?: string;
    displayName?: string;
    text?: string;
    createdAt?: string;
  }>;
}

function bodyText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[\w.-]+\.(?:com|org|net|gov|app)\/\S*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentionsDataCenter(text: string): boolean {
  return /data[\s-]*cent(?:er|re)s?/i.test(text);
}

function onTheme(text: string): boolean {
  return /\b(california|water|power|grid|electricity|noise|jobs?)\b/i.test(text);
}

export function sentimentOf(text: string): CommentSentiment {
  const against = [
    /\bdestroy/,
    /\bdestructive\b/,
    /\bpoison/,
    /\btoxic\b/,
    /\bno say\b/,
    /\bno relief\b/,
    /\balarming\b/,
    /\bpollut/,
    /\boppose(?:s|d|ing)?\b/,
    /\bagainst\b/,
    /\bprotest/,
    /\bnightmare\b/,
    /\bmoratorium\b/,
    /\bdon't want\b/,
    /\bdo not want\b/,
    /\bfight (this|the|these)\b/,
  ].some((pattern) => pattern.test(text));

  const support = [
    /\bdon'?t make any noise\b/,
    /\bdo not make any noise\b/,
    /\bstopped noticing\b/,
    /\bworse than\b[\s\S]{0,80}\bdata cent(?:er|re)s?\b/,
    /\bdata cent(?:er|re)s?\b[\s\S]{0,40}\bare (fine|quiet|not (a )?problem)\b/,
    /\bin favor\b/,
    /\bsupport(?:s|ing)? (?:the |this |these )?(?:new )?(?:data center|project)/,
    /\bbring(?:s|ing)? jobs\b/,
    /\bcreate[sd]? jobs\b/,
    /\bwe need (?:more )?data cent(?:er|re)s?\b/,
  ].some((pattern) => pattern.test(text));

  if (against && support) return "unsure";
  if (against) return "against";
  if (support) return "for";
  return "unsure";
}

function firstLine(text: string): string {
  const lines = text.split(/\n/).map((part) => part.trim()).filter(Boolean);
  const line = lines.find((part) => /[A-Za-z]/.test(part)) ?? lines[0] ?? text.trim();
  if (line.length <= 180) return line;
  const cut = line.slice(0, 180);
  const space = cut.lastIndexOf(" ");
  return `${(space > 80 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function postUrl(handle: string, uri: string): string {
  const rkey = uri.split("/").pop()?.trim() ?? "";
  if (!handle || !rkey) return "";
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

function normalizeHit(hit: SearchHit): NormalPost | null {
  const uri = hit.uri?.trim() ?? "";
  const text = hit.record?.text?.trim() ?? "";
  const handle = hit.author?.handle?.trim() ?? "";
  const createdAt = hit.record?.createdAt || hit.indexedAt || "";
  const url = postUrl(handle, uri);
  if (!uri || !text || !handle || !url || !createdAt) return null;
  return {
    uri,
    url,
    handle,
    displayName: hit.author?.displayName?.trim() ?? "",
    text,
    createdAt,
  };
}

function usable(post: NormalPost): boolean {
  if (!mentionsDataCenter(post.text) || !onTheme(post.text)) return false;
  return bodyText(post.text).length >= 50;
}

export function selectPosts(posts: NormalPost[], limit = POST_LIMIT): PublicBskyPost[] {
  const byUri = new Map<string, NormalPost>();
  for (const post of posts) {
    if (!usable(post) || byUri.has(post.uri)) continue;
    byUri.set(post.uri, post);
  }
  const recent = [...byUri.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const california = recent.filter((post) => /\bcalifornia\b/i.test(post.text));
  const picked: NormalPost[] = [];
  const seen = new Set<string>();
  for (const post of california) {
    if (picked.length >= 4) break;
    picked.push(post);
    seen.add(post.uri);
  }
  for (const post of recent) {
    if (picked.length >= limit) break;
    if (seen.has(post.uri)) continue;
    picked.push(post);
    seen.add(post.uri);
  }
  picked.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return picked.map((post) => ({
    title: firstLine(post.text),
    plain: post.text,
    url: post.url,
    happenedAt: post.createdAt,
    author: post.displayName || post.handle,
    sentiment: sentimentOf(post.text),
  }));
}

async function fetchQuery(query: string): Promise<NormalPost[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "latest");
  url.searchParams.set("limit", "25");
  url.searchParams.set("lang", "en");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Politik/1.0" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { posts?: SearchHit[] };
  const posts = Array.isArray(data.posts) ? data.posts : [];
  return posts.flatMap((hit) => {
    const post = normalizeHit(hit);
    return post ? [post] : [];
  });
}

function loadSnapshot(): { fetchedAt: string; posts: NormalPost[] } {
  try {
    const snapshot = snapshotJson as SnapshotFile;
    const posts = (snapshot.posts ?? []).flatMap((row) => {
      const uri = row.uri?.trim() ?? "";
      const text = row.text?.trim() ?? "";
      const handle = row.handle?.trim() ?? "";
      const createdAt = row.createdAt?.trim() ?? "";
      const url = row.url?.trim() || postUrl(handle, uri);
      if (!uri || !text || !url || !createdAt) return [];
      const post: NormalPost = {
        uri,
        url,
        handle,
        displayName: row.displayName?.trim() ?? "",
        text,
        createdAt,
      };
      return [post];
    });
    return { fetchedAt: snapshot.fetchedAt?.trim() || new Date().toISOString(), posts };
  } catch {
    return { fetchedAt: new Date().toISOString(), posts: [] };
  }
}

export async function searchPublicBluesky(): Promise<{
  fetchedAt: string;
  endpoint: string;
  posts: PublicBskyPost[];
}> {
  const fetchedAt = new Date().toISOString();
  try {
    const batches = await Promise.all(QUERIES.map((query) => fetchQuery(query)));
    const posts = selectPosts(batches.flat());
    if (posts.length > 0) {
      return { fetchedAt, endpoint: ENDPOINT, posts };
    }
  } catch {
    /* use the saved public pull */
  }
  const snapshot = loadSnapshot();
  return {
    fetchedAt: snapshot.fetchedAt,
    endpoint: ENDPOINT,
    posts: selectPosts(snapshot.posts),
  };
}
