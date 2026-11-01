import { describe, expect, it } from "vitest";
import { ENRICHED_FIELDS, type EnrichedField } from "@seatpop/llm";
import type {
  PassCallStats,
  VerifiedValue,
  VoteResult,
} from "../src/enrich/vote";
import type { GoldenEvent, GoldenLabels } from "../src/eval/golden";
import { scoreModel } from "../src/eval/score";

function golden(
  id: string,
  labels: Partial<GoldenLabels>,
  excluded = false,
): GoldenEvent {
  return {
    event_id: id,
    title: `Title ${id}`,
    description: "Text.",
    venue_name: "Hall",
    source: "S",
    category: "arts",
    excluded,
    exclude_reason: excluded ? "both readings honest" : null,
    labels: {
      age_min: null,
      age_max: null,
      price_kind: "unknown",
      amount_min_cents: null,
      amount_max_cents: null,
      setting: null,
      language: null,
      registration_hint: null,
      accessibility: [],
      ...labels,
    },
  };
}

const CALL: PassCallStats = {
  cached: false,
  promptTokens: 100,
  completionTokens: 50,
  reasoningTokens: 5,
  costUsd: 0.001,
};

function vote(
  values: Partial<Record<EnrichedField, VerifiedValue>>,
  calls: PassCallStats[] = [CALL],
): VoteResult {
  const full = {} as Record<EnrichedField, VerifiedValue>;
  const quotes = {} as Record<EnrichedField, string | null>;
  for (const field of ENRICHED_FIELDS) {
    full[field] = field === "price_kind" ? "unknown" : null;
    quotes[field] = null;
  }
  Object.assign(full, values);
  return {
    values: full,
    quotes,
    summary: null,
    tags: [],
    confidence: 1,
    passesUsed: calls.length,
    model: "test-model",
    calls,
  };
}

describe("enrichment scoring", () => {
  it("scores a perfect run at 1.0 with honest null rates", () => {
    const goldens = [
      golden("e1", { age_min: 10, price_kind: "paid" }),
      golden("e2", {}),
    ];
    const score = scoreModel(
      goldens,
      new Map([
        ["e1", vote({ age_min: 10, price_kind: "paid" })],
        ["e2", vote({})],
      ]),
    );
    expect(score.eventsScored).toBe(2);
    expect(score.eventsFailed).toBe(0);
    for (const field of [
      "age_min",
      "age_max",
      "price_kind",
      "amount",
      "setting",
      "language",
      "registration_hint",
      "accessibility",
    ] as const) {
      expect(score.fields[field].accuracy).toBe(1);
    }
    expect(score.fields.age_min.nullRate).toBe(0.5);
    expect(score.fields.price_kind.nullRate).toBe(0.5);
    expect(score.falseFree).toBe(0);
    expect(score.wrongPrice).toBe(0);
    expect(score.hallucinatedFields).toBe(0);
  });

  it("counts false-free separately from other price errors", () => {
    const goldens = [
      golden("e1", { price_kind: "unknown" }),
      golden("e2", { price_kind: "free" }),
      golden("e3", {
        price_kind: "paid",
        amount_min_cents: 1500,
        amount_max_cents: 1500,
      }),
    ];
    const score = scoreModel(
      goldens,
      new Map([
        ["e1", vote({ price_kind: "free" })],
        ["e2", vote({ price_kind: "paid" })],
        ["e3", vote({ price_kind: "paid" })],
      ]),
    );
    // e1: free-vs-unknown is false-free (and a price hallucination).
    // e2: paid-vs-free is a kind error, not false-free.
    // e3: kind right, amount dropped is a price error.
    expect(score.falseFree).toBe(1);
    expect(score.wrongPrice).toBe(2);
    expect(score.hallucinatedFields).toBe(1);
    expect(score.fields.price_kind.accuracy).toBeCloseTo(1 / 3, 5);
    expect(score.fields.amount.accuracy).toBeCloseTo(2 / 3, 5);
  });

  it("expands single amounts before comparing", () => {
    const goldens = [golden("e1", {
      amount_min_cents: 2500,
      amount_max_cents: 2500,
    })];
    const score = scoreModel(
      goldens,
      new Map([["e1", vote({ amount_min_cents: 2500 })]]),
    );
    expect(score.fields.amount.accuracy).toBe(1);
    expect(score.wrongPrice).toBe(0);
  });

  it("compares text case-insensitively and lists order-insensitively", () => {
    const goldens = [
      golden("e1", {
        language: "English",
        accessibility: ["ASL", "wheelchair access"],
      }),
    ];
    const score = scoreModel(
      goldens,
      new Map([
        [
          "e1",
          vote({
            language: "english",
            accessibility: ["Wheelchair Access", "asl"],
          }),
        ],
      ]),
    );
    expect(score.fields.language.accuracy).toBe(1);
    expect(score.fields.accessibility.accuracy).toBe(1);
    expect(score.hallucinatedFields).toBe(0);
  });

  it("counts values on blank labels as hallucinations", () => {
    const goldens = [golden("e1", {})];
    const score = scoreModel(
      goldens,
      new Map([
        ["e1", vote({ age_min: 10, setting: "indoors" })],
      ]),
    );
    expect(score.hallucinatedFields).toBe(2);
    expect(score.fields.age_min.accuracy).toBe(0);
    expect(score.fields.age_max.accuracy).toBe(1);
  });

  it("excludes failed events from every denominator", () => {
    const goldens = [golden("e1", { age_min: 10 }), golden("e2", {})];
    const score = scoreModel(
      goldens,
      new Map([["e1", vote({ age_min: 10 })]]),
    );
    expect(score.eventsScored).toBe(1);
    expect(score.eventsFailed).toBe(1);
    expect(score.fields.age_min.total).toBe(1);
    expect(score.fields.age_min.accuracy).toBe(1);
  });

  it("skips ambiguous-excluded rows in every denominator", () => {
    const goldens = [
      golden("e1", { price_kind: "unknown" }, true),
      golden("e2", {}),
    ];
    const score = scoreModel(
      goldens,
      new Map([
        ["e1", vote({ price_kind: "free" })],
        ["e2", vote({})],
      ]),
    );
    // e1 would be false-free if scored; exclusion removes it fully.
    expect(score.eventsScored).toBe(1);
    expect(score.eventsFailed).toBe(0);
    expect(score.falseFree).toBe(0);
    expect(score.fields.price_kind.total).toBe(1);
    expect(score.fields.price_kind.accuracy).toBe(1);
  });

  it("totals tokens and prices cost per 1,000 scored events", () => {
    const goldens = [golden("e1", {}), golden("e2", {})];
    const cached: PassCallStats = {
      cached: true,
      promptTokens: 100,
      completionTokens: 50,
      reasoningTokens: 5,
      costUsd: 0,
    };
    const score = scoreModel(
      goldens,
      new Map([
        ["e1", vote({}, [CALL])],
        ["e2", vote({}, [CALL, cached])],
      ]),
    );
    expect(score.tokens).toEqual({
      prompt: 300,
      completion: 150,
      reasoning: 15,
      livePasses: 2,
      cachedPasses: 1,
    });
    expect(score.costUsd).toBeCloseTo(0.002, 10);
    expect(score.costPer1kUsd).toBeCloseTo(1.0, 10);
  });
});
