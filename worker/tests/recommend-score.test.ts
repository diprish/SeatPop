import { describe, expect, it } from "vitest";
import {
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
    ...overrides,
  };
}

const PREFS = { interests: ["music"], avoid: ["crowds"] };

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
    };
    const scored = scoreEvent(event(), PREFS, {
      weights,
      nowMs: NOW,
      embeddingSimilarity: new Map([["e1", 0.8]]),
    });
    const expected =
      timeFitSignal(day(1), NOW) +
      proximitySignal(2) +
      1 +
      0.8 +
      noveltySignal(day(-1), NOW);
    expect(scored.score).toBeCloseTo(expected, 10);
    expect(scored.signals.avoidHit).toBe(false);

    const penalized = scoreEvent(event(), { interests: [], avoid: ["music"] }, {
      weights,
      nowMs: NOW,
    });
    expect(penalized.signals.avoidHit).toBe(true);
    expect(penalized.score).toBeCloseTo(
      timeFitSignal(day(1), NOW) +
        proximitySignal(2) +
        0.5 +
        0.5 +
        noveltySignal(day(-1), NOW) -
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
