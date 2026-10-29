import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDirectExecution } from "../script-entry";
import { seedSources } from "./store";
import { SourceKindSchema } from "./types";

/**
 * Seed the sources table from worker/src/ingest/sources.json
 * ([{name, kind, url, city?}]). Idempotent: existing urls are ignored.
 */

function loadEnvFile(): void {
  let dir = process.cwd();
  const chain: string[] = [];
  for (;;) {
    chain.push(dir);
    if (existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of chain) {
    const file = path.join(d, ".env");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key] === undefined) {
        process.env[key] = trimmed.slice(eq + 1).trim();
      }
    }
  }
}

async function main(): Promise<number> {
  loadEnvFile();
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error("seed-sources needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  const seedsPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "sources.json",
  );
  const raw: unknown = JSON.parse(readFileSync(seedsPath, "utf8"));
  if (!Array.isArray(raw)) {
    console.error("sources.json must be an array");
    return 2;
  }
  const seeds = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") {
      console.error("sources.json entries must be objects");
      return 2;
    }
    const record = entry as Record<string, unknown>;
    const kind = SourceKindSchema.safeParse(record["kind"]);
    if (
      typeof record["name"] !== "string" ||
      !kind.success ||
      typeof record["url"] !== "string"
    ) {
      console.error(`invalid source entry: ${JSON.stringify(entry)}`);
      return 2;
    }
    seeds.push({
      name: record["name"],
      kind: kind.data,
      url: record["url"],
      city: typeof record["city"] === "string" ? record["city"] : undefined,
    });
  }
  const rows = await seedSources({ url: supabaseUrl, serviceKey }, seeds);
  console.log(`seeded ${rows.length} source(s)`);
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `seed-sources failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
