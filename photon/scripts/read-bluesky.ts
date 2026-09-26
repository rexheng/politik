import "dotenv/config";
import { readBlueskyComments } from "../src/sources/bluesky.ts";

const DEFAULT_PROFILE = "https://bsky.app/profile/datacenter.bsky.social";

const profileUrl = process.argv[2] || DEFAULT_PROFILE;
const items = await readBlueskyComments({
  apiKey: process.env.BROWSERBASE_API_KEY,
  profileUrl,
});

console.log(JSON.stringify(items, null, 2));
