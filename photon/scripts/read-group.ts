import "dotenv/config";
import { readGroup } from "../src/sources/browserbase.ts";

const DEFAULT_GROUP =
  "https://www.facebook.com/groups/saynotodatacenters/";

const groupUrl = process.argv[2] || DEFAULT_GROUP;
const items = await readGroup({
  apiKey: process.env.BROWSERBASE_API_KEY,
  groupUrl,
});

console.log(JSON.stringify(items, null, 2));
