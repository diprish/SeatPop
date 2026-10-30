import { describe, expect, it } from "vitest";
import {
  AGE_BAND_RANGES,
  PreferencesSchema,
  categoryAgeFallback,
  effectiveBandRange,
  hourInPart,
} from "../src/preferences";

describe("preferences", () => {
  it("expands bands to adjacent ranges", () => {
    expect(AGE_BAND_RANGES.kids).toEqual({ min: 6, max: 12 });
    expect(effectiveBandRange("kids", false)).toEqual({ min: 6, max: 12 });
    expect(effectiveBandRange("kids", true)).toEqual({ min: 3, max: 17 });
    expect(effectiveBandRange("baby", true)).toEqual({ min: 0, max: 5 });
    expect(effectiveBandRange("seniors", true)).toEqual({ min: 18, max: 130 });
  });

  it("maps hours to parts of day with a wrapping night", () => {
    expect(hourInPart(9, "morning")).toBe(true);
    expect(hourInPart(12, "morning")).toBe(false);
    expect(hourInPart(12, "afternoon")).toBe(true);
    expect(hourInPart(19, "evening")).toBe(true);
    expect(hourInPart(23, "night")).toBe(true);
    expect(hourInPart(2, "night")).toBe(true);
    expect(hourInPart(5, "night")).toBe(false);
  });

  it("falls back permissively except for camps", () => {
    expect(categoryAgeFallback("camps")).toEqual({ min: 5, max: 17 });
    expect(categoryAgeFallback("music")).toEqual({ min: 0, max: 130 });
    expect(categoryAgeFallback(null)).toEqual({ min: 0, max: 130 });
    expect(categoryAgeFallback("unknown-category")).toEqual({
      min: 0,
      max: 130,
    });
  });

  it("validates preferences with defaults and strips unknown keys", () => {
    const parsed = PreferencesSchema.safeParse({
      members: [{ age_band: "kids" }],
      fsa: "k1s",
      nickname: "Alice",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.members).toEqual([
      { age_band: "kids", include_adjacent: true },
    ]);
    expect(parsed.data.fsa).toBe("K1S");
    expect(parsed.data.free_only).toBe(false);
    expect(parsed.data.language).toEqual([]);
    expect(parsed.data).not.toHaveProperty("nickname");
  });

  it("rejects empty members and malformed FSAs", () => {
    expect(PreferencesSchema.safeParse({ members: [] }).success).toBe(false);
    expect(
      PreferencesSchema.safeParse({
        members: [{ age_band: "kids" }],
        fsa: "K1S 0A1",
      }).success,
    ).toBe(false);
  });
});
