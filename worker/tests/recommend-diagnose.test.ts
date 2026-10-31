import { describe, expect, it } from "vitest";
import { PreferencesSchema, type Preferences } from "@seatpop/shared";
import { diagnoseEmpty } from "../src/recommend/diagnose";
import type { RecommendDeps } from "../src/recommend/run";

const DEPS = { supabaseUrl: "https://test.invalid", anonKey: "k" } as RecommendDeps;

const FULL: Preferences = PreferencesSchema.parse({
  members: [{ age_band: "kids" }],
  free_only: true,
  max_distance_km: 10,
  fsa: "K2S",
  availability: { sat: ["morning"] },
  language: ["English"],
});

/** Counts driven by the prefs shape: only cleared availability matches. */
function stubCounts(seen: unknown[]) {
  return async (input: { prefs: unknown }) => {
    seen.push(input.prefs);
    const prefs = input.prefs as Preferences;
    const n = prefs.availability === undefined ? 5 : 0;
    return { candidates: new Array(n).fill({}) as unknown[] };
  };
}

describe("diagnoseEmpty", () => {
  it("counts the base plus one run per applicable relaxation", async () => {
    const seen: unknown[] = [];
    const result = await diagnoseEmpty(FULL, DEPS, stubCounts(seen));
    expect(result.base).toBe(0);
    // availability, distance, budget, age, language_access.
    expect(seen).toHaveLength(6);
    expect(result.relaxed.map((r) => r.id)).toEqual([
      "availability",
      "distance",
      "budget",
      "age",
      "language_access",
    ]);
    expect(result.relaxed.find((r) => r.id === "availability")).toMatchObject({
      label: "More times",
      candidates: 5,
    });
    expect(result.relaxed.find((r) => r.id === "distance")?.candidates).toBe(0);
  });

  it("skips relaxations for unset constraints", async () => {
    const bare = PreferencesSchema.parse({ members: [{ age_band: "adults" }] });
    const seen: unknown[] = [];
    const result = await diagnoseEmpty(bare, DEPS, stubCounts(seen));
    expect(seen).toHaveLength(2);
    expect(result.relaxed.map((r) => r.id)).toEqual(["age"]);
  });
});
