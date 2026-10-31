import { describe, expect, it } from "vitest";
import { PreferencesSchema } from "@seatpop/shared";
import { buildExplorePrefs } from "../src/lib/explore";

const HOUSEHOLD = PreferencesSchema.parse({
  members: [{ age_band: "adults" }],
  fsa: "K2S",
  max_distance_km: 20,
  availability: { sat: ["morning"] },
  interests: ["music"],
});

describe("buildExplorePrefs", () => {
  it("maps one band, free-only, and distance onto the household", () => {
    const prefs = buildExplorePrefs(HOUSEHOLD, {
      band: "kids",
      freeOnly: true,
      distanceKm: 10,
    });
    expect(prefs.members).toEqual([{ age_band: "kids", include_adjacent: true }]);
    expect(prefs.free_only).toBe(true);
    expect(prefs.max_distance_km).toBe(10);
    expect(prefs.fsa).toBe("K2S");
    expect(prefs.availability).toEqual({ sat: ["morning"] });
    expect(PreferencesSchema.safeParse(prefs).success).toBe(true);
  });

  it("covers all ages on Any and clears an unset distance", () => {
    const prefs = buildExplorePrefs(HOUSEHOLD, {
      band: "any",
      freeOnly: false,
      distanceKm: undefined,
    });
    expect(prefs.members.map((m) => m.age_band)).toEqual([
      "baby",
      "kids",
      "adults",
    ]);
    expect(prefs.max_distance_km).toBeUndefined();
    expect(PreferencesSchema.safeParse(prefs).success).toBe(true);
  });
});
