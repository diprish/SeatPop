import {
  categoryAgeFallback,
  effectiveBandRange,
  hourInPart,
  type DayPart,
  type Preferences,
  type Weekday,
} from "@seatpop/shared";

/**
 * TypeScript mirror of the recommend_candidates() SQL predicates
 * (migration 0008). Every hard constraint exists in SQL (CONTEXT rule 3);
 * this module re-checks returned rows so the live recommend eval proves
 * SQL/TS agreement — drift fails loudly instead of corrupting results.
 * Unit-tested per constraint; SQL structure is asserted statically in
 * worker/tests/recommend-sql.test.ts.
 */

/** The candidate shape recommend_candidates() returns (subset used here). */
export interface ConstraintEvent {
  event_id: string;
  starts_at: string;
  timezone: string;
  venue_lat: number | null;
  venue_lng: number | null;
  distance_km: number | null;
  category: string | null;
  status: string;
  age_min: number | null;
  age_max: number | null;
  /** Effective kind (post source-policy merge, as the SQL returns it). */
  price_kind: string;
  amount_min_cents: number | null;
  accessibility: string[];
  language: string | null;
}

export type ViolationKind =
  | "age"
  | "distance"
  | "time"
  | "budget"
  | "accessibility"
  | "language"
  | "status"
  | "future";

export interface ConstraintCheck {
  ok: boolean;
  violations: ViolationKind[];
}

/**
 * Effective event ages: per-side coalesce of enriched values against the
 * category fallback (exactly what the SQL eff_min/eff_max do) — a
 * half-stated range keeps its stated side.
 */
export function effectiveEventAges(
  event: Pick<ConstraintEvent, "age_min" | "age_max" | "category">,
): { min: number; max: number } {
  const fallback = categoryAgeFallback(event.category);
  return {
    min: event.age_min ?? fallback.min,
    max: event.age_max ?? fallback.max,
  };
}

/** Age fit: the event range overlaps at least one member's effective band. */
export function ageFits(
  event: Pick<ConstraintEvent, "age_min" | "age_max" | "category">,
  prefs: Pick<Preferences, "members">,
): boolean {
  if (prefs.members.length === 0) return true;
  const { min: effMin, max: effMax } = effectiveEventAges(event);
  return prefs.members.some((member) => {
    const band = effectiveBandRange(
      member.age_band,
      member.include_adjacent,
    );
    return effMin <= band.max && effMax >= band.min;
  });
}

/** Haversine kilometres between two points. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * Distance fit from the SQL-returned distance. Null passes only when
 * unconstrained (unknown venue or area cannot prove proximity).
 */
export function distanceFits(
  event: Pick<ConstraintEvent, "distance_km">,
  prefs: Pick<Preferences, "max_distance_km">,
): boolean {
  if (prefs.max_distance_km === undefined) return true;
  return event.distance_km !== null && event.distance_km <= prefs.max_distance_km;
}

const WEEKDAY_SHORT: Weekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

/** Event-local weekday + hour via Intl (no network, full ICU in Node 20). */
export function localWeekdayHour(
  startsAt: string,
  timezone: string,
): { weekday: Weekday; hour: number } {
  const date = new Date(startsAt);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const weekdayRaw =
    parts.find((p) => p.type === "weekday")?.value.toLowerCase() ?? "";
  // "Sun".."Sat" — slice defensively; unknown values fail closed below.
  const weekday = (weekdayRaw.slice(0, 3) === "sun"
    ? "sun"
    : (weekdayRaw.slice(0, 3) as Weekday)) as Weekday;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
  if (!WEEKDAY_SHORT.includes(weekday) || !Number.isInteger(hour)) {
    throw new Error(`unparseable local time for ${startsAt} ${timezone}`);
  }
  return { weekday, hour: hour === 24 ? 0 : hour };
}

/** Time fit: the event's local (weekday, part) is a listed window. */
export function timeFits(
  event: Pick<ConstraintEvent, "starts_at" | "timezone">,
  prefs: Pick<Preferences, "availability">,
): boolean {
  const availability = prefs.availability ?? {};
  const days = Object.keys(availability);
  if (days.length === 0) return true;
  const { weekday, hour } = localWeekdayHour(event.starts_at, event.timezone);
  const parts = (availability[weekday] ?? []) as DayPart[];
  if (parts.length === 0) return false;
  return parts.some((part) => hourInPart(hour, part));
}

/**
 * Budget fit on the EFFECTIVE kind + amounts: free_only admits free
 * only; otherwise free/unknown pass and priced events need amount_min
 * within budget (null amounts with a set budget cannot prove fit).
 */
export function budgetFits(
  event: Pick<
    ConstraintEvent,
    "price_kind" | "amount_min_cents"
  >,
  prefs: Pick<Preferences, "free_only" | "max_price_cents">,
): boolean {
  if (prefs.free_only) return event.price_kind === "free";
  if (event.price_kind === "free" || event.price_kind === "unknown") {
    return true;
  }
  if (prefs.max_price_cents === undefined) return true;
  return (
    event.amount_min_cents !== null &&
    event.amount_min_cents <= prefs.max_price_cents
  );
}

/**
 * Accessibility fit: every required item must be stated, unless the
 * event states nothing (unstated never excludes — current null rates
 * would otherwise exclude everything).
 */
export function accessibilityFits(
  event: Pick<ConstraintEvent, "accessibility">,
  prefs: Pick<Preferences, "accessibility">,
): boolean {
  if (prefs.accessibility.length === 0) return true;
  if (event.accessibility.length === 0) return true;
  const stated = new Set(event.accessibility.map((s) => s.toLowerCase()));
  return prefs.accessibility.every((req) => stated.has(req.toLowerCase()));
}

/** Language fit: unstated event language never excludes. */
export function languageFits(
  event: Pick<ConstraintEvent, "language">,
  prefs: Pick<Preferences, "language">,
): boolean {
  if (prefs.language.length === 0) return true;
  if (event.language === null) return true;
  const stated = event.language.toLowerCase();
  return prefs.language.some((want) => want.toLowerCase() === stated);
}

/** Status fit: cancelled and full never surface. */
export function statusFits(event: Pick<ConstraintEvent, "status">): boolean {
  return event.status !== "cancelled" && event.status !== "full";
}

/** Future fit: starts strictly after now. */
export function futureFits(
  event: Pick<ConstraintEvent, "starts_at">,
  now: Date = new Date(),
): boolean {
  return new Date(event.starts_at).getTime() > now.getTime();
}

/** All eight constraints at once, naming every violation. */
export function checkConstraints(
  event: ConstraintEvent,
  prefs: Preferences,
  now: Date = new Date(),
): ConstraintCheck {
  const violations: ViolationKind[] = [];
  if (!ageFits(event, prefs)) violations.push("age");
  if (!distanceFits(event, prefs)) violations.push("distance");
  if (!timeFits(event, prefs)) violations.push("time");
  if (!budgetFits(event, prefs)) violations.push("budget");
  if (!accessibilityFits(event, prefs)) violations.push("accessibility");
  if (!languageFits(event, prefs)) violations.push("language");
  if (!statusFits(event)) violations.push("status");
  if (!futureFits(event, now)) violations.push("future");
  return { ok: violations.length === 0, violations };
}
