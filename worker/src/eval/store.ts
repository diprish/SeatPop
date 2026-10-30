import type { StoreConfig } from "../ingest/store";
import type { EvalPoolRow } from "./sample";

/**
 * Supabase reads for eval export (phase 3). Same fetch-only, service-role
 * REST pattern as ingestion/enrichment. Only listing text and metadata
 * are selected — never enrichment rows, so the sample cannot leak a
 * model's answer into the labeling CSV.
 */

async function rest<T>(
  config: StoreConfig,
  tablePath: string,
  query: string,
): Promise<T> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = config.url.replace(/\/$/, "");
  const response = await fetchImpl(`${base}/rest/v1/${tablePath}${query}`, {
    method: "GET",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`supabase ${tablePath} failed: HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text === "") {
    throw new Error(`supabase ${tablePath} returned an empty body`);
  }
  return JSON.parse(text) as T;
}

interface EvalPoolDbRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  venue: { name: string } | null;
  src: { name: string } | null;
}

/** Every event with its listing text, venue name, and primary source. */
export async function listEvalPool(
  config: StoreConfig,
): Promise<EvalPoolRow[]> {
  // The !events_source_id_fkey hint disambiguates the direct FK from the
  // many-to-many path through event_sources (else PostgREST answers 300).
  const rows = await rest<EvalPoolDbRow[]>(config, "events", "?select=id,title,description,category," +
      "venue:venues(name),src:sources!events_source_id_fkey(name)" +
      "&order=id.asc&limit=10000");
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    venueName: row.venue?.name ?? null,
    source: row.src?.name ?? "(unknown source)",
    category: row.category,
  }));
}
