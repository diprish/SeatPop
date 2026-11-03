import { afterEach, describe, expect, it, vi } from "vitest";
import type { Preferences } from "@seatpop/shared";
import { applyCoverageOrder } from "../src/recommend/coverage";

/** The web sample household: one adult, one kid, one preschooler. */
const SAMPLE_MEMBERS: Preferences["members"] = [
  { age_band: "adults", include_adjacent: true },
  { age_band: "kids", include_adjacent: true },
  { age_band: "preschool", include_adjacent: true },
];

interface PoolRow {
  id: string;
  age_min: number | null;
  age_max: number | null;
  score: number;
}

function pool(rows: PoolRow[]): {
  ids: string[];
  ages: Map<string, { age_min: number | null; age_max: number | null }>;
  scores: Map<string, number>;
} {
  return {
    ids: rows.map((row) => row.id),
    ages: new Map(
      rows.map((row) => [
        row.id,
        { age_min: row.age_min, age_max: row.age_max },
      ]),
    ),
    scores: new Map(rows.map((row) => [row.id, row.score])),
  };
}

describe("applyCoverageOrder", () => {
  it("covers the 6-12 kid in the sample top 10 with the best-scored exact fit", () => {
    // Nine preschool storytimes plus one ageless pick on top; two kid
    // picks scored below them. No adult exact anywhere: the adult is
    // skipped silently.
    const top = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i + 1}`,
      age_min: 3,
      age_max: 5,
      score: 100 - i,
    }));
    const { ids, ages, scores } = pool([
      ...top,
      { id: "u1", age_min: null, age_max: null, score: 91 },
      { id: "k1", age_min: 6, age_max: 12, score: 50 },
      { id: "k2", age_min: 6, age_max: 12, score: 40 },
    ]);
    const result = applyCoverageOrder(ids, ages, SAMPLE_MEMBERS, scores, 10);
    expect(result).toHaveLength(ids.length);
    // The kid is covered by the better of the two kid picks...
    expect(result.slice(0, 10)).toContain("k1");
    expect(result.slice(0, 10)).not.toContain("k2");
    // ...swapped into the ageless slot; everything already covering
    // a member keeps its exact position.
    expect(result[9]).toBe("k1");
    expect(result.slice(0, 9)).toEqual(ids.slice(0, 9));
    expect(result[10]).toBe("u1");
  });

  it("leaves covered tops alone and skips members with no candidates", () => {
    const { ids, ages, scores } = pool([
      { id: "k1", age_min: 6, age_max: 12, score: 100 },
      { id: "p1", age_min: 3, age_max: 5, score: 90 },
      { id: "u1", age_min: null, age_max: null, score: 80 },
    ]);
    // Kids and preschool already covered; no adult exact in the pool.
    expect(applyCoverageOrder(ids, ages, SAMPLE_MEMBERS, scores, 10)).toEqual(
      ids,
    );
  });

  it("rescues an adult exact when kid events saturate the top 10", () => {
    // Regression: six kid-exacts plus four preschool-exacts on top (the
    // live reranked shape), two adult-only events below. Every top slot
    // covers a member, so a victim rule that only accepts non-covering
    // slots strands the adults at zero picks.
    const { ids, ages, scores } = pool([
      { id: "k1", age_min: 6, age_max: 12, score: 100 },
      { id: "k2", age_min: 6, age_max: 13, score: 99 },
      { id: "k3", age_min: 6, age_max: 15, score: 98 },
      { id: "k4", age_min: 8, age_max: 13, score: 97 },
      { id: "k5", age_min: 6, age_max: 10, score: 96 },
      { id: "k6", age_min: 6, age_max: 12, score: 95 },
      { id: "p1", age_min: 0, age_max: 5, score: 94 },
      { id: "p2", age_min: 0, age_max: 5, score: 93 },
      { id: "p3", age_min: 3, age_max: 5, score: 92 },
      { id: "p4", age_min: 0, age_max: 5, score: 91 },
      { id: "a1", age_min: 50, age_max: null, score: 50 },
      { id: "a2", age_min: 50, age_max: null, score: 40 },
    ]);
    const result = applyCoverageOrder(ids, ages, SAMPLE_MEMBERS, scores, 10);
    expect(result).toHaveLength(ids.length);
    // The better-scored adult-only event enters the top 10...
    expect(result.slice(0, 10)).toContain("a1");
    expect(result.slice(0, 10)).not.toContain("a2");
    // ...into the last redundant slot; kids and preschool stay covered
    // and every other slot keeps its exact position.
    expect(result[9]).toBe("a1");
    expect(result.slice(0, 9)).toEqual(ids.slice(0, 9));
    expect(result[10]).toBe("p4");
    expect(result.slice(0, 10)).toContain("k1");
    expect(result.slice(0, 10)).toContain("p1");
  });

  it("never drops a candidate that already covers a member", () => {
    // Top 2 both cover someone; the only teen exact sits below with
    // no room to enter without evicting a covering pick.
    const { ids, ages, scores } = pool([
      { id: "k1", age_min: 6, age_max: 12, score: 100 },
      { id: "p1", age_min: 3, age_max: 5, score: 90 },
      { id: "t1", age_min: 13, age_max: 17, score: 80 },
    ]);
    const members: Preferences["members"] = [
      ...SAMPLE_MEMBERS,
      { age_band: "teens", include_adjacent: true },
    ];
    expect(applyCoverageOrder(ids, ages, members, scores, 2)).toEqual(ids);
  });

  it("is a no-op for empty inputs", () => {
    const { ids, ages, scores } = pool([
      { id: "k1", age_min: 6, age_max: 12, score: 100 },
    ]);
    expect(applyCoverageOrder([], ages, SAMPLE_MEMBERS, scores, 10)).toEqual(
      [],
    );
    expect(applyCoverageOrder(ids, ages, [], scores, 10)).toEqual(ids);
    expect(applyCoverageOrder(ids, ages, SAMPLE_MEMBERS, scores, 0)).toEqual(
      ids,
    );
  });
});

describe("coverage config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is on unless SEATPOP_COVERAGE=off", async () => {
    vi.stubEnv("SEATPOP_COVERAGE", "");
    vi.resetModules();
    const on = await import("../src/recommend/config");
    expect(on.COVERAGE_ENABLED).toBe(true);
    expect(on.COVERAGE_TOP_N).toBe(10);
    vi.stubEnv("SEATPOP_COVERAGE", "off");
    vi.resetModules();
    const off = await import("../src/recommend/config");
    expect(off.COVERAGE_ENABLED).toBe(false);
  });
});
