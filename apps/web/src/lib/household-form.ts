import type { AgeBand, Preferences } from "@seatpop/shared";
import {
  addMember,
  budgetDollars,
  isFsaValid,
  removeMember,
  setBudgetDollars,
  setDistanceKm,
  setFreeOnly,
} from "./household";
import { OTTAWA_FSAS } from "./ottawa-fsas";

/**
 * Plain-form logic (For-you input card): every rule the form
 * enforces, as pure functions. The component stays a thin renderer
 * so these units pin the behaviour without a DOM harness.
 */

export const LAST_BAND_NOTICE = "Pick at least one.";

/** Toggle one band; refusing to turn off the last member. */
export function toggleBand(
  prefs: Preferences,
  band: AgeBand,
): { prefs: Preferences; notice: string | null } {
  const index = prefs.members.findIndex(
    (member) => member.age_band === band,
  );
  if (index < 0) return { prefs: addMember(prefs, band), notice: null };
  if (prefs.members.length <= 1) {
    return { prefs, notice: LAST_BAND_NOTICE };
  }
  return { prefs: removeMember(prefs, index), notice: null };
}

export const OTTAWA_FSA_MESSAGE =
  "That doesn't look like an Ottawa postal area (for example K2S).";

/** Uppercase, no whitespace, FSA prefix ("K2S 1A1" -> "K2S"). */
export function normaliseFsaInput(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").slice(0, 3);
}

/** Normalised value is one of the app's known Ottawa areas. */
export function isOttawaFsa(fsa: string): boolean {
  return OTTAWA_FSAS.has(normaliseFsaInput(fsa));
}

/**
 * Friendly postal error; empty means unset and is fine. Format
 * first, then the known-Ottawa list.
 */
export function fsaFieldError(fsa: string | undefined): string | undefined {
  if (fsa === undefined || fsa.trim() === "") return undefined;
  const code = normaliseFsaInput(fsa);
  if (!isFsaValid(code)) return "Enter 3 characters like K2S.";
  return OTTAWA_FSAS.has(code) ? undefined : OTTAWA_FSA_MESSAGE;
}

/** True for the API's 400 "unknown area ..." answers. */
export function isUnknownAreaError(message: string): boolean {
  return /unknown area/i.test(message);
}

/** Distance needs an area to measure from. */
export function distanceAreaError(
  prefs: Preferences,
): string | undefined {
  if (prefs.max_distance_km !== undefined && prefs.fsa === undefined) {
    return "Add a postal area to use Within.";
  }
  return undefined;
}

/** False while the form has anything blocking a search. */
export function canShowPicks(prefs: Preferences): boolean {
  return (
    prefs.members.length > 0 &&
    fsaFieldError(prefs.fsa) === undefined &&
    distanceAreaError(prefs) === undefined
  );
}

/** Selected weekday-part cells across the whole grid. */
export function countTimeSlots(
  availability: Preferences["availability"],
): number {
  if (!availability) return 0;
  return Object.values(availability).reduce(
    (total, parts) => total + (parts?.length ?? 0),
    0,
  );
}

/** Disclosure summary: "Any time" or "N time slots selected". */
export function timeSlotsSummary(
  availability: Preferences["availability"],
): string {
  const count = countTimeSlots(availability);
  if (count === 0) return "Any time";
  return count === 1 ? "1 time slot selected" : `${count} time slots selected`;
}

export const WITHIN_KM = [2, 5, 10, 25] as const;
export const BUDGET_DOLLARS = [10, 25, 50] as const;

/** Select value; off-list currents (sample 20 km) keep their own row. */
export function withinSelectValue(prefs: Preferences): {
  value: string;
  custom: { value: string; label: string } | null;
} {
  const km = prefs.max_distance_km;
  if (km === undefined) return { value: "any", custom: null };
  if ((WITHIN_KM as readonly number[]).includes(km)) {
    return { value: String(km), custom: null };
  }
  return {
    value: String(km),
    custom: { value: String(km), label: `${km} km` },
  };
}

export function applyWithinValue(prefs: Preferences, value: string): Preferences {
  return setDistanceKm(prefs, value === "any" ? undefined : Number(value));
}

/** Free / capped / Any; off-list caps keep their own row. */
export function budgetSelectValue(prefs: Preferences): {
  value: string;
  custom: { value: string; label: string } | null;
} {
  if (prefs.free_only) return { value: "free", custom: null };
  const dollars = budgetDollars(prefs);
  if (dollars === undefined) return { value: "any", custom: null };
  if ((BUDGET_DOLLARS as readonly number[]).includes(dollars)) {
    return { value: String(dollars), custom: null };
  }
  return {
    value: String(dollars),
    custom: { value: String(dollars), label: `up to $${dollars}` },
  };
}

export function applyBudgetValue(prefs: Preferences, value: string): Preferences {
  if (value === "free") {
    return setFreeOnly(setBudgetDollars(prefs, undefined), true);
  }
  if (value === "any") {
    return setFreeOnly(setBudgetDollars(prefs, undefined), false);
  }
  return setFreeOnly(setBudgetDollars(prefs, Number(value)), false);
}
