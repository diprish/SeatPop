import { describe, expect, it } from "vitest";
import type { Preferences } from "@seatpop/shared";
import { SAMPLE_HOUSEHOLD } from "../src/lib/household";
import {
  LAST_BAND_NOTICE,
  OTTAWA_FSA_MESSAGE,
  applyBudgetValue,
  applyWithinValue,
  budgetSelectValue,
  canShowPicks,
  countTimeSlots,
  distanceAreaError,
  fsaFieldError,
  isOttawaFsa,
  isUnknownAreaError,
  normaliseFsaInput,
  timeSlotsSummary,
  toggleBand,
  withinSelectValue,
} from "../src/lib/household-form";
import { OTTAWA_FSAS } from "../src/lib/ottawa-fsas";

describe("household form logic", () => {
  it("toggles bands on and off", () => {
    const added = toggleBand(SAMPLE_HOUSEHOLD, "teens");
    expect(added.notice).toBeNull();
    expect(added.prefs.members.map((m) => m.age_band)).toEqual([
      "adults",
      "kids",
      "preschool",
      "teens",
    ]);
    const removed = toggleBand(added.prefs, "kids");
    expect(removed.notice).toBeNull();
    expect(removed.prefs.members.map((m) => m.age_band)).toEqual([
      "adults",
      "preschool",
      "teens",
    ]);
  });

  it("refuses to turn off the last band", () => {
    const solo: Preferences = {
      ...SAMPLE_HOUSEHOLD,
      members: [{ age_band: "kids", include_adjacent: true }],
    };
    const next = toggleBand(solo, "kids");
    expect(next.notice).toBe(LAST_BAND_NOTICE);
    expect(next.prefs).toBe(solo);
    expect(LAST_BAND_NOTICE).toBe("Pick at least one.");
  });

  it("validates the postal area with a friendly message", () => {
    expect(fsaFieldError(undefined)).toBeUndefined();
    expect(fsaFieldError("")).toBeUndefined();
    expect(fsaFieldError("K2S")).toBeUndefined();
    expect(fsaFieldError("k2s")).toBeUndefined();
    expect(fsaFieldError("K2")).toBe("Enter 3 characters like K2S.");
    expect(fsaFieldError("ZZZ")).toBe("Enter 3 characters like K2S.");
  });

  it("normalises case, spaces, and full postal codes", () => {
    expect(fsaFieldError("k2s ")).toBeUndefined();
    expect(fsaFieldError("K2S 1A1")).toBeUndefined();
    expect(fsaFieldError(" k1s")).toBeUndefined();
  });

  it("rejects well-formed but unknown Ottawa areas", () => {
    expect(fsaFieldError("K9V")).toBe(OTTAWA_FSA_MESSAGE);
    expect(fsaFieldError("M5V")).toBe(OTTAWA_FSA_MESSAGE);
    expect(OTTAWA_FSA_MESSAGE).toBe(
      "That doesn't look like an Ottawa postal area (for example K2S).",
    );
  });

  it("normalises raw postal input to an FSA prefix", () => {
    expect(normaliseFsaInput("k2s ")).toBe("K2S");
    expect(normaliseFsaInput("K2S 1A1")).toBe("K2S");
    expect(normaliseFsaInput(" k1s")).toBe("K1S");
    expect(normaliseFsaInput("")).toBe("");
  });

  it("knows the seeded Ottawa areas, including the sample's", () => {
    expect(OTTAWA_FSAS.size).toBeGreaterThan(0);
    for (const code of OTTAWA_FSAS) {
      expect(code).toMatch(/^K[0-9][A-Z]$/);
    }
    expect(isOttawaFsa("K2S")).toBe(true);
    expect(isOttawaFsa("k2s ")).toBe(true);
    expect(isOttawaFsa("K9V")).toBe(false);
    expect(isOttawaFsa("M5V")).toBe(false);
  });

  it("recognises the API's unknown-area 400 text", () => {
    expect(
      isUnknownAreaError("unknown area K9V: Ottawa K-prefixed areas only"),
    ).toBe(true);
    expect(isUnknownAreaError("request failed (400)")).toBe(false);
    expect(isUnknownAreaError("fetch failed")).toBe(false);
    expect(isUnknownAreaError("")).toBe(false);
  });

  it("requires an area for a distance cap", () => {
    expect(distanceAreaError(SAMPLE_HOUSEHOLD)).toBeUndefined();
    const { fsa: _dropped, ...noFsa } = SAMPLE_HOUSEHOLD;
    expect(distanceAreaError(noFsa)).toBe("Add a postal area to use Within.");
    const noCap = { ...noFsa, max_distance_km: undefined };
    expect(distanceAreaError(noCap)).toBeUndefined();
  });

  it("gates submit on members, area, and distance", () => {
    expect(canShowPicks(SAMPLE_HOUSEHOLD)).toBe(true);
    expect(canShowPicks({ ...SAMPLE_HOUSEHOLD, members: [] })).toBe(false);
    expect(canShowPicks({ ...SAMPLE_HOUSEHOLD, fsa: "K2" })).toBe(false);
    const { fsa: _dropped, ...noFsa } = SAMPLE_HOUSEHOLD;
    expect(canShowPicks(noFsa)).toBe(false);
  });

  it("counts time slots and summarizes the disclosure", () => {
    expect(countTimeSlots(undefined)).toBe(0);
    expect(timeSlotsSummary(undefined)).toBe("Any time");
    expect(timeSlotsSummary({ sat: ["morning"] })).toBe("1 time slot selected");
    expect(
      timeSlotsSummary({ sat: ["morning", "evening"], sun: ["morning"] }),
    ).toBe("3 time slots selected");
  });

  it("keeps off-list distances selectable", () => {
    // The sample pins 20 km, which is not a stock option.
    expect(withinSelectValue(SAMPLE_HOUSEHOLD)).toEqual({
      value: "20",
      custom: { value: "20", label: "20 km" },
    });
    expect(
      withinSelectValue({ ...SAMPLE_HOUSEHOLD, max_distance_km: 5 }),
    ).toEqual({ value: "5", custom: null });
    expect(
      withinSelectValue({ ...SAMPLE_HOUSEHOLD, max_distance_km: undefined }),
    ).toEqual({ value: "any", custom: null });
    expect(
      applyWithinValue(SAMPLE_HOUSEHOLD, "any").max_distance_km,
    ).toBeUndefined();
    expect(applyWithinValue(SAMPLE_HOUSEHOLD, "10").max_distance_km).toBe(10);
  });

  it("maps the budget select across free, caps, and any", () => {
    expect(budgetSelectValue(SAMPLE_HOUSEHOLD)).toEqual({
      value: "any",
      custom: null,
    });
    const free = applyBudgetValue(SAMPLE_HOUSEHOLD, "free");
    expect(free.free_only).toBe(true);
    expect(free.max_price_cents).toBeUndefined();
    expect(budgetSelectValue(free).value).toBe("free");
    const capped = applyBudgetValue(SAMPLE_HOUSEHOLD, "25");
    expect(capped.free_only).toBe(false);
    expect(capped.max_price_cents).toBe(2500);
    const odd = applyBudgetValue(SAMPLE_HOUSEHOLD, "30");
    expect(budgetSelectValue(odd)).toEqual({
      value: "30",
      custom: { value: "30", label: "up to $30" },
    });
    const cleared = applyBudgetValue(odd, "any");
    expect(cleared.free_only).toBe(false);
    expect(cleared.max_price_cents).toBeUndefined();
  });
});
