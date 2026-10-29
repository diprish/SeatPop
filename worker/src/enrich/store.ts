import type { StoreConfig } from "../ingest/store";

/**
 * Supabase store for enrichment (phase 2). Same fetch-only, service-role
 * REST pattern as ingestion. All reads are small (pilot scale), so
 * filtering and counting happen client-side.
 */

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
    throw new Error(`supabase ${tablePath} failed: HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text === "") {
    if (init.prefer?.includes("return=minimal")) return undefined as T;
    throw new Error(`supabase ${tablePath} returned an empty body`);
  }
  return JSON.parse(text) as T;
}

export interface EnrichCandidate {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  timezone: string;
  category: string | null;
  venueName: string | null;
  /** Existing enrichment source_hash, or null when never enriched. */
  sourceHash: string | null;
}

interface CandidateRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  timezone: string;
  category: string | null;
  venue: { name: string } | null;
  event_enrichment: { source_hash: string | null } | null;
}

/** Every event, soonest first, with its current enrichment hash (if any). */
export async function listCandidates(
  config: StoreConfig,
): Promise<EnrichCandidate[]> {
  const rows = await rest<CandidateRow[]>(config, "events", {
    query:
      "?select=id,title,description,starts_at,timezone,category," +
      "venue:venues(name),event_enrichment(source_hash)" +
      "&order=starts_at.asc&limit=10000",
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    starts_at: r.starts_at,
    timezone: r.timezone,
    category: r.category,
    venueName: r.venue?.name ?? null,
    sourceHash: r.event_enrichment?.source_hash ?? null,
  }));
}

export interface EnrichmentUpsert {
  event_id: string;
  age_min: number | null;
  age_max: number | null;
  needs_adult: boolean | null;
  setting: string | null;
  energy: string | null;
  crowd: string | null;
  duration_min: number | null;
  language: string | null;
  accessibility: string[];
  registration_hint: string | null;
  registration_opens_at: string | null;
  summary_short: string | null;
  tags: string[];
  /** pgvector literal "[0.1,...]"; omit to leave an existing one alone. */
  embedding?: string;
  evidence: Record<string, { value: unknown; quote: string | null }>;
  model: string;
  prompt_version: string;
  source_hash: string;
  confidence: number;
}

export function upsertEnrichment(
  config: StoreConfig,
  row: EnrichmentUpsert,
): Promise<void> {
  return rest<void>(config, "event_enrichment", {
    method: "POST",
    query: "?on_conflict=event_id",
    body: row,
    prefer: "return=minimal,resolution=merge-duplicates",
  });
}

export interface PricingUpsert {
  event_id: string;
  price_kind: string;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  currency: string | null;
  price_text: string | null;
  evidence_quote: string | null;
  fee_notes: string | null;
}

export function upsertPricing(
  config: StoreConfig,
  row: PricingUpsert,
): Promise<void> {
  return rest<void>(config, "event_pricing", {
    method: "POST",
    query: "?on_conflict=event_id",
    body: row,
    prefer: "return=minimal,resolution=merge-duplicates",
  });
}

export interface MissingEmbedding {
  event_id: string;
  summary_short: string | null;
  tags: string[];
  title: string;
  starts_at: string;
}

interface MissingEmbeddingRow {
  event_id: string;
  summary_short: string | null;
  tags: string[] | null;
  event: { title: string; starts_at: string } | null;
}

/** Enriched rows still missing an embedding (any age; caller gates 30d). */
export async function listMissingEmbeddings(
  config: StoreConfig,
): Promise<MissingEmbedding[]> {
  const rows = await rest<MissingEmbeddingRow[]>(config, "event_enrichment", {
    query:
      "?select=event_id,summary_short,tags,event:events(title,starts_at)" +
      "&embedding=is.null&limit=10000",
  });
  const out: MissingEmbedding[] = [];
  for (const row of rows) {
    if (!row.event) continue;
    out.push({
      event_id: row.event_id,
      summary_short: row.summary_short,
      tags: row.tags ?? [],
      title: row.event.title,
      starts_at: row.event.starts_at,
    });
  }
  return out;
}

export function updateEmbedding(
  config: StoreConfig,
  eventId: string,
  vectorLiteral: string,
): Promise<void> {
  return rest<void>(config, "event_enrichment", {
    method: "PATCH",
    query: `?event_id=eq.${encodeURIComponent(eventId)}`,
    body: { embedding: vectorLiteral },
    prefer: "return=minimal",
  });
}

/** Category + pricing-kind tallies for the run report. */
export async function reportTallies(config: StoreConfig): Promise<{
  byCategory: Map<string, number>;
  priceUnknown: number;
  priceTotal: number;
}> {
  const events = await rest<Array<{ category: string | null }>>(config, "events", {
    query: "?select=category&limit=10000",
  });
  const pricing = await rest<Array<{ price_kind: string }>>(
    config,
    "event_pricing",
    { query: "?select=price_kind&limit=10000" },
  );
  const byCategory = new Map<string, number>();
  for (const row of events) {
    const key = row.category ?? "(none)";
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  return {
    byCategory,
    priceUnknown: pricing.filter((p) => p.price_kind === "unknown").length,
    priceTotal: pricing.length,
  };
}
