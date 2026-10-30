import { describe, expect, it } from "vitest";
import {
  eventText,
  hasPriceSignal,
  sampleEvalSet,
  type EvalPoolRow,
} from "../src/eval/sample";

function row(
  id: string,
  overrides: Partial<EvalPoolRow> = {},
): EvalPoolRow {
  return {
    id,
    title: `Event ${id}`,
    description: "A pleasant gathering.",
    venueName: "Hall",
    source: "Source A",
    category: "library",
    ...overrides,
  };
}

describe("price signal detection", () => {
  it.each<[string, boolean]>([
    ["Free concert in the park", true],
    ["Admission is FREE for all", true],
    ["Tickets $25 at the door", true],
    ["Tickets $ 25 at the door", true],
    ["Pay 20 dollars on entry", true],
    ["Admission 20 USD", true],
    ["Only 5 bucks", true],
    ["Tickets 30$", true],
  ])("%s -> %s", (text, expected) => {
    expect(hasPriceSignal(text)).toBe(expected);
  });

  it.each([
    "A celebration of freedom",
    "Free-range chickens visit",
    "Duty-free shopping night",
    "Priceless memories",
    "A pleasant gathering",
  ])("does not fire on %s", (text) => {
    expect(hasPriceSignal(text)).toBe(false);
  });

  it("scans title, description, and venue together", () => {
    const text = eventText(row("e1", { venueName: "Free Hall" }));
    expect(text).toContain("Free Hall");
    expect(hasPriceSignal(text)).toBe(true);
    expect(
      hasPriceSignal(eventText(row("e1", { venueName: "Grand Hall" }))),
    ).toBe(false);
  });
});

describe("eval sampling", () => {
  it("force-includes every price/free event when they fit", () => {
    const pool: EvalPoolRow[] = [];
    for (let i = 0; i < 100; i++) {
      pool.push(row(`lib-${i}`, { source: "OPL" }));
    }
    for (let i = 0; i < 5; i++) {
      pool.push(
        row(`price-${i}`, {
          source: "Theatre",
          category: "arts",
          description: "Tickets $20.",
        }),
      );
    }
    const { sample, stats } = sampleEvalSet(pool);
    expect(stats.total).toBe(60);
    expect(stats.priceIncluded).toBe(5);
    expect(stats.priceDropped).toBe(0);
    const ids = new Set(sample.map((r) => r.id));
    for (let i = 0; i < 5; i++) expect(ids.has(`price-${i}`)).toBe(true);
  });

  it("guarantees the non-library floor before stratifying", () => {
    const pool: EvalPoolRow[] = [];
    for (let i = 0; i < 100; i++) {
      pool.push(row(`lib-${i}`, { source: "OPL" }));
    }
    for (let i = 0; i < 25; i++) {
      pool.push(row(`art-${i}`, { source: "Gallery", category: "arts" }));
    }
    const { stats } = sampleEvalSet(pool);
    expect(stats.total).toBe(60);
    expect(stats.nonLibrary).toBeGreaterThanOrEqual(20);
  });

  it("spreads small sources across the sample instead of clumping", () => {
    const pool: EvalPoolRow[] = [];
    for (let i = 0; i < 50; i++) {
      pool.push(
        row(`big-${i}`, { source: "Big", category: "community" }),
      );
    }
    pool.push(row("small-1", { source: "Small", category: "community" }));
    pool.push(row("small-2", { source: "Small", category: "community" }));
    const { sample } = sampleEvalSet(pool, {
      total: 10,
      minNonLibrary: 2,
    });
    const ids = new Set(sample.map((r) => r.id));
    // Round-robin reaches the small bucket before the big one fills up.
    expect(ids.has("small-1")).toBe(true);
    expect(ids.has("small-2")).toBe(true);
  });

  it("keeps non-library price events first when prices overflow", () => {
    const pool: EvalPoolRow[] = [];
    for (let i = 0; i < 40; i++) {
      pool.push(
        row(`nl-${i}`, {
          source: "Theatre",
          category: "arts",
          description: "Free show.",
        }),
      );
    }
    for (let i = 0; i < 30; i++) {
      pool.push(
        row(`lib-${i}`, {
          source: "OPL",
          category: "library",
          description: "Free show.",
        }),
      );
    }
    const { sample, stats } = sampleEvalSet(pool);
    expect(stats.total).toBe(60);
    expect(stats.priceIncluded).toBe(60);
    expect(stats.priceDropped).toBe(10);
    expect(stats.nonLibrary).toBe(40);
    expect(sample).toHaveLength(60);
  });

  it("evicts library price rows to hold the floor when prices overflow", () => {
    const pool: EvalPoolRow[] = [];
    for (let i = 0; i < 55; i++) {
      pool.push(
        row(`lp-${i}`, {
          source: "OPL",
          category: "library",
          description: "Free show.",
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      pool.push(
        row(`np-${i}`, {
          source: "Theatre",
          category: "arts",
          description: "Free show.",
        }),
      );
    }
    for (let i = 0; i < 20; i++) {
      pool.push(row(`nr-${i}`, { source: "Gallery", category: "arts" }));
    }
    const { sample, stats } = sampleEvalSet(pool);
    // 60 price events fill the sample, then 15 library price rows give
    // way to non-library rest rows so the floor holds.
    expect(stats.total).toBe(60);
    expect(stats.floorMet).toBe(true);
    expect(stats.nonLibrary).toBe(20);
    expect(stats.priceIncluded).toBe(45);
    expect(stats.priceDropped).toBe(15);
    const ids = new Set(sample.map((r) => r.id));
    for (let i = 0; i < 5; i++) expect(ids.has(`np-${i}`)).toBe(true);
  });

  it("reports the miss honestly when the pool cannot meet the floor", () => {
    const pool: EvalPoolRow[] = [];
    for (let i = 0; i < 100; i++) {
      pool.push(
        row(`lp-${i}`, {
          source: "OPL",
          category: "library",
          description: "Free show.",
        }),
      );
    }
    const { stats } = sampleEvalSet(pool);
    expect(stats.total).toBe(60);
    expect(stats.nonLibrary).toBe(0);
    expect(stats.floorMet).toBe(false);
    expect(stats.priceIncluded).toBe(60);
  });

  it("is deterministic", () => {
    const pool: EvalPoolRow[] = [];
    for (let i = 0; i < 80; i++) {
      pool.push(
        row(`e-${i}`, {
          source: i % 2 === 0 ? "A" : "B",
          category: i % 3 === 0 ? "arts" : "library",
          description: i % 7 === 0 ? "Tickets $5." : "A calm evening.",
        }),
      );
    }
    const first = sampleEvalSet(pool);
    const second = sampleEvalSet([...pool].reverse());
    expect(second.sample.map((r) => r.id)).toEqual(
      first.sample.map((r) => r.id),
    );
    expect(second.stats).toEqual(first.stats);
  });
});
