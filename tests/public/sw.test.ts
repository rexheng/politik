import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Behaviour of photon/public/sw.js, run in a vm against a stub worker scope: stub caches and stub open windows. The page
// itself is checked by the smoke test (Playwright against `wrangler dev`).
const sw = readFileSync(fileURLToPath(new URL("../../photon/public/sw.js", import.meta.url)), "utf8");
const CURRENT = /const CACHE_NAME = "(politik-shell-v\d+)"/.exec(sw)![1]!;
const HOST = "https://politik.example";

type Work = Promise<unknown>;
type Handler = (event: never) => void;
type Navigate = "settles" | "never settles" | "rejects" | "throws";

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs sw.js against a stub scope that holds `keys` as its caches and has open `windows`, whose navigate() behaves as `navigate` says. */
function boot(over: { keys?: string[]; windows?: string[]; navigate?: Navigate } = {}) {
  const handlers: Record<string, Handler> = {};
  const seen = { deleted: [] as string[], navigated: [] as string[], claimed: 0, skipped: 0 };
  const how = over.navigate ?? "settles";
  const windows = (over.windows ?? []).map((url) => ({
    url,
    navigate: (to: string) => {
      seen.navigated.push(to);
      if (how === "throws") throw new Error("navigate is not allowed");
      if (how === "rejects") return Promise.reject(new Error("navigate refused"));
      if (how === "never settles") return new Promise<void>(() => {});
      return Promise.resolve();
    },
  }));
  const scope = {
    URL,
    Promise,
    self: {
      addEventListener: (type: string, handler: Handler) => void (handlers[type] = handler),
      skipWaiting: () => void seen.skipped++,
      clients: { claim: async () => void seen.claimed++, matchAll: async () => windows },
    },
    caches: {
      keys: async () => over.keys ?? [],
      delete: async (key: string) => void seen.deleted.push(key),
      open: async () => ({ addAll: async () => {} }),
    },
  };
  vm.runInNewContext(sw, scope);

  /** Fires `activate`. `settled` is whether the work given to waitUntil finished, which is what lets the worker become active. */
  async function activate() {
    let work: Work = Promise.resolve();
    handlers.activate!({ waitUntil: (p: Work) => void (work = p) } as never);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      work.then(() => true),
      new Promise<boolean>((resolve) => void (timer = setTimeout(() => resolve(false), 300))),
    ]);
    clearTimeout(timer);
    return { settled };
  }

  return { seen, activate };
}

describe("activate: reload open pages onto an update, never block on it", () => {
  test("a first install (no caches before it) navigates nothing, and still claims the open pages", async () => {
    const w = boot({ keys: [], windows: [`${HOST}/`, `${HOST}/map`] });
    const { settled } = await w.activate();
    assert.equal(settled, true);
    assert.deepEqual(w.seen.navigated, []);
    assert.equal(w.seen.claimed, 1);
  });

  test("the same version activating again, or caches that are not Politik's, is not an update", async () => {
    for (const keys of [[CURRENT], ["something-else"], [CURRENT, "something-else"]]) {
      const w = boot({ keys, windows: [`${HOST}/`, `${HOST}/map`] });
      assert.equal((await w.activate()).settled, true);
      assert.deepEqual(w.seen.navigated, [], JSON.stringify(keys));
    }
  });

  test("every cache but the current one is deleted, on a first install and on an update", async () => {
    const update = boot({ keys: ["politik-shell-v1", CURRENT, "something-else"] });
    await update.activate();
    assert.deepEqual(update.seen.deleted.sort(), ["politik-shell-v1", "something-else"]);
    const first = boot({ keys: ["something-else"] });
    await first.activate();
    assert.deepEqual(first.seen.deleted, ["something-else"]);
  });

  test("an update claims the open pages and reloads the open chat and map pages, and leaves every other page alone", async () => {
    const w = boot({
      keys: ["politik-shell-v24"],
      windows: [`${HOST}/`, `${HOST}/map`, `${HOST}/sources`, `${HOST}/saying`, `${HOST}/jev`],
    });
    assert.equal((await w.activate()).settled, true);
    assert.equal(w.seen.claimed, 1);
    assert.deepEqual(w.seen.navigated.sort(), [`${HOST}/`, `${HOST}/map`]);
  });

  test("a page with a query string is reloaded too (the path is what counts), unless the query holds a question", async () => {
    const w = boot({
      keys: ["politik-shell-v24"],
      windows: [`${HOST}/?utm=1`, `${HOST}/?q=hi`, `${HOST}/?utm=1&q=hi`, `${HOST}/map?q=data%20center`],
    });
    await w.activate();
    assert.deepEqual(w.seen.navigated, [`${HOST}/?utm=1`], "a q window would ask its question a second time");
  });

  for (const how of ["never settles", "rejects", "throws"] as const) {
    test(`activation does not wait for the reload: a navigate that ${how} still lets the work finish`, async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => void unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const w = boot({ keys: ["politik-shell-v24"], windows: [`${HOST}/`, `${HOST}/map`], navigate: how });
        const { settled } = await w.activate();
        assert.equal(settled, true, "the browser holds the reload until activation finishes, so waiting for it deadlocks");
        assert.deepEqual(w.seen.navigated.sort(), [`${HOST}/`, `${HOST}/map`], "and both pages were still asked to reload");
        await tick(20);
        assert.deepEqual(unhandled, [], "a refused reload is not an unhandled rejection");
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  }
});
