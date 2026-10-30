import { z } from "zod";

/**
 * Household preferences (phases 4-5). One zod schema validates the guest
 * JSON, the saved-preferences API, the profile-parse output, and the
 * synthetic eval households — a single choke point.
 *
 * Privacy (CONTEXT rule 4): members are age bands only. Never names,
 * birth dates, full postal codes, or street addresses — the schema has
 * no fields for them, and zod strips unknown keys.
 */

/** Member age bands. Mirrored by the CHECK on members.age_band in the
 * households migration — keep both lists in sync. */
export const AGE_BANDS = [
  "baby",
  "preschool",
  "kids",
  "teens",
  "adults",
  "seniors",
] as const;
export const AgeBandSchema = z.enum(AGE_BANDS);
export type AgeBand = z.infer<typeof AgeBandSchema>;

/** Band ranges (years, inclusive). 130 is the shared "+∞" (enrichment max). */
export const AGE_BAND_RANGES: Record<AgeBand, { min: number; max: number }> = {
  baby: { min: 0, max: 2 },
  preschool: { min: 3, max: 5 },
  kids: { min: 6, max: 12 },
  teens: { min: 13, max: 17 },
  adults: { min: 18, max: 64 },
  seniors: { min: 65, max: 130 },
};

/** Adjacent bands pulled in when include_adjacent is true (the default). */
export const AGE_BAND_ADJACENT: Record<AgeBand, AgeBand[]> = {
  baby: ["preschool"],
  preschool: ["baby", "kids"],
  kids: ["preschool", "teens"],
  teens: ["kids", "adults"],
  adults: ["teens", "seniors"],
  seniors: ["adults"],
};

/** Effective [min, max] for a member, with optional adjacent expansion. */
export function effectiveBandRange(
  band: AgeBand,
  includeAdjacent: boolean,
): { min: number; max: number } {
  const bands = includeAdjacent
    ? [band, ...AGE_BAND_ADJACENT[band]]
    : [band];
  const ranges = bands.map((b) => AGE_BAND_RANGES[b] as { min: number; max: number });
  return {
    min: Math.min(...ranges.map((r) => r.min)),
    max: Math.max(...ranges.map((r) => r.max)),
  };
}

export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

/** Parts of day with hour bounds [start, end) in event-local time. */
export const DAY_PARTS = ["morning", "afternoon", "evening", "night"] as const;
export const DayPartSchema = z.enum(DAY_PARTS);
export type DayPart = z.infer<typeof DayPartSchema>;

export const DAY_PART_HOURS: Record<DayPart, { start: number; end: number }> = {
  morning: { start: 5, end: 12 },
  afternoon: { start: 12, end: 17 },
  evening: { start: 17, end: 22 },
  night: { start: 22, end: 29 }, // 22:00-04:59; end > 24 wraps past midnight
};

/** True when a local hour falls in the part (night wraps past midnight). */
export function hourInPart(hour: number, part: DayPart): boolean {
  const { start, end } = DAY_PART_HOURS[part] as { start: number; end: number };
  if (end <= 24) return hour >= start && hour < end;
  return hour >= start || hour < end - 24;
}

/**
 * Category age fallback for events with no enriched ages. Deliberately
 * permissive (all-ages except camps): we never exclude on an invented
 * age, and every fallback row is flagged "check the age group".
 * Mirrored by the CASE in recommend_candidates — keep in sync.
 */
export const CATEGORY_AGE_FALLBACK: Record<string, { min: number; max: number }> = {
  classes: { min: 0, max: 130 },
  camps: { min: 5, max: 17 },
  sports: { min: 0, max: 130 },
  arts: { min: 0, max: 130 },
  music: { min: 0, max: 130 },
  museums: { min: 0, max: 130 },
  outdoors: { min: 0, max: 130 },
  festivals: { min: 0, max: 130 },
  markets: { min: 0, max: 130 },
  workshops: { min: 0, max: 130 },
  library: { min: 0, max: 130 },
  community: { min: 0, max: 130 },
};

export function categoryAgeFallback(category: string | null): {
  min: number;
  max: number;
} {
  return (
    (category !== null
      ? CATEGORY_AGE_FALLBACK[category]
      : undefined) ?? { min: 0, max: 130 }
  );
}

/** Forward sortation area: first 3 characters of a Canadian postal code. */
export const FsaSchema = z
  .string()
  .regex(/^[A-Za-z]\d[A-Za-z]$/, "fsa must be 3 characters like K1S")
  .transform((s) => s.toUpperCase());

const AvailabilitySchema = z
  .object({
    mon: z.array(DayPartSchema).optional(),
    tue: z.array(DayPartSchema).optional(),
    wed: z.array(DayPartSchema).optional(),
    thu: z.array(DayPartSchema).optional(),
    fri: z.array(DayPartSchema).optional(),
    sat: z.array(DayPartSchema).optional(),
    sun: z.array(DayPartSchema).optional(),
  })
  .optional();

export const HouseholdMemberSchema = z.object({
  age_band: AgeBandSchema,
  include_adjacent: z.boolean().default(true),
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

export const PreferencesSchema = z.object({
  members: z.array(HouseholdMemberSchema).min(1),
  max_price_cents: z.number().int().min(0).optional(),
  free_only: z.boolean().default(false),
  max_distance_km: z.number().positive().optional(),
  fsa: FsaSchema.optional(),
  availability: AvailabilitySchema,
  language: z.array(z.string().min(1)).default([]),
  accessibility: z.array(z.string().min(1)).default([]),
  interests: z.array(z.string().min(1)).default([]),
  avoid: z.array(z.string().min(1)).default([]),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
