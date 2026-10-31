import { describe, expect, it } from "vitest";
import { AGE_BANDS, PreferencesSchema } from "@seatpop/shared";
import {
  BAND_LABELS,
  SAMPLE_HOUSEHOLD,
  addMember,
  budgetDollars,
  householdSummary,
  isFsaValid,
  removeMember,
  setBudgetDollars,
  setDistanceKm,
  setFreeOnly,
  setFsa,
  toggleAvailability,
} from "../src/lib/household";

describe("sample household", () => {
  it("is valid: Ottawa K2S, adult + kid + preschooler", () => {
    expect(PreferencesSchema.safeParse(SAMPLE_HOUSEHOLD).success).toBe(true);
    expect(SAMPLE_HOUSEHOLD.members.map((m) => m.age_band)).toEqual([
      "adults",
      "kids",
      "preschool",
    ]);
    expect(SAMPLE_HOUSEHOLD.fsa).toBe("K2S");
    expect(SAMPLE_HOUSEHOLD.max_distance_km).toBe(20);
    expect(householdSummary(SAMPLE_HOUSEHOLD)).toBe("3 members · K2S · 20 km");
  });

  it("labels every age band", () => {
    for (const band of AGE_BANDS) {
      expect(BAND_LABELS[band].length).toBeGreaterThan(0);
    }
  });
});

describe("member edits", () => {
  it("adds and removes members without mutating", () => {
    const added = addMember(SAMPLE_HOUSEHOLD, "teens");
    expect(added.members).toHaveLength(4);
    expect(added.members[3]).toEqual({ age_band: "teens", include_adjacent: true });
    expect(SAMPLE_HOUSEHOLD.members).toHaveLength(3);
    const removed = removeMember(added, 0);
    expect(removed.members.map((m) => m.age_band)).toEqual([
      "kids",
      "preschool",
      "teens",
    ]);
  });
});

describe("area, budget, distance", () => {
  it("validates and normalizes the FSA", () => {
    expect(isFsaValid("K2S")).toBe(true);
    expect(isFsaValid("k2s")).toBe(true);
    expect(isFsaValid("K2")).toBe(false);
    expect(isFsaValid("K2S1")).toBe(false);
    expect(isFsaValid("")).toBe(false);
    expect(setFsa(SAMPLE_HOUSEHOLD, "k1s").fsa).toBe("K1S");
    expect(setFsa(SAMPLE_HOUSEHOLD, "").fsa).toBeUndefined();
    expect(setFsa(SAMPLE_HOUSEHOLD, undefined).fsa).toBeUndefined();
  });

  it("round-trips budget dollars to cents", () => {
    expect(budgetDollars(SAMPLE_HOUSEHOLD)).toBeUndefined();
    const capped = setBudgetDollars(SAMPLE_HOUSEHOLD, 25);
    expect(capped.max_price_cents).toBe(2500);
    expect(budgetDollars(capped)).toBe(25);
    expect(setBudgetDollars(capped, undefined).max_price_cents).toBeUndefined();
    expect(setBudgetDollars(capped, -5).max_price_cents).toBeUndefined();
  });

  it("sets and clears free-only and distance", () => {
    expect(setFreeOnly(SAMPLE_HOUSEHOLD, true).free_only).toBe(true);
    expect(setDistanceKm(SAMPLE_HOUSEHOLD, 10).max_distance_km).toBe(10);
    expect(setDistanceKm(SAMPLE_HOUSEHOLD, undefined).max_distance_km).toBeUndefined();
    expect(setDistanceKm(SAMPLE_HOUSEHOLD, 0).max_distance_km).toBeUndefined();
  });
});

describe("availability edits", () => {
  it("toggles parts and prunes empty days and the whole map", () => {
    const one = toggleAvailability(SAMPLE_HOUSEHOLD, "sat", "morning");
    expect(one.availability).toEqual({ sat: ["morning"] });
    const two = toggleAvailability(one, "sat", "afternoon");
    expect(two.availability).toEqual({ sat: ["morning", "afternoon"] });
    const back = toggleAvailability(two, "sat", "morning");
    expect(back.availability).toEqual({ sat: ["afternoon"] });
    const cleared = toggleAvailability(back, "sat", "afternoon");
    expect(cleared.availability).toBeUndefined();
  });
});
