import { loadDotenv } from "@seatpop/llm";
import { isDirectExecution } from "../script-entry";
import {
  loadSeedEntries,
  planVenueUpdates,
  seedBoundsError,
  type VenueRowLite,
} from "./seed";

/**
 * Backfill venue coordinates from data/seed/venue-coordinates.json.
 *
 * Updates ONLY rows where lat and lng are both null — existing
 * coordinates (geocoded or hand-set) are never touched, so re-running
 * changes nothing. Every seed entry is bounds-checked (Ottawa box)
 * before any write; a violator fails the run loudly with exit 2.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (venues exposes no
 * policies). Prints: rows updated, rows still without coordinates
 * (name + live event count, most events first), seed entries that
 * matched no venue, and live-events-with-coordinates before -> after.
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

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop seed:venues: backfill venue coordinates from the seed file.\n" +
        "usage: npm run seed:venues --workspace @seatpop/worker [-- --dry-run]\n" +
        "  --dry-run    print the plan and write nothing.",
    );
    return 0;
  }
  const dryRun = args.includes("--dry-run");
  loadDotenv();
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error("seed:venues needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  const deps: Deps = { url: supabaseUrl, serviceKey };

  const entries = loadSeedEntries();
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.key)) problems.push(`${entry.key}: duplicate key`);
    seen.add(entry.key);
    const bounds = seedBoundsError(entry);
    if (bounds) problems.push(bounds);
  }
  if (problems.length > 0) {
    console.error("seed:venues: seed file invalid, writing nothing:");
    for (const problem of problems) console.error(`  ${problem}`);
    return 2;
  }

  const venues = await rest<VenueRowLite[]>(
    deps,
    "venues",
    "?select=id,name,lat,lng&order=name",
  );
  const now = encodeURIComponent(new Date().toISOString());
  const live = await rest<{ venue_id: string | null }[]>(
    deps,
    "events",
    `?select=venue_id&status=not.in.(cancelled,full)&starts_at=gt.${now}` +
      "&venue_id=not.is.null&limit=5000",
  );
  const liveCounts = new Map<string, number>();
  for (const row of live) {
    if (row.venue_id) liveCounts.set(row.venue_id, (liveCounts.get(row.venue_id) ?? 0) + 1);
  }
  const coordById = new Map(
    venues.map((row) => [row.id, row.lat !== null && row.lng !== null]),
  );
  const before = live.filter((row) => coordById.get(row.venue_id ?? "")).length;

  const plan = planVenueUpdates(venues, entries, liveCounts);
  if (!dryRun) {
    for (const update of plan.updates) {
      await rest(deps, "venues", `?id=eq.${update.id}`, {
        method: "PATCH",
        body: { lat: update.lat, lng: update.lng },
        prefer: "return=minimal",
      });
    }
  }
  const after =
    before +
    plan.updates.reduce(
      (sum, update) => sum + (liveCounts.get(update.id) ?? 0),
      0,
    );

  console.log(
    `seed:venues: ${entries.length} entries, ${venues.length} venue rows, ` +
      `${live.length} live events${dryRun ? " (dry run — no writes)" : ""}`,
  );
  console.log(`seed:venues: live events with coordinates: ${before} -> ${after}`);
  console.log(`seed:venues: updated ${plan.updates.length} venue row(s)`);
  for (const update of plan.updates) {
    console.log(`  ${update.name} <- ${update.key} (${update.lat}, ${update.lng})`);
  }
  console.log(
    `seed:venues: ${plan.stillMissing.length} venue row(s) still without coordinates`,
  );
  for (const row of plan.stillMissing) {
    console.log(`  ${row.liveEvents} live event(s): ${row.name}`);
  }
  console.log(
    `seed:venues: ${plan.unmatchedEntries.length} seed entries matched no venue: ` +
      (plan.unmatchedEntries.length > 0 ? plan.unmatchedEntries.join(", ") : "(none)"),
  );
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `seed:venues failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
