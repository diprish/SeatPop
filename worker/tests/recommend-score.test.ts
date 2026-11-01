import { describe, expect, it } from "vitest";
import type { Preferences } from "@seatpop/shared";
import { RECOMMEND_WEIGHTS } from "../src/recommend/config";
import {
  ageFitSignal,
  avoidHit,
  interestSignal,
  noveltySignal,
  orderByScore,
  proximitySignal,
  scoreEvent,
  timeFitSignal,
  type ScoreEvent,
} from "../src/recommend/score";

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
const day = (n: number): string => new Date(NOW + n * 86_400_000).toISOString();

function event(overrides: Partial<ScoreEvent> = {}): ScoreEvent {
  return {
    event_id: "e1",
    starts_at: day(1),
    distance_km: 2,
    category: "music",
    tags: ["live music", "outdoors"],
    fetched_at: day(-1),
    age_min: 6,
    age_max: 12,
    ...overrides,
  };
}

const PREFS: Pick<Preferences, "interests" | "avoid" | "members"> = {
  interests: ["music"],
  avoid: ["crowds"],
  members: [{ age_band: "kids", include_adjacent: true }],
};

describe("stage-2 signals", () => {
  it("decays time, proximity, and novelty over days and km", () => {
    expect(timeFitSignal(day(0), NOW)).toBe(1);
    expect(timeFitSignal(day(7), NOW)).toBeCloseTo(0.5, 10);
    expect(proximitySignal(null)).toBe(0.5);
    expect(proximitySignal(0)).toBe(1);
    expect(proximitySignal(5)).toBeCloseTo(0.5, 10);
    expect(noveltySignal(day(0), NOW)).toBe(1);
    expect(noveltySignal(day(-7), NOW)).toBeCloseTo(0.5, 10);
  });

  it("matches interests by word coverage, neutral when unstated", () => {
    expect(interestSignal(event(), [])).toBe(0.5);
    expect(interestSignal(event(), ["music"])).toBe(1);
    expect(interestSignal(event(), ["live music"])).toBe(1);
    expect(interestSignal(event(), ["music", "theatre"])).toBe(0.5);
    expect(interestSignal(event(), ["theatre"])).toBe(0);
    expect(interestSignal(event(), ["MUSIC"])).toBe(1);
  });

  it("flags avoid hits on category or tags", () => {
    expect(avoidHit(event(), [])).toBe(false);
    expect(avoidHit(event(), ["crowds"])).toBe(false);
    expect(avoidHit(event(), ["outdoors"])).toBe(true);
    expect(avoidHit(event({ category: "crowds" }), ["crowds"])).toBe(true);
  });
});

describe("stage-2 scoring", () => {
  it("combines weighted signals minus the avoid penalty", () => {
    const weights = {
      timeFit: 1,
      proximity: 1,
      interests: 1,
      embedding: 1,
      novelty: 1,
      avoid: 10,
      ageFit: 1,
    };
    const scored = scoreEvent(event(), PREFS, {
      weights,
      nowMs: NOW,
      embeddingSimilarity: new Map([["e1", 0.8]]),
    });
    // The default event (6-12) fits the only kid member exactly: 1.0.
    const expected =
      timeFitSignal(day(1), NOW) +
      proximitySignal(2) +
      1 +
      0.8 +
      noveltySignal(day(-1), NOW) +
      1;
    expect(scored.score).toBeCloseTo(expected, 10);
    expect(scored.signals.avoidHit).toBe(false);
    expect(scored.signals.ageFit).toBeCloseTo(1, 10);

    const penalized = scoreEvent(
      event(),
      { interests: [], avoid: ["music"], members: PREFS.members },
      { weights, nowMs: NOW },
    );
    expect(penalized.signals.avoidHit).toBe(true);
    expect(penalized.score).toBeCloseTo(
      timeFitSignal(day(1), NOW) +
        proximitySignal(2) +
        0.5 +
        0.5 +
        noveltySignal(day(-1), NOW) +
        1 -
        10,
      10,
    );
  });

  it("clamps embedding similarity into 0..1", () => {
    const high = scoreEvent(event(), PREFS, {
      nowMs: NOW,
      embeddingSimilarity: new Map([["e1", 2]]),
    });
    expect(high.signals.embedding).toBe(1);
  });

  it("orders by score, then start time, then id", () => {
    const a = event({ event_id: "b-id", starts_at: day(2) });
    const b = event({ event_id: "a-id", starts_at: day(1) });
    const c = event({ event_id: "c-id", starts_at: day(1) });
    // a starts later (lower time fit); b and c tie on everything.
    const ordered = orderByScore([a, b, c], PREFS, { nowMs: NOW });
    expect(ordered.map((r) => r.event.event_id)).toEqual([
      "a-id",
      "c-id",
      "b-id",
    ]);
  });
});

describe("age-fit signal", () => {
  const kid = [{ age_band: "kids" as const, include_adjacent: true }];

  it("tiers exact above unknown above adjacent", () => {
    expect(ageFitSignal(event({ age_min: 6, age_max: 12 }), kid)).toBeCloseTo(
      1,
      10,
    );
    expect(
      ageFitSignal(event({ age_min: null, age_max: null }), kid),
    ).toBe(0.5);
    expect(ageFitSignal(event({ age_min: 3, age_max: 5 }), kid)).toBe(0);
    expect(ageFitSignal(event(), [])).toBe(0.5);
  });

  it("rises with the share of members fit exactly", () => {
    const members = [
      { age_band: "kids" as const, include_adjacent: true },
      { age_band: "preschool" as const, include_adjacent: true },
    ];
    const one = ageFitSignal(event({ age_min: 6, age_max: 12 }), members);
    const two = ageFitSignal(event({ age_min: 3, age_max: 12 }), members);
    expect(two).toBeGreaterThan(one);
    expect(one).toBeCloseTo(0.95, 10);
    expect(two).toBeCloseTo(1, 10);
  });

  it("keeps exact above unknown above adjacent however the rest scores", () => {
    // The most attractive adjacent-only event imaginable: now, next
    // door, every interest, fresh, no avoid hit.
    const adjacentBest = event({
      event_id: "adjacent-best",
      starts_at: day(0),
      distance_km: 0,
      category: "music",
      tags: ["music"],
      fetched_at: day(0),
      age_min: 3,
      age_max: 5,
    });
    // The least attractive unknown-ages event: far future, far away,
    // no interest overlap, stale, avoid hit.
    const unknownWorst = event({
      event_id: "unknown-worst",
      starts_at: day(365),
      distance_km: 100,
      category: "theatre",
      tags: ["theatre"],
      fetched_at: day(-365),
      age_min: null,
      age_max: null,
    });
    // ...and the least attractive exact fit, same miseries.
    const exactWorst = event({
      ...unknownWorst,
      event_id: "exact-worst",
      age_min: 6,
      age_max: 12,
    });
    const prefs: Pick<Preferences, "interests" | "avoid" | "members"> = {
      interests: ["music"],
      avoid: ["theatre"],
      members: kid,
    };
    const ordered = orderByScore(
      [adjacentBest, unknownWorst, exactWorst],
      prefs,
      { nowMs: NOW, embeddingSimilarity: new Map([["adjacent-best", 1]]) },
    );
    expect(ordered.map((r) => r.event.event_id)).toEqual([
      "exact-worst",
      "unknown-worst",
      "adjacent-best",
    ]);
  });

  it("ranks more exact members above fewer, all else equal", () => {
    const members = [
      { age_band: "kids" as const, include_adjacent: true },
      { age_band: "preschool" as const, include_adjacent: true },
    ];
    const prefs: Pick<Preferences, "interests" | "avoid" | "members"> = {
      ...PREFS,
      members,
    };
    const ordered = orderByScore(
      [
        event({ event_id: "one", age_min: 6, age_max: 12 }),
        event({ event_id: "two", age_min: 3, age_max: 12 }),
      ],
      prefs,
      { nowMs: NOW },
    );
    expect(ordered.map((r) => r.event.event_id)).toEqual(["two", "one"]);
  });

  it("pins the tier-separation weight invariant", () => {
    const w = RECOMMEND_WEIGHTS;
    // Spread of everything but age: positives max out together, avoid
    // subtracts alone (every other signal ranges 0..1).
    const spread =
      w.timeFit + w.proximity + w.interests + w.embedding + w.novelty + w.avoid;
    // Exact-min 0.9 must clear unknown 0.5, unknown must clear adjacent 0.
    expect((0.9 - 0.5) * w.ageFit).toBeGreaterThan(spread);
    expect(0.5 * w.ageFit).toBeGreaterThan(spread);
  });
});
