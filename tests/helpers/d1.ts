import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";

import type { D1Like } from "../../photon/src/data/d1.ts";

const migrationPath = fileURLToPath(new URL("../../migrations/0001_snapshot.sql", import.meta.url));
const configPath = fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url));

/** The migration's statements, one per entry (the file has no `;` inside strings or comments). */
export function migrationStatements(): string[] {
  return readFileSync(migrationPath, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * An in-memory local D1 with the migration applied and nothing else loaded.
 * `{ migrate: false }` leaves it bare, like a production D1 nobody has migrated yet.
 */
export async function openTestDb(options: { migrate?: boolean } = {}): Promise<{ db: D1Like; dispose(): Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath, persist: false });
  const db = proxy.env.DB;
  if (!db) throw new Error("wrangler.jsonc has no DB binding");
  if (options.migrate !== false) await db.batch(migrationStatements().map((sql) => db.prepare(sql)));
  return { db, dispose: () => proxy.dispose() };
}
