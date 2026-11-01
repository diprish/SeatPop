import { loadDotenv } from "@seatpop/llm";
import { upsertEnrichment, upsertPricing } from "../enrich/store";
import type { StoreConfig } from "../ingest/store";
import { isDirectExecution } from "../script-entry";
import { loadSeedEntries, matchSeedEntry } from "../seed-venues/seed";
import {
  buildOwnerEnrichment,
  buildOwnerPricing,
  loadOwnerSeed,
  OWNER_SOURCE_NAME,
  OWNER_SOURCE_NOTES,
  OWNER_SOURCE_URL,
  type ValidatedOwnerEvent,
} from "./seed";

/**
 * Load owner-transcribed City events into events + event_sources +
 * event_enrichment + event_pricing. Upsert by source_url+starts_at:
 * re-running converges every row and changes nothing. Never deletes —
 * a retimed event leaves its old key behind with a loud warning, never
 * a silent wipe. Venues resolve by exact name (created when missing,
 * coordinates from the venue seed when it matches); unmatched venues
 * are reported for the owner to review.
 *
 * The manual source stays enabled=false and out of sources.json, so no
 * crawler ever touches it. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (all four tables are service-role-only). --dry-run reads and prints
 * the plan but writes nothing.
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

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  url: string;
  enabled: boolean;
  notes: string | null;
}

async function ensureSource(deps: Deps, dryRun: boolean): Promise<string> {
  const rows = await rest<SourceRow[]>(
    deps,
    "sources",
    `?select=id,name,kind,url,enabled,notes&name=eq.${encodeURIComponent(OWNER_SOURCE_NAME)}`,
  );
  if (rows.length > 1) {
    throw new Error(`${rows.length} source rows named "${OWNER_SOURCE_NAME}" — resolve by hand`);
  }
  const existing = rows[0];
  if (!existing) {
    console.log(
      `  ${dryRun ? "would create" : "creating"} source "${OWNER_SOURCE_NAME}" (user_submitted, disabled)`,
    );
    if (dryRun) return "(dry-run source id)";
    const created = await rest<SourceRow[]>(deps, "sources", "", {
      method: "POST",
      body: {
        name: OWNER_SOURCE_NAME,
        kind: "user_submitted",
        url: OWNER_SOURCE_URL,
        city: "Ottawa",
        enabled: false,
        notes: OWNER_SOURCE_NOTES,
      },
      prefer: "return=representation",
    });
    const row = created[0];
    if (!row) throw new Error("source insert returned no row");
    return row.id;
  }
  // Converge the no-crawler shape; the URL is the operator's to keep.
  const drift: Record<string, unknown> = {};
  if (existing.kind !== "user_submitted") drift["kind"] = "user_submitted";
  if (existing.enabled !== false) drift["enabled"] = false;
  if (existing.notes !== OWNER_SOURCE_NOTES) drift["notes"] = OWNER_SOURCE_NOTES;
  if (existing.url !== OWNER_SOURCE_URL) {
    console.log(`  source URL differs, leaving it: ${existing.url}`);
  }
  const keys = Object.keys(drift);
  if (keys.length > 0) {
    console.log(`  ${dryRun ? "would converge" : "converging"} source (${keys.join(", ")})`);
    if (!dryRun) {
      await rest(deps, "sources", `?id=eq.${existing.id}`, {
        method: "PATCH",
        body: drift,
        prefer: "return=minimal",
      });
    }
  }
  return existing.id;
}

interface VenueRow {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

async function ensureVenue(
  deps: Deps,
  venueName: string,
  dryRun: boolean,
  unmatchedVenues: Set<string>,
): Promise<string> {
  const rows = await rest<VenueRow[]>(
    deps,
    "venues",
    `?select=id,name,lat,lng&name=eq.${encodeURIComponent(venueName)}&limit=10`,
  );
  const seed = matchSeedEntry(loadSeedEntries(), venueName);
  if (rows.length === 0) {
    if (!seed) unmatchedVenues.add(venueName);
    console.log(
      `  ${dryRun ? "would create" : "creating"} venue "${venueName}"` +
        (seed ? ` (${seed.entry.lat}, ${seed.entry.lng} via ${seed.entry.key})` : " (no seed match — null coords)"),
    );
    if (dryRun) return `(dry-run venue id for ${venueName})`;
    const created = await rest<VenueRow[]>(deps, "venues", "", {
      method: "POST",
      body: {
        name: venueName,
        lat: seed?.entry.lat ?? null,
        lng: seed?.entry.lng ?? null,
      },
      prefer: "return=representation",
    });
    const row = created[0];
    if (!row) throw new Error(`venue insert returned no row for "${venueName}"`);
    return row.id;
  }
  if (rows.length > 1) {
    console.log(`  ${rows.length} venue rows named "${venueName}" — using the first`);
  }
  const row = rows[0] as VenueRow;
  if (row.lat === null && row.lng === null && seed) {
    console.log(`  ${dryRun ? "would fill" : "filling"} coords for "${venueName}" via ${seed.entry.key}`);
    if (!dryRun) {
      await rest(deps, "venues", `?id=eq.${row.id}`, {
        method: "PATCH",
        body: { lat: seed.entry.lat, lng: seed.entry.lng },
        prefer: "return=minimal",
      });
    }
  } else if (row.lat === null || row.lng === null) {
    unmatchedVenues.add(venueName);
  }
  return row.id;
}

interface EventRow {
  id: string;
  source_url: string;
  starts_at: string;
  status: string;
}

async function upsertEvent(
  deps: Deps,
  store: StoreConfig,
  sourceId: string,
  venueId: string,
  event: ValidatedOwnerEvent,
  dryRun: boolean,
): Promise<"created" | "updated"> {
  const rows = await rest<EventRow[]>(
    deps,
    "events",
    `?select=id,source_url,starts_at,status&source_id=eq.${sourceId}&source_url=eq.${encodeURIComponent(event.source_url)}&limit=50`,
  );
  const wantMs = Date.parse(event.starts_at);
  const match = rows.find((row) => Date.parse(row.starts_at) === wantMs);
  for (const row of rows) {
    if (row !== match) {
      console.log(
        `  stale key? "${event.title}" already has ${row.starts_at} under the same link (row ${row.id}) — left alone; delete by hand if the date moved`,
      );
    }
  }
  if (!match) {
    console.log(`  ${dryRun ? "would create" : "creating"} event "${event.title}" @ ${event.starts_at}`);
    if (dryRun) return "created";
    const created = await rest<EventRow[]>(deps, "events", "", {
      method: "POST",
      body: {
        source_id: sourceId,
        source_url: event.source_url,
        title: event.title,
        description: null,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        timezone: "America/Toronto",
        venue_id: venueId,
        raw_text: null,
        raw_hash: event.rowHash,
        category: event.category,
        status: "scheduled",
      },
      prefer: "return=representation",
    });
    const row = created[0];
    if (!row) throw new Error(`event insert returned no row for "${event.title}"`);
    await rest(deps, "event_sources", "?on_conflict=event_id,source_id", {
      method: "POST",
      body: { event_id: row.id, source_id: sourceId, source_url: event.source_url },
      prefer: "return=minimal,resolution=merge-duplicates",
    });
    await upsertEnrichment(store, { event_id: row.id, ...buildOwnerEnrichment(event) });
    await upsertPricing(store, { event_id: row.id, ...buildOwnerPricing(event) });
    return "created";
  }
  console.log(`  ${dryRun ? "would update" : "updating"} event "${event.title}" @ ${event.starts_at}`);
  if (match.status !== "scheduled") {
    console.log(`    status is "${match.status}" — left alone`);
  }
  if (dryRun) return "updated";
  await rest(deps, "events", `?id=eq.${match.id}`, {
    method: "PATCH",
    body: {
      title: event.title,
      ends_at: event.ends_at,
      venue_id: venueId,
      raw_hash: event.rowHash,
      category: event.category,
    },
    prefer: "return=minimal",
  });
  await upsertEnrichment(store, { event_id: match.id, ...buildOwnerEnrichment(event) });
  await upsertPricing(store, { event_id: match.id, ...buildOwnerPricing(event) });
  return "updated";
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop seed:owner-events: load owner-transcribed City events.\n" +
        "usage: npm run seed:owner-events --workspace @seatpop/worker [-- --dry-run]\n" +
        "  --dry-run    validate, read, and print the plan; write nothing.\n" +
        "data/seed/owner-curated-events.json is an array of rows:\n" +
        "  {title, venue_name, starts_at (zoned ISO), ends_at?,\n" +
        "   price_kind, amount_min_cents?, amount_max_cents?, price_quote,\n" +
        "   ages_quote?, age_min?, age_max?, source_url (required https),\n" +
        "   category}. Every row is quote-verified; bad rows fail the run.",
    );
    return 0;
  }
  const dryRun = args.includes("--dry-run");
  loadDotenv();
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error("seed:owner-events needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  let events: ValidatedOwnerEvent[];
  try {
    events = loadOwnerSeed();
  } catch (error) {
    console.error(
      `seed:owner-events: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
  console.log(
    `seed:owner-events: rows=${events.length}` + (dryRun ? " (dry run — no writes)" : ""),
  );
  if (events.length === 0) return 0;
  const deps: Deps = { url: supabaseUrl, serviceKey };
  const store: StoreConfig = { url: supabaseUrl, serviceKey };
  const venueIds = new Map<string, string>();
  const unmatchedVenues = new Set<string>();
  const sourceId = await ensureSource(deps, dryRun);
  let created = 0;
  let updated = 0;
  for (const event of events) {
    let venueId = venueIds.get(event.venue_name);
    if (!venueId) {
      venueId = await ensureVenue(deps, event.venue_name, dryRun, unmatchedVenues);
      venueIds.set(event.venue_name, venueId);
    }
    const outcome = await upsertEvent(deps, store, sourceId, venueId, event, dryRun);
    if (outcome === "created") created++;
    else updated++;
  }
  console.log(`seed:owner-events: events created=${created} updated=${updated}`);
  if (unmatchedVenues.size > 0) {
    console.log("seed:owner-events: venues without coordinates (no seed match):");
    for (const name of [...unmatchedVenues].sort()) console.log(`  ${name}`);
  }
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `seed:owner-events failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
