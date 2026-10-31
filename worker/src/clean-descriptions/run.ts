import { loadDotenv } from "@seatpop/llm";
import { isDirectExecution } from "../script-entry";
import { planDescriptionClean, type DescriptionRow } from "./plan";

/**
 * Re-clean stored event descriptions with the shared sanitizer
 * (entities, U+FFFD, mojibake, glued sentences). New rows are cleaned
 * at ingest; this repairs what landed before.
 *
 * Idempotent: only rows whose text changes are patched, and the
 * sanitizer runs to a fixpoint, so re-running updates nothing.
 * Re-cleaned rows re-enrich on the next enrich run (their source hash
 * covers the description) — budget that queue accordingly.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (events exposes no
 * policies for direct updates).
 */

interface Deps {
  url: string;
  serviceKey: string;
}

async function rest<T>(
  deps: Deps,
  tablePath: string,
  query: string,
  init?: { method?: string; body?: unknown; prefer?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: deps.serviceKey,
    Authorization: `Bearer ${deps.serviceKey}`,
  };
  if (init?.prefer) headers["Prefer"] = init.prefer;
  const response = await fetch(
    `${deps.url.replace(/\/$/, "")}/rest/v1/${tablePath}${query}`,
    {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    },
  );
  if (!response.ok) {
    throw new Error(`supabase ${tablePath} failed: HTTP ${response.status}`);
  }
  if (init?.prefer === "return=minimal") return undefined as T;
  return (await response.json()) as T;
}

const PAGE = 1000;

async function listDescribed(deps: Deps): Promise<DescriptionRow[]> {
  const rows: DescriptionRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await rest<DescriptionRow[]>(
      deps,
      "events",
      `?select=id,description&description=not.is.null&order=id&limit=${PAGE}&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop clean:descriptions: re-clean stored event descriptions.\n" +
        "usage: npm run clean:descriptions --workspace @seatpop/worker [-- --dry-run]\n" +
        "  --dry-run    print the plan and write nothing.",
    );
    return 0;
  }
  const dryRun = args.includes("--dry-run");
  loadDotenv();
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "clean:descriptions needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
    return 2;
  }
  const deps: Deps = { url: supabaseUrl, serviceKey };

  const rows = await listDescribed(deps);
  const updates = planDescriptionClean(rows);
  console.log(
    `clean:descriptions: described=${rows.length} ` +
      `to_update=${updates.length}${dryRun ? " (dry run — no writes)" : ""}`,
  );
  for (const update of updates.slice(0, 5)) {
    console.log(`  ${update.id}\n    - ${preview(update.before)}\n    + ${preview(update.after)}`);
  }
  if (updates.length > 5) {
    console.log(`  ... and ${updates.length - 5} more`);
  }
  if (!dryRun) {
    for (const update of updates) {
      await rest(deps, "events", `?id=eq.${update.id}`, {
        method: "PATCH",
        body: { description: update.after },
        prefer: "return=minimal",
      });
    }
    console.log(`clean:descriptions: updated ${updates.length} row(s)`);
  }
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `clean:descriptions failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
