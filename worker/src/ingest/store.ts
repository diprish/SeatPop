import type { EventCategory } from "@seatpop/shared";

/**
 * Supabase store for ingestion. All writes use the service role key
 * (the events/venues tables expose no policies). fetch only, no SDK.
 */

export interface StoreConfig {
  url: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
}

export interface EventRow {
  id: string;
  source_id: string;
  source_url: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  venue_id: string | null;
  raw_text: string | null;
  raw_hash: string | null;
  dedupe_key: string | null;
  category: string | null;
  status: string;
  fetched_at: string;
}

export interface EventInsert {
  source_id: string;
  source_url: string;
  title: string;
  description?: string;
  starts_at: string;
  ends_at?: string;
  timezone: string;
  venue_id?: string;
  raw_text: string;
  raw_hash: string;
  dedupe_key: string;
  category?: EventCategory;
  status: string;
}

export interface VenueRow {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geocode_confidence: number | null;
}

export interface VenueInsert {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  geocode_confidence?: number;
}

export interface SourceRow {
  id: string;
  name: string;
  kind: string;
  url: string;
  city: string;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  robots_ok: boolean | null;
}

async function rest<T>(
  config: StoreConfig,
  tablePath: string,
  init: { method?: string; query?: string; body?: unknown; prefer?: string },
): Promise<T> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = config.url.replace(/\/$/, "");
  const response = await fetchImpl(
    `${base}/rest/v1/${tablePath}${init.query ?? ""}`,
    {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
  );
  if (!response.ok) {
    throw new Error(
      `supabase ${tablePath} failed: HTTP ${response.status}`,
    );
  }
  // Prefer: return=minimal answers 201/204 with an empty body; only
  // representation calls are entitled to rows.
  const text = await response.text();
  if (text === "") {
    if (init.prefer?.includes("return=minimal")) return undefined as T;
    throw new Error(`supabase ${tablePath} returned an empty body`);
  }
  return JSON.parse(text) as T;
}

const eq = (value: string): string => `eq.${encodeURIComponent(value)}`;

export async function listEnabledSources(
  config: StoreConfig,
): Promise<SourceRow[]> {
  return rest<SourceRow[]>(config, "sources", {
    query: `?select=*&enabled=${eq("true")}&order=name`,
  });
}

export async function findEventsByRawHashes(
  config: StoreConfig,
  sourceId: string,
  hashes: string[],
): Promise<Map<string, EventRow>> {
  const out = new Map<string, EventRow>();
  if (hashes.length === 0) return out;
  const rows = await rest<EventRow[]>(config, "events", {
    query: `?select=*&source_id=${eq(sourceId)}&raw_hash=in.(${hashes.map((h) => encodeURIComponent(h)).join(",")})`,
  });
  for (const row of rows) {
    if (row.raw_hash) out.set(row.raw_hash, row);
  }
  return out;
}

export async function findEventsByDedupeKeys(
  config: StoreConfig,
  keys: string[],
): Promise<Map<string, EventRow>> {
  const out = new Map<string, EventRow>();
  if (keys.length === 0) return out;
  const rows = await rest<EventRow[]>(config, "events", {
    query: `?select=*&dedupe_key=in.(${keys.map((k) => encodeURIComponent(k)).join(",")})`,
  });
  for (const row of rows) {
    if (row.dedupe_key) out.set(row.dedupe_key, row);
  }
  return out;
}

export async function insertEvent(
  config: StoreConfig,
  row: EventInsert,
): Promise<EventRow> {
  const rows = await rest<EventRow[]>(config, "events", {
    method: "POST",
    body: row,
    prefer: "return=representation",
  });
  const first = rows[0];
  if (!first) throw new Error("supabase events insert returned no row");
  return first;
}

export async function linkEventSource(
  config: StoreConfig,
  eventId: string,
  sourceId: string,
  sourceUrl: string,
): Promise<void> {
  await rest<unknown>(config, "event_sources", {
    method: "POST",
    query: "?on_conflict=event_id,source_id",
    body: { event_id: eventId, source_id: sourceId, source_url: sourceUrl },
    prefer: "return=minimal,resolution=ignore-duplicates",
  });
}

export async function findVenueByName(
  config: StoreConfig,
  name: string,
): Promise<VenueRow | null> {
  const rows = await rest<VenueRow[]>(config, "venues", {
    query: `?select=*&name=${eq(name)}&limit=1`,
  });
  return rows[0] ?? null;
}

export async function insertVenue(
  config: StoreConfig,
  row: VenueInsert,
): Promise<VenueRow> {
  const rows = await rest<VenueRow[]>(config, "venues", {
    method: "POST",
    body: row,
    prefer: "return=representation",
  });
  const first = rows[0];
  if (!first) throw new Error("supabase venues insert returned no row");
  return first;
}

export async function recordSourceRun(
  config: StoreConfig,
  sourceId: string,
  run: { lastStatus: string; robotsOk: boolean | null },
): Promise<void> {
  await rest<unknown>(config, "sources", {
    method: "PATCH",
    query: `?id=${eq(sourceId)}`,
    body: {
      last_run_at: new Date().toISOString(),
      last_status: run.lastStatus,
      robots_ok: run.robotsOk,
    },
    prefer: "return=minimal",
  });
}

export interface SourceSeed {
  name: string;
  kind: string;
  url: string;
  city?: string;
}

/** Insert sources, ignoring ones already present (matched by url). */
export async function seedSources(
  config: StoreConfig,
  seeds: SourceSeed[],
): Promise<SourceRow[]> {
  if (seeds.length === 0) return [];
  return rest<SourceRow[]>(config, "sources", {
    method: "POST",
    query: "?on_conflict=url",
    body: seeds.map((s) => ({
      name: s.name,
      kind: s.kind,
      url: s.url,
      city: s.city ?? "Ottawa",
      enabled: true,
    })),
    prefer: "return=representation,resolution=ignore-duplicates",
  });
}
