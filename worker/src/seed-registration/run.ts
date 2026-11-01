import { loadDotenv } from "@seatpop/llm";
import { isDirectExecution } from "../script-entry";
import { loadRegistrationSeed, type ValidatedWindow } from "./seed";

/**
 * Load owner-transcribed City registration windows into
 * registration_windows. Upsert on (scope, kind, opens_at,
 * opens_date_only): re-running changes nothing. Never deletes — rows
 * absent from the file linger rather than risk a wipe from an
 * accidentally emptied file.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (writes; reads are
 * public). --dry-run prints the plan and writes nothing.
 */

export interface Deps {
  url: string;
  serviceKey: string;
}

export async function rest<T>(
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
  if (init?.prefer?.includes("return=minimal")) return undefined as T;
  return (await response.json()) as T;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop seed:registration-windows: load City registration windows.\n" +
        "usage: npm run seed:registration-windows --workspace @seatpop/worker [-- --dry-run]\n" +
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
      "seed:registration-windows needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
    return 2;
  }
  let windows: ValidatedWindow[];
  try {
    windows = loadRegistrationSeed();
  } catch (error) {
    console.error(
      `seed:registration-windows: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
  console.log(
    `seed:registration-windows: windows=${windows.length}` +
      (dryRun ? " (dry run — no writes)" : ""),
  );
  for (const window of windows.slice(0, 20)) {
    console.log(
      `  ${window.scope} / ${window.kind || "(any)"}${window.label ? ` / ${window.label}` : ""} opens ${window.opens_at}` +
        (window.opens_date_only ? " (date only)" : ""),
    );
  }
  if (windows.length > 20) {
    console.log(`  ... and ${windows.length - 20} more`);
  }
  if (dryRun) return 0;
  const deps: Deps = { url: supabaseUrl, serviceKey };
  for (const window of windows) {
    await rest(deps, "registration_windows", "?on_conflict=scope,kind,opens_at,opens_date_only", {
      method: "POST",
      body: {
        scope: window.scope,
        kind: window.kind,
        opens_at: window.opens_at,
        opens_date_only: window.opens_date_only,
        quote: window.quote,
        source_url: window.source_url,
        label: window.label,
      },
      prefer: "return=minimal,resolution=merge-duplicates",
    });
  }
  console.log(`seed:registration-windows: upserted ${windows.length} row(s)`);
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `seed:registration-windows failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
