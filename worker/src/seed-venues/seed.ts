import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Venue coordinate seed: one entry per physical place, matched against
 * venue rows by normalized name substring. Used by `npm run seed:venues`
 * (backfill) and by ingest venue creation (coverage on re-crawl).
 *
 * Match rule: every entry's match strings and the venue name are
 * normalized (lowercase, accents stripped, whitespace collapsed) and a
 * venue matches when it CONTAINS a match string. On multiple matches the
 * LONGEST match wins (most specific place); exact ties prefer file order,
 * so distinctive venues sit before branches in the seed file. Match
 * strings always carry a place qualifier ("Greely at", "Main Branch") —
 * never a bare word — so "Carp Road" cannot match the Carp branch and
 * "Main Hall" cannot match Main.
 */

export const SeedEntrySchema = z.object({
  key: z.string().min(1),
  match: z.array(z.string().min(1)).min(1),
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  source: z.string().min(1),
  verified: z.boolean(),
});
export type SeedEntry = z.infer<typeof SeedEntrySchema>;

/** Ottawa-area acceptance box for seed coordinates (loader rejects outside). */
export const OTTAWA_BOUNDS = {
  minLat: 44.9,
  maxLat: 45.6,
  minLng: -76.4,
  maxLng: -75.2,
} as const;

export function seedFileUrl(): URL {
  return new URL("../../../data/seed/venue-coordinates.json", import.meta.url);
}

let cached: SeedEntry[] | undefined;

/** Load + validate the seed file (cached after first read). */
export function loadSeedEntries(): SeedEntry[] {
  if (!cached) {
    cached = z
      .array(SeedEntrySchema)
      .parse(JSON.parse(readFileSync(seedFileUrl(), "utf8")) as unknown);
  }
  return cached;
}

/** Lowercase, strip accents, collapse whitespace, trim. */
export function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SeedMatch {
  entry: SeedEntry;
  /** Length of the winning normalized match string. */
  matchLength: number;
}

export function matchSeedEntry(
  entries: SeedEntry[],
  venueName: string,
): SeedMatch | null {
  const venue = normalizeVenueName(venueName);
  let best: SeedMatch | null = null;
  for (const entry of entries) {
    for (const raw of entry.match) {
      const needle = normalizeVenueName(raw);
      if (needle === "" || !venue.includes(needle)) continue;
      if (!best || needle.length > best.matchLength) {
        best = { entry, matchLength: needle.length };
      }
    }
  }
  return best;
}

/** Non-null reason when the entry's coordinates fall outside Ottawa. */
export function seedBoundsError(entry: SeedEntry): string | null {
  const { minLat, maxLat, minLng, maxLng } = OTTAWA_BOUNDS;
  const inside =
    Number.isFinite(entry.lat) &&
    Number.isFinite(entry.lng) &&
    entry.lat >= minLat &&
    entry.lat <= maxLat &&
    entry.lng >= minLng &&
    entry.lng <= maxLng;
  if (inside) return null;
  return (
    `${entry.key}: (${entry.lat}, ${entry.lng}) outside Ottawa ` +
    `lat ${minLat}..${maxLat}, lng ${minLng}..${maxLng}`
  );
}

export interface VenueRowLite {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface VenueUpdate {
  id: string;
  name: string;
  key: string;
  lat: number;
  lng: number;
}

export interface VenuePlan {
  /** Rows to update: matched AND both coordinates null. Never overwrites. */
  updates: VenueUpdate[];
  /** Rows still lacking complete coordinates, by live events desc. */
  stillMissing: { id: string; name: string; liveEvents: number }[];
  /** Seed keys that matched no venue row at all. */
  unmatchedEntries: string[];
}

export function planVenueUpdates(
  rows: VenueRowLite[],
  entries: SeedEntry[],
  liveCounts: Map<string, number>,
): VenuePlan {
  const matchedKeys = new Set<string>();
  const updates: VenueUpdate[] = [];
  const stillMissing: VenuePlan["stillMissing"] = [];
  for (const row of rows) {
    const match = matchSeedEntry(entries, row.name);
    if (match) matchedKeys.add(match.entry.key);
    if (row.lat !== null && row.lng !== null) continue;
    if (match && row.lat === null && row.lng === null) {
      updates.push({
        id: row.id,
        name: row.name,
        key: match.entry.key,
        lat: match.entry.lat,
        lng: match.entry.lng,
      });
    } else {
      stillMissing.push({
        id: row.id,
        name: row.name,
        liveEvents: liveCounts.get(row.id) ?? 0,
      });
    }
  }
  stillMissing.sort(
    (a, b) => b.liveEvents - a.liveEvents || a.name.localeCompare(b.name),
  );
  const unmatchedEntries = entries
    .map((entry) => entry.key)
    .filter((key) => !matchedKeys.has(key));
  return { updates, stillMissing, unmatchedEntries };
}

export interface NewVenueCoords {
  lat?: number;
  lng?: number;
  confidence?: number;
}

/**
 * Coordinates for a venue row ingest is about to create: a seed match
 * wins outright (authoritative, no network); otherwise the geocoder runs
 * exactly as before. Seed rows leave geocode_confidence unset — the
 * column describes geocoder output, and seed coordinates are not that.
 */
export async function resolveNewVenueCoords(
  venueLabel: string,
  venueQuery: string,
  entries: SeedEntry[],
  geocode: (
    query: string,
  ) => Promise<{ lat: number; lng: number; confidence: number } | null>,
): Promise<NewVenueCoords> {
  const seed = matchSeedEntry(entries, venueLabel);
  if (seed) return { lat: seed.entry.lat, lng: seed.entry.lng };
  const geo = venueQuery ? await geocode(`${venueQuery}, Ottawa, ON`) : null;
  return { lat: geo?.lat, lng: geo?.lng, confidence: geo?.confidence };
}
