import type { AgeBand, Preferences } from "@seatpop/shared";

/**
 * Editable chips for parsed household preferences (worker/recommend).
 * Each chip is one confirmed fact the user can keep or remove before
 * the prefs run. Pure derivation, tested; the page renders + edits.
 */

export interface Chip {
  /** Stable key for removal (e.g. "member:0", "budget", "fsa"). */
  key: string;
  label: string;
}

const BAND_LABEL: Record<AgeBand, string> = {
  baby: "baby (0–2)",
  preschool: "preschool (3–5)",
  kids: "kids (6–12)",
  teens: "teens (13–17)",
  adults: "adults (18–64)",
  seniors: "seniors (65+)",
};

const DAY_LABEL: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** Remove a chip's fact from prefs (pure; the page applies the result). */
export function removeChip(prefs: Preferences, key: string): Preferences {
  if (key.startsWith("member:")) {
    const index = Number(key.slice("member:".length));
    return {
      ...prefs,
      members: prefs.members.filter((_, i) => i !== index),
    };
  }
  switch (key) {
    case "budget":
      return { ...prefs, max_price_cents: undefined, free_only: false };
    case "distance":
      return { ...prefs, max_distance_km: undefined };
    case "fsa":
      return { ...prefs, fsa: undefined, max_distance_km: undefined };
    case "availability":
      return { ...prefs, availability: {} };
    case "language":
      return { ...prefs, language: [] };
    case "accessibility":
      return { ...prefs, accessibility: [] };
    case "interests":
      return { ...prefs, interests: [] };
    case "avoid":
      return { ...prefs, avoid: [] };
    default:
      return prefs;
  }
}

export function chipsFor(prefs: Preferences): Chip[] {
  const chips: Chip[] = [];
  prefs.members.forEach((member, index) => {
    chips.push({
      key: `member:${index}`,
      label: BAND_LABEL[member.age_band] as string,
    });
  });
  if (prefs.free_only) {
    chips.push({ key: "budget", label: "free only" });
  } else if (prefs.max_price_cents !== undefined) {
    chips.push({
      key: "budget",
      label: `under $${(prefs.max_price_cents / 100).toFixed(2)}`,
    });
  }
  if (prefs.max_distance_km !== undefined) {
    chips.push({
      key: "distance",
      label: `within ${prefs.max_distance_km} km${prefs.fsa ? ` of ${prefs.fsa}` : ""}`,
    });
  } else if (prefs.fsa) {
    chips.push({ key: "fsa", label: `near ${prefs.fsa}` });
  }
  const days = Object.entries(prefs.availability ?? {});
  if (days.length > 0) {
    const parts = days
      .map(
        ([day, dayParts]) =>
          `${DAY_LABEL[day] ?? day} ${(dayParts as string[]).join("/")}`,
      )
      .join(", ");
    chips.push({ key: "availability", label: parts });
  }
  for (const lang of prefs.language) {
    chips.push({ key: "language", label: lang });
  }
  for (const item of prefs.accessibility) {
    chips.push({ key: "accessibility", label: item });
  }
  for (const interest of prefs.interests) {
    chips.push({ key: "interests", label: `likes ${interest}` });
  }
  for (const term of prefs.avoid) {
    chips.push({ key: "avoid", label: `avoids ${term}` });
  }
  return chips;
}
