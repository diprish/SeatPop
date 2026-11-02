import {
  AGE_BAND_RANGES,
  categoryAgeFallback,
  effectiveBandRange,
  type AgeBand,
} from "./preferences";

/**
 * Per-member age fit (ranking only — the SQL hard constraints in
 * recommend_candidates decide what QUALIFIES; this decides what ranks
 * first). Client-safe: the web Why sheet and the worker scorer share it.
 *
 * include_adjacent widens each member's band at the SQL layer, so an
 * adjacent-only match (Babytime 0-1 for a preschooler) qualifies exactly
 * like an exact one. Scoring must then prefer exact-band fits, or the
 * top picks read as wrong for the household.
 */

export type AgeFitLevel = "exact" | "adjacent" | "unknown" | "none";

export interface AgeFitEvent {
  age_min: number | null;
  age_max: number | null;
  category?: string | null;
}

export interface AgeFitMember {
  age_band: AgeBand;
  include_adjacent?: boolean;
}

function overlaps(
  minA: number,
  maxA: number,
  minB: number,
  maxB: number,
): boolean {
  return minA <= maxB && maxA >= minB;
}

/**
 * Exact-band overlap: the ranges share more than a single boundary
 * year, or the event range sits wholly inside the band (so point
 * events like "age 3", or months-born "0-0", still fit). A range that
 * merely touches the band at one edge year (Toddlertime 1-3 vs
 * preschool 3-5, sharing only age 3) is not exact.
 */
function overlapsExactly(
  effMin: number,
  effMax: number,
  bandMin: number,
  bandMax: number,
): boolean {
  const lo = Math.max(effMin, bandMin);
  const hi = Math.min(effMax, bandMax);
  if (lo > hi) return false;
  if (hi - lo >= 1) return true;
  return effMin >= bandMin && effMax <= bandMax;
}

/**
 * One member's fit for one candidate. Both ages missing is "unknown"
 * (category-default fallback); otherwise the effective range is the
 * stated sides with the same per-side category fallback the SQL uses,
 * overlapped against the member's band as stated ("exact", boundary
 * touch excepted — see overlapsExactly) or as include_adjacent
 * expands it ("adjacent"). "none" is no overlap even expanded —
 * reachable per member whenever another member carries the SQL age
 * constraint (the event fits the household, not this member).
 */
export function fitLevelForMember(
  event: AgeFitEvent,
  member: AgeFitMember,
): AgeFitLevel {
  if (event.age_min === null && event.age_max === null) return "unknown";
  const fallback = categoryAgeFallback(event.category ?? null);
  const effMin = event.age_min ?? fallback.min;
  const effMax = event.age_max ?? fallback.max;
  const stated = AGE_BAND_RANGES[member.age_band] as {
    min: number;
    max: number;
  };
  if (overlapsExactly(effMin, effMax, stated.min, stated.max)) {
    return "exact";
  }
  if (member.include_adjacent ?? true) {
    const expanded = effectiveBandRange(member.age_band, true);
    if (overlaps(effMin, effMax, expanded.min, expanded.max)) {
      return "adjacent";
    }
  }
  return "none";
}

/** Every member's level, in household order. */
export function fitLevelsForHousehold(
  event: AgeFitEvent,
  members: AgeFitMember[],
): AgeFitLevel[] {
  return members.map((member) => fitLevelForMember(event, member));
}

/** How many distinct members fit exactly (the count term in scoring). */
export function countExactFits(
  event: AgeFitEvent,
  members: AgeFitMember[],
): number {
  return fitLevelsForHousehold(event, members).filter(
    (level) => level === "exact",
  ).length;
}

export type CandidateAgeTier = "exact" | "unknown" | "adjacent";

/**
 * Candidate tier for scoring: exact when any member fits exactly,
 * unknown when the ages are missing, otherwise adjacent. A no-overlap
 * member list maps to adjacent (the lowest tier) — unreachable for SQL
 * candidates, which always overlap at least one expanded band.
 */
export function candidateAgeTier(
  event: AgeFitEvent,
  members: AgeFitMember[],
): CandidateAgeTier {
  const levels = fitLevelsForHousehold(event, members);
  if (levels.includes("exact")) return "exact";
  if (event.age_min === null && event.age_max === null) return "unknown";
  return "adjacent";
}

/** Possessive for the "close to your X age" reason phrase. */
export function possessiveBandLabel(band: AgeBand): string {
  switch (band) {
    case "baby":
      return "baby's";
    case "preschool":
      return "preschooler's";
    case "kids":
      return "kids'";
    case "teens":
      return "teens'";
    case "adults":
      return "adults'";
    case "seniors":
      return "seniors'";
  }
}
