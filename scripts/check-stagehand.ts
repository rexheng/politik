import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const apiKey = process.env.BROWSERBASE_API_KEY;
if (!apiKey) {
  throw new Error("BROWSERBASE_API_KEY is not set");
}

const browser = await browserbase.launch({ apiKey });
try {
  const stagehand = await Stagehand.create({ browser });
  try {
    const [page] = await browser.context.pages();
    await page.goto("https://example.com");

    const { data } = await stagehand.extract(
      "extract the page heading",
      z.object({ heading: z.string() }),
    );

    console.log("heading:", data.heading);
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}
