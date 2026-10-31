import {
  ALL_AGES_MEMBERS,
  type AgeBand,
  type Preferences,
} from "@seatpop/shared";

/**
 * Explore filters build prefs on the household context: the same
 * recommend path, narrowed by one band, free-only, and distance.
 */

export interface ExploreFilters {
  band: AgeBand | "any";
  freeOnly: boolean;
  distanceKm: number | undefined;
}

export function buildExplorePrefs(
  household: Preferences,
  filters: ExploreFilters,
): Preferences {
  const next: Preferences = {
    ...household,
    members:
      filters.band === "any"
        ? ALL_AGES_MEMBERS
        : [{ age_band: filters.band, include_adjacent: true }],
    free_only: filters.freeOnly,
  };
  if (filters.distanceKm === undefined) {
    delete next.max_distance_km;
  } else {
    next.max_distance_km = filters.distanceKm;
  }
  return next;
}
