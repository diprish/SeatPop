import { describe, expect, it } from "vitest";
import type { Preferences } from "@seatpop/shared";
import {
  accessibilityFits,
  ageFits,
  budgetFits,
  checkConstraints,
  distanceFits,
  futureFits,
  haversineKm,
  languageFits,
  localWeekdayHour,
  statusFits,
  timeFits,
  type ConstraintEvent,
} from "../src/recommend/constraints";

function prefs(overrides: Partial<Preferences> = {}): Preferences {
  return {
    members: [{ age_band: "kids", include_adjacent: true }],
    free_only: false,
    language: [],
    accessibility: [],
    interests: [],
    avoid: [],
    ...overrides,
  };
}

function event(overrides: Partial<ConstraintEvent> = {}): ConstraintEvent {
  return {
    event_id: "e1",
    starts_at: "2026-11-07T14:00:00.000Z",
    timezone: "America/Toronto",
    venue_lat: 45.42,
    venue_lng: -75.7,
    distance_km: 2,
    category: "music",
    status: "scheduled",
    age_min: 6,
    age_max: 12,
    price_kind: "paid",
    amount_min_cents: 1500,
    accessibility: [],
    language: null,
    ...overrides,
  };
}

describe("age fit", () => {
  it("matches overlapping bands and rejects the rest", () => {
    expect(ageFits(event(), prefs())).toBe(true);
    expect(
      ageFits(event(), prefs({ members: [{ age_band: "baby", include_adjacent: false }] })),
    ).toBe(false);
    // Adjacent expansion: baby pulls in preschool (0-5), still not 6-12.
    expect(
      ageFits(event(), prefs({ members: [{ age_band: "baby", include_adjacent: true }] })),
    ).toBe(false);
    // Any single member fit passes the household.
    expect(
      ageFits(
        event({ age_min: 10, age_max: 14 }),
        prefs({
          members: [
            { age_band: "baby", include_adjacent: false },
            { age_band: "kids", include_adjacent: false },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("falls back to category defaults with half-stated sides kept", () => {
    // Music without ages is all-ages: fits a baby.
    expect(
      ageFits(
        event({ age_min: null, age_max: null, category: "music" }),
        prefs({ members: [{ age_band: "baby", include_adjacent: false }] }),
      ),
    ).toBe(true);
    // Camps default 5-17: a seniors-only household misses.
    expect(
      ageFits(
        event({ age_min: null, age_max: null, category: "camps" }),
        prefs({ members: [{ age_band: "seniors", include_adjacent: false }] }),
      ),
    ).toBe(false);
    // Half-stated: stated min 10 kept, missing max falls back to 130.
    expect(
      ageFits(
        event({ age_min: 10, age_max: null, category: "music" }),
        prefs({ members: [{ age_band: "adults", include_adjacent: false }] }),
      ),
    ).toBe(true);
  });
});

describe("distance fit", () => {
  it("passes unconstrained rows and enforces the cap", () => {
    expect(distanceFits(event({ distance_km: null }), prefs())).toBe(true);
    const capped = prefs({ max_distance_km: 5 });
    expect(distanceFits(event({ distance_km: 3 }), capped)).toBe(true);
    expect(distanceFits(event({ distance_km: 5 }), capped)).toBe(true);
    expect(distanceFits(event({ distance_km: 5.01 }), capped)).toBe(false);
    expect(distanceFits(event({ distance_km: null }), capped)).toBe(false);
  });

  it("computes haversine kilometres", () => {
    expect(haversineKm(45.42, -75.7, 45.42, -75.7)).toBe(0);
    // One degree of latitude at the equator.
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.195, 2);
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(haversineKm(1, 0, 0, 0), 10);
  });
});

/** Next date at/after `from` falling on `utcWeekday` (0=Sun) at 09:00Z. */
function saturdayAt(hourUtc: number): string {
  const from = Date.UTC(2026, 5, 1, 0, 0, 0);
  const date = new Date(from);
  while (date.getUTCDay() !== 6) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

describe("time fit", () => {
  it("resolves local weekday and hour through timezones", () => {
    // June Saturdays are EDT (UTC-4): 13:00Z is 09:00 Saturday Toronto.
    expect(localWeekdayHour(saturdayAt(13), "America/Toronto")).toEqual({
      weekday: "sat",
      hour: 9,
    });
    expect(localWeekdayHour(saturdayAt(13), "UTC")).toEqual({
      weekday: "sat",
      hour: 13,
    });
    // 03:00Z Saturday is 23:00 Friday Toronto.
    expect(localWeekdayHour(saturdayAt(3), "America/Toronto")).toEqual({
      weekday: "fri",
      hour: 23,
    });
  });

  it("matches listed windows only", () => {
    const morning = event({
      starts_at: saturdayAt(13),
      timezone: "America/Toronto",
    });
    expect(timeFits(morning, prefs())).toBe(true);
    expect(
      timeFits(morning, prefs({ availability: { sat: ["morning"] } })),
    ).toBe(true);
    expect(
      timeFits(morning, prefs({ availability: { sat: ["evening"] } })),
    ).toBe(false);
    expect(
      timeFits(morning, prefs({ availability: { sun: ["morning"] } })),
    ).toBe(false);
    const fridayNight = event({
      starts_at: saturdayAt(3),
      timezone: "America/Toronto",
    });
    expect(
      timeFits(fridayNight, prefs({ availability: { fri: ["night"] } })),
    ).toBe(true);
  });
});

describe("budget fit", () => {
  it("admits free only under free_only", () => {
    const freeOnly = prefs({ free_only: true });
    expect(budgetFits(event({ price_kind: "free" }), freeOnly)).toBe(true);
    expect(budgetFits(event({ price_kind: "paid" }), freeOnly)).toBe(false);
    expect(budgetFits(event({ price_kind: "unknown" }), freeOnly)).toBe(false);
  });

  it("checks amounts only for priced events under a budget", () => {
    const budget = prefs({ max_price_cents: 2500 });
    expect(
      budgetFits(event({ price_kind: "paid", amount_min_cents: 1500 }), budget),
    ).toBe(true);
    expect(
      budgetFits(event({ price_kind: "paid", amount_min_cents: 2500 }), budget),
    ).toBe(true);
    expect(
      budgetFits(event({ price_kind: "paid", amount_min_cents: 2501 }), budget),
    ).toBe(false);
    // Null amounts with a set budget cannot prove fit.
    expect(
      budgetFits(event({ price_kind: "paid", amount_min_cents: null }), budget),
    ).toBe(false);
    // Unknown and free pass under any budget.
    expect(
      budgetFits(event({ price_kind: "unknown", amount_min_cents: null }), budget),
    ).toBe(true);
    expect(
      budgetFits(event({ price_kind: "free", amount_min_cents: null }), budget),
    ).toBe(true);
    // No budget: everything priced passes.
    expect(
      budgetFits(event({ price_kind: "paid", amount_min_cents: null }), prefs()),
    ).toBe(true);
  });
});

describe("accessibility and language fit", () => {
  it("requires stated items unless the event states nothing", () => {
    const need = prefs({ accessibility: ["Wheelchair Access"] });
    expect(accessibilityFits(event({ accessibility: [] }), need)).toBe(true);
    expect(
      accessibilityFits(event({ accessibility: ["wheelchair access"] }), need),
    ).toBe(true);
    expect(accessibilityFits(event({ accessibility: ["ASL"] }), need)).toBe(
      false,
    );
    expect(accessibilityFits(event({ accessibility: ["ASL"] }), prefs())).toBe(
      true,
    );
  });

  it("matches stated language, passing unstated", () => {
    const want = prefs({ language: ["English"] });
    expect(languageFits(event({ language: null }), want)).toBe(true);
    expect(languageFits(event({ language: "english" }), want)).toBe(true);
    expect(languageFits(event({ language: "French" }), want)).toBe(false);
    expect(languageFits(event({ language: "French" }), prefs())).toBe(true);
  });
});

describe("status, future, and the combined check", () => {
  it("rejects cancelled, full, and past events", () => {
    expect(statusFits(event({ status: "scheduled" }))).toBe(true);
    expect(statusFits(event({ status: "waitlist" }))).toBe(true);
    expect(statusFits(event({ status: "cancelled" }))).toBe(false);
    expect(statusFits(event({ status: "full" }))).toBe(false);
    const now = new Date("2026-06-01T00:00:00.000Z");
    expect(
      futureFits(event({ starts_at: "2026-07-01T00:00:00.000Z" }), now),
    ).toBe(true);
    expect(
      futureFits(event({ starts_at: "2026-06-01T00:00:00.000Z" }), now),
    ).toBe(false);
  });

  it("names every violation at once", () => {
    const bad = event({
      starts_at: "2020-01-01T00:00:00.000Z",
      status: "cancelled",
      age_min: 65,
      age_max: 70,
      price_kind: "paid",
      amount_min_cents: 99900,
      accessibility: ["ASL"],
      language: "French",
      distance_km: 99,
    });
    const check = checkConstraints(
      bad,
      prefs({
        max_price_cents: 100,
        max_distance_km: 5,
        availability: { sat: ["morning"] },
        language: ["English"],
        accessibility: ["wheelchair access"],
      }),
      new Date("2026-06-01T00:00:00.000Z"),
    );
    expect(check.ok).toBe(false);
    expect(check.violations.sort()).toEqual(
      [
        "age",
        "distance",
        "time",
        "budget",
        "accessibility",
        "language",
        "status",
        "future",
      ].sort(),
    );
    const good = checkConstraints(
      event({ price_kind: "free", accessibility: [] }),
      prefs(),
      new Date("2026-06-01T00:00:00.000Z"),
    );
    expect(good).toEqual({ ok: true, violations: [] });
  });
});
