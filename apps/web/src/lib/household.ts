import {
  PreferencesSchema,
  type AgeBand,
  type DayPart,
  type Preferences,
  type Weekday,
} from "@seatpop/shared";

/**
 * Guest household state (client-safe: no node imports). The guest
 * household lives in localStorage under HOUSEHOLD_STORAGE_KEY; first run
 * opens the built-in sample so results show with no sign-up.
 * No names, no addresses — the schema has no fields for them.
 */

export const HOUSEHOLD_STORAGE_KEY = "seatpop_household";
export const THEME_STORAGE_KEY = "seatpop_theme";

/** Built-in sample: Ottawa K2S, one adult, one kid, one preschooler. */
export const SAMPLE_HOUSEHOLD: Preferences = PreferencesSchema.parse({
  members: [
    { age_band: "adults" },
    { age_band: "kids" },
    { age_band: "preschool" },
  ],
  fsa: "K2S",
  max_distance_km: 20,
});

export const BAND_LABELS: Record<AgeBand, string> = {
  baby: "Baby (0–2)",
  preschool: "Preschool (3–5)",
  kids: "Kids (6–12)",
  teens: "Teens (13–17)",
  adults: "Adults (18–64)",
  seniors: "Seniors (65+)",
};

export function loadHousehold(): Preferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HOUSEHOLD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = PreferencesSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) return null;
    // Legacy stores may repeat a band; read them as one band present.
    return dedupeMembers(parsed.data);
  } catch {
    return null;
  }
}

export function saveHousehold(prefs: Preferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOUSEHOLD_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode etc: guest mode still works for the session.
  }
}

export function addMember(prefs: Preferences, band: AgeBand): Preferences {
  // One chip per band: selecting a present band is a no-op, never a count.
  if (prefs.members.some((member) => member.age_band === band)) return prefs;
  return {
    ...prefs,
    members: [...prefs.members, { age_band: band, include_adjacent: true }],
  };
}

/**
 * Collapse repeated bands to one member each (first occurrence wins,
 * order preserved). Stored/API shapes stay arrays, so legacy dup
 * members load without error and simply read as one band present.
 */
export function dedupeMembers(prefs: Preferences): Preferences {
  const seen = new Set<AgeBand>();
  const members = prefs.members.filter((member) => {
    if (seen.has(member.age_band)) return false;
    seen.add(member.age_band);
    return true;
  });
  if (members.length === prefs.members.length) return prefs;
  return { ...prefs, members };
}

export function removeMember(prefs: Preferences, index: number): Preferences {
  return { ...prefs, members: prefs.members.filter((_, i) => i !== index) };
}

/** Mirrors FsaSchema (letter-digit-letter); the API re-validates. */
export function isFsaValid(fsa: string): boolean {
  return /^[A-Za-z]\d[A-Za-z]$/.test(fsa.trim());
}

export function setFsa(prefs: Preferences, fsa: string | undefined): Preferences {
  if (fsa === undefined || fsa.trim() === "") {
    const next = { ...prefs };
    delete next.fsa;
    return next;
  }
  return { ...prefs, fsa: fsa.trim().toUpperCase() };
}

export function budgetDollars(prefs: Preferences): number | undefined {
  return prefs.max_price_cents === undefined
    ? undefined
    : prefs.max_price_cents / 100;
}

export function setBudgetDollars(
  prefs: Preferences,
  dollars: number | undefined,
): Preferences {
  if (dollars === undefined || !Number.isFinite(dollars) || dollars < 0) {
    const next = { ...prefs };
    delete next.max_price_cents;
    return next;
  }
  return { ...prefs, max_price_cents: Math.round(dollars * 100) };
}

export function setFreeOnly(prefs: Preferences, freeOnly: boolean): Preferences {
  return { ...prefs, free_only: freeOnly };
}

export function setDistanceKm(
  prefs: Preferences,
  km: number | undefined,
): Preferences {
  if (km === undefined || !Number.isFinite(km) || km <= 0) {
    const next = { ...prefs };
    delete next.max_distance_km;
    return next;
  }
  return { ...prefs, max_distance_km: km };
}

export function toggleAvailability(
  prefs: Preferences,
  day: Weekday,
  part: DayPart,
): Preferences {
  const current = prefs.availability?.[day] ?? [];
  const nextDay = current.includes(part)
    ? current.filter((p) => p !== part)
    : [...current, part];
  const availability = { ...prefs.availability };
  if (nextDay.length === 0) {
    delete availability[day];
  } else {
    availability[day] = nextDay;
  }
  if (Object.keys(availability).length === 0) {
    const next = { ...prefs };
    delete next.availability;
    return next;
  }
  return { ...prefs, availability };
}

function canonicalAvailability(
  availability: Preferences["availability"],
): Record<string, string[]> | null {
  if (!availability) return null;
  const out: Record<string, string[]> = {};
  for (const day of Object.keys(availability).sort()) {
    const parts = availability[day as Weekday];
    if (parts) out[day] = [...parts].sort();
  }
  return out;
}

function canonicalPrefs(prefs: Preferences): string {
  const sorted = (values: string[] | undefined): string[] =>
    [...(values ?? [])].sort();
  return JSON.stringify({
    members: prefs.members.map((member) => [
      member.age_band,
      member.include_adjacent ?? true,
    ]),
    fsa: prefs.fsa ?? null,
    max_price_cents: prefs.max_price_cents ?? null,
    free_only: prefs.free_only ?? false,
    max_distance_km: prefs.max_distance_km ?? null,
    availability: canonicalAvailability(prefs.availability),
    language: sorted(prefs.language),
    accessibility: sorted(prefs.accessibility),
    interests: sorted(prefs.interests),
    avoid: sorted(prefs.avoid),
  });
}

/**
 * True while the household in use is the built-in sample, unchanged.
 * Value comparison (key and array order ignored), derived from the
 * current prefs on every render — never stored anywhere.
 */
export function isSampleHousehold(prefs: Preferences): boolean {
  return canonicalPrefs(prefs) === canonicalPrefs(SAMPLE_HOUSEHOLD);
}

/** One-line summary for the collapsed panel. */
export function householdSummary(prefs: Preferences): string {
  const members =
    prefs.members.length === 1 ? "1 member" : `${prefs.members.length} members`;
  const area = prefs.fsa ?? "no area";
  const distance =
    prefs.max_distance_km === undefined ? "any distance" : `${prefs.max_distance_km} km`;
  return `${members} · ${area} · ${distance}`;
}
