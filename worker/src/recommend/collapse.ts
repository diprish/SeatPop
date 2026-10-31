import { branchOf, roomOf } from "@seatpop/shared";
import { normalizeTitle } from "../ingest/dedupe";

/**
 * Same-occurrence twins: library branches list one row per room
 * ("North Gloucester at Room A" / "... at Room B") for a single storytime.
 * Collapse rows that share the normalized title, start instant, and branch
 * into one card (stage 2 keeps the top-scored twin, so the reranker never
 * sees duplicates); the detail view lists the other rooms via
 * findSiblings. Time or branch differences never collapse.
 */

export interface CollapsibleRow {
  title: string;
  starts_at: string;
  venue_name: string | null;
}

/** Canonical start instant; invalid input falls back to the raw string. */
function instantOf(startsAt: string): string {
  const ms = new Date(startsAt).getTime();
  return Number.isNaN(ms) ? startsAt : new Date(ms).toISOString();
}

/** Twins key: normalized title + start instant + normalized branch. */
export function collapseKey(row: CollapsibleRow): string {
  return [
    normalizeTitle(row.title),
    instantOf(row.starts_at),
    normalizeTitle(branchOf(row.venue_name)),
  ].join("|");
}

/**
 * Keep the first row per key, preserving input order. Callers pass the
 * stage-2 scored list, so "first" means top-scored.
 */
export function collapseRows<T extends CollapsibleRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = collapseKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface SiblingRow extends CollapsibleRow {
  event_id: string;
}

export interface Sibling {
  event_id: string;
  venue_name: string;
  room: string | null;
}

/** Rows sharing self's key, minus self — the detail view's room list. */
export function findSiblings<T extends SiblingRow>(
  self: T,
  rows: T[],
): Sibling[] {
  const key = collapseKey(self);
  return rows
    .filter(
      (row) => row.event_id !== self.event_id && collapseKey(row) === key,
    )
    .map((row) => ({
      event_id: row.event_id,
      venue_name: row.venue_name ?? "",
      room: roomOf(row.venue_name),
    }));
}
