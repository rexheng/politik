// Loads a snapshot into the D1 database `politik`. Run it with `pnpm seed:d1 [--remote] [--dir <path>]`.
//
// It checks the snapshot first and sends nothing if the check finds a problem. Then it applies the migrations and
// runs the seed SQL, which wipes the tables and reloads them (the snapshot is the source of truth). It targets the
// local database unless --remote is given. Node-only build code: never import this from photon/src.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { z } from "zod/v4";

import { checkSnapshot } from "../../../scripts/check-data.ts";
import { snapshotStatements, toSqlFile } from "../../src/data/seed.ts";
import { ManifestSchema, PassageSchema, PolicyRecordSchema } from "../../src/data/schema.ts";

const DB_NAME = "politik";
const SQL_FILE = ".tmp-seed.sql"; // git-ignored by the `.tmp-*` rule
const USAGE = "Usage: pnpm seed:d1 [--remote] [--dir <path>]   (default dir: photon/data/snapshot)";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function parseArgs(argv: string[]): { remote: boolean; dir?: string } {
  let remote = false;
  let dir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--remote") remote = true;
    else if (arg === "--dir" || arg.startsWith("--dir=")) {
      const value = arg === "--dir" ? argv[++i] : arg.slice("--dir=".length);
      if (!value) throw new Error("--dir needs a path, such as --dir tests/fixtures/snapshot");
      dir = value;
    } else throw new Error(`Unknown argument "${arg}"`);
  }
  return { remote, ...(dir !== undefined ? { dir } : {}) };
}

export interface CliDeps {
  /** The repository root: where wrangler runs, the seed file is written and the default snapshot lives. */
  root?: string;
  /** Runs `wrangler <args>` and returns its exit code. Replaced in tests. */
  exec?: (args: string[]) => number;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

function readJson(path: string, errors: string[]): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    errors.push(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/** Runs the command and returns the process exit code. */
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const root = deps.root ?? REPO_ROOT;
  const exec =
    deps.exec ??
    ((args: string[]) => {
      const result = spawnSync("pnpm", ["exec", "wrangler", ...args], { cwd: root, stdio: "inherit" });
      if (result.error) error(`could not run wrangler: ${result.error.message}`);
      return result.status ?? 1;
    });
  const fail = (message: string) => {
    error(message);
    return 1;
  };

  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return fail(USAGE);
  }

  // Nothing is sent until the whole snapshot has been read and checked.
  const dir = args.dir ? resolve(args.dir) : join(root, "photon/data/snapshot");
  const problems: string[] = [];
  const policies = readJson(join(dir, "policies.json"), problems);
  const passages = readJson(join(dir, "passages.json"), problems);
  const manifest = readJson(join(dir, "manifest.json"), problems);
  if (problems.length === 0) problems.push(...checkSnapshot({ policies, passages, manifest }));
  if (problems.length > 0) {
    error(`${problems.length} problem${problems.length === 1 ? "" : "s"} in ${dir}:`);
    for (const problem of problems) error(`  - ${problem}`);
    return fail("Nothing was sent to D1.");
  }

  const records = z.array(PolicyRecordSchema).parse(policies);
  const parts = z.array(PassageSchema).parse(passages);
  const meta = ManifestSchema.parse(manifest);
  if (records.length === 0) {
    return fail(`The snapshot in ${dir} has no records. Seeding it would empty the database, so nothing was sent.`);
  }

  const sqlPath = join(root, SQL_FILE);
  writeFileSync(sqlPath, toSqlFile(snapshotStatements(records, parts, meta)));

  const target = args.remote ? "--remote" : "--local";
  log(
    `Seeding ${records.length} records and ${parts.length} passages (snapshot as of ${meta.snapshotDate}) ` +
      `into ${DB_NAME}, ${args.remote ? "REMOTE" : "local"}.`,
  );
  if (exec(["d1", "migrations", "apply", DB_NAME, target]) !== 0) {
    return fail("Applying the migrations failed, so the seed was not run.");
  }
  if (exec(["d1", "execute", DB_NAME, "--file", SQL_FILE, target]) !== 0) {
    return fail(`Running the seed failed. The SQL is in ${sqlPath}.`);
  }
  log(`Done. ${DB_NAME} (${args.remote ? "remote" : "local"}) is now as of ${meta.snapshotDate}.`);
  return 0;
}

// Run only when executed directly, so tests can import this module.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
