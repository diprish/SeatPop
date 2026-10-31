import type { Preferences } from "./preferences";

/**
 * Empty-state relaxations: prefs with one constraint group dropped, so
 * the app can name the filter that removed everything and offer one-tap
 * widening. Single source for the worker diagnose path and the web
 * empty state (both import this; they cannot drift).
 */

export const RELAX_IDS = [
  "availability",
  "distance",
  "budget",
  "age",
  "language_access",
] as const;
export type RelaxId = (typeof RELAX_IDS)[number];

export interface Relaxation {
  id: RelaxId;
  label: string;
  prefs: Preferences;
}

/** Members covering every age 0–130 (baby + kids + adults, adjacent on). */
export const ALL_AGES_MEMBERS: Preferences["members"] = [
  { age_band: "baby", include_adjacent: true },
  { age_band: "kids", include_adjacent: true },
  { age_band: "adults", include_adjacent: true },
];

type Droppable = "availability" | "max_distance_km" | "max_price_cents";

function without(prefs: Preferences, ...keys: Droppable[]): Preferences {
  const next = { ...prefs };
  for (const key of keys) delete next[key];
  return next;
}

/** One relaxation per constraint group actually set (age always). */
export function relaxationsFor(prefs: Preferences): Relaxation[] {
  const out: Relaxation[] = [];
  if (prefs.availability && Object.keys(prefs.availability).length > 0) {
    out.push({
      id: "availability",
      label: "More times",
      prefs: without(prefs, "availability"),
    });
  }
  if (prefs.max_distance_km !== undefined) {
    out.push({
      id: "distance",
      label: "Any distance",
      prefs: without(prefs, "max_distance_km"),
    });
  }
  if (prefs.free_only || prefs.max_price_cents !== undefined) {
    out.push({
      id: "budget",
      label: "Any price",
      prefs: { ...without(prefs, "max_price_cents"), free_only: false },
    });
  }
  out.push({
    id: "age",
    label: "All ages",
    prefs: { ...prefs, members: ALL_AGES_MEMBERS },
  });
  if (prefs.language.length > 0 || prefs.accessibility.length > 0) {
    out.push({
      id: "language_access",
      label: "Any language & access",
      prefs: { ...prefs, language: [], accessibility: [] },
    });
  }
  return out;
}

/** Relaxed prefs for one id, or null when it changes nothing / unknown. */
export function applyRelaxation(
  prefs: Preferences,
  id: string,
): Preferences | null {
  return relaxationsFor(prefs).find((r) => r.id === id)?.prefs ?? null;
}
