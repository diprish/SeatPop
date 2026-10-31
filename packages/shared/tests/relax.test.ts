import { describe, expect, it } from "vitest";
import {
  ALL_AGES_MEMBERS,
  applyRelaxation,
  relaxationsFor,
} from "../src/relax";
import {
  PreferencesSchema,
  effectiveBandRange,
  type Preferences,
} from "../src/preferences";

const FULL: Preferences = PreferencesSchema.parse({
  members: [{ age_band: "kids" }],
  max_price_cents: 2500,
  free_only: true,
  max_distance_km: 10,
  fsa: "K2S",
  availability: { sat: ["morning"] },
  language: ["English"],
  accessibility: ["wheelchair"],
  interests: ["music"],
});

const BARE: Preferences = PreferencesSchema.parse({
  members: [{ age_band: "adults" }],
});

describe("relaxationsFor", () => {
  it("returns all five groups for fully constrained prefs", () => {
    const relaxed = relaxationsFor(FULL);
    expect(relaxed.map((r) => r.id)).toEqual([
      "availability",
      "distance",
      "budget",
      "age",
      "language_access",
    ]);
    expect(relaxed.map((r) => r.label)).toEqual([
      "More times",
      "Any distance",
      "Any price",
      "All ages",
      "Any language & access",
    ]);
    for (const r of relaxed) {
      expect(PreferencesSchema.safeParse(r.prefs).success).toBe(true);
    }
  });

  it("skips groups that are not set (age always applies)", () => {
    expect(relaxationsFor(BARE).map((r) => r.id)).toEqual(["age"]);
    const emptyAvail = PreferencesSchema.parse({
      members: [{ age_band: "adults" }],
      availability: {},
    });
    expect(relaxationsFor(emptyAvail).map((r) => r.id)).toEqual(["age"]);
  });

  it("clears both budget halves and preserves everything else", () => {
    const budget = relaxationsFor(FULL).find((r) => r.id === "budget")?.prefs;
    expect(budget?.free_only).toBe(false);
    expect(budget?.max_price_cents).toBeUndefined();
    expect(budget?.max_distance_km).toBe(10);
    expect(budget?.availability).toEqual({ sat: ["morning"] });
  });

  it("covers every age 0–130 with the all-ages members", () => {
    let min = 131;
    let max = -1;
    for (const member of ALL_AGES_MEMBERS) {
      const range = effectiveBandRange(member.age_band, member.include_adjacent);
      min = Math.min(min, range.min);
      max = Math.max(max, range.max);
    }
    expect(min).toBe(0);
    expect(max).toBe(130);
  });
});

describe("applyRelaxation", () => {
  it("returns the relaxed prefs or null", () => {
    expect(applyRelaxation(FULL, "distance")?.max_distance_km).toBeUndefined();
    expect(applyRelaxation(FULL, "distance")?.fsa).toBe("K2S");
    expect(applyRelaxation(BARE, "distance")).toBeNull();
    expect(applyRelaxation(FULL, "bogus")).toBeNull();
  });
});
