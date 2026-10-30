import { describe, expect, it } from "vitest";
import { ENRICHED_FIELDS, type EnrichedField } from "@seatpop/llm";
import type {
  VerifiedValue,
  VoteResult,
} from "../src/enrich/vote";
import type { GoldenEvent } from "../src/eval/golden";
import {
  EvalReportSchema,
  checkReportGate,
  modelReportFor,
  renderMarkdownReport,
  type EvalReport,
} from "../src/eval/report";
import { scoreModel } from "../src/eval/score";

function golden(): GoldenEvent {
  return {
    event_id: "e1",
    title: "Title",
    description: "Text.",
    venue_name: "Hall",
    source: "S",
    category: "arts",
    labels: {
      age_min: 10,
      age_max: null,
      price_kind: "unknown",
      amount_min_cents: null,
      amount_max_cents: null,
      setting: null,
      language: null,
      registration_hint: null,
      accessibility: [],
    },
  };
}

function vote(): VoteResult {
  const values = {} as Record<EnrichedField, VerifiedValue>;
  const quotes = {} as Record<EnrichedField, string | null>;
  for (const field of ENRICHED_FIELDS) {
    values[field] = field === "price_kind" ? "unknown" : null;
    quotes[field] = null;
  }
  values.age_min = 10;
  return {
    values,
    quotes,
    summary: null,
    tags: [],
    confidence: 1,
    passesUsed: 2,
    model: "muse-spark-1.3-contributor",
    calls: [
      {
        cached: false,
        promptTokens: 100,
        completionTokens: 50,
        reasoningTokens: 5,
        costUsd: 0.001,
      },
      {
        cached: true,
        promptTokens: 100,
        completionTokens: 50,
        reasoningTokens: 5,
        costUsd: 0,
      },
    ],
  };
}

function report(): EvalReport {
  const score = scoreModel([golden()], new Map([["e1", vote()]]));
  return {
    generatedAt: "2026-10-30T00:00:00.000Z",
    promptVersion: "enrich.v2",
    goldenPath: "worker/eval/golden/events.jsonl",
    goldenEvents: 1,
    models: [
      modelReportFor("contributor", "meta", "muse-spark-1.3-contributor", score),
    ],
  };
}

describe("eval report", () => {
  it("round-trips through its schema", () => {
    const parsed = EvalReportSchema.safeParse(report());
    expect(parsed.success).toBe(true);
    expect(EvalReportSchema.safeParse({})).toMatchObject({ success: false });
  });

  it("gates on any recorded price error", () => {
    expect(checkReportGate(report())).toEqual({ ok: true, offenders: [] });
    const bad = report();
    bad.models[0] = {
      ...(bad.models[0] as (typeof bad.models)[number]),
      falseFree: 1,
    };
    expect(checkReportGate(bad)).toEqual({
      ok: false,
      offenders: [{ key: "contributor", falseFree: 1, wrongPrice: 0 }],
    });
    const worse = report();
    worse.models[0] = {
      ...(worse.models[0] as (typeof worse.models)[number]),
      wrongPrice: 2,
    };
    expect(checkReportGate(worse).ok).toBe(false);
  });

  it("renders one table per model with counts and cost", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).toContain("## Muse Spark 1.3 contributor (Meta API)");
    expect(markdown).toContain("| age_min | 100.0% (1/1) | 0.0% |");
    expect(markdown).toContain("| price_kind | 100.0% (1/1) | 100.0% |");
    expect(markdown).toContain('- false-"free": 0');
    expect(markdown).toContain("- wrong-price: 0");
    expect(markdown).toContain("- hallucinated fields: 0");
    expect(markdown).toContain("(live passes 1, cached 1)");
    expect(markdown).toContain("$1.00 per 1,000 events");
  });
});
