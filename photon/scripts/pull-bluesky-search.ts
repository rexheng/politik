import { mkdirSync, writeFileSync } from "node:fs";

const ENDPOINT = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";
const QUERIES = [
  "data center California",
  "data center water California",
  "data center power California",
  "data center noise",
  "data center jobs California",
];

interface RawPost {
  uri?: string;
  indexedAt?: string;
  author?: { handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string };
}

interface SavedPost {
  uri: string;
  url: string;
  handle: string;
  displayName: string;
  text: string;
  createdAt: string;
  query: string;
}

const seen = new Map<string, SavedPost>();

for (const query of QUERIES) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "latest");
  url.searchParams.set("limit", "25");
  url.searchParams.set("lang", "en");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Politik/1.0" },
  });
  if (!res.ok) {
    console.error(`query failed ${res.status} ${query}`);
    continue;
  }
  const data = (await res.json()) as { posts?: RawPost[] };
  const posts = Array.isArray(data.posts) ? data.posts : [];
  console.error(`${query} ${posts.length}`);
  for (const post of posts) {
    const uri = post.uri?.trim() ?? "";
    const text = post.record?.text?.trim() ?? "";
    const handle = post.author?.handle?.trim() ?? "";
    if (!uri || !text || !handle || seen.has(uri)) continue;
    const rkey = uri.split("/").pop() ?? "";
    if (!rkey) continue;
    seen.set(uri, {
      uri,
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      handle,
      displayName: post.author?.displayName?.trim() ?? "",
      text,
      createdAt: post.record?.createdAt || post.indexedAt || "",
      query,
    });
  }
}

const posts = [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
mkdirSync("photon/data", { recursive: true });
const payload = {
  fetchedAt: new Date().toISOString(),
  endpoint: ENDPOINT,
  count: posts.length,
  posts,
};
writeFileSync("photon/data/bluesky-pull.json", JSON.stringify(payload, null, 2));
console.error(`wrote ${posts.length}`);
