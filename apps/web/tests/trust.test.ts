import { describe, expect, it } from "vitest";
import {
  parseEnrichmentReport,
  parseFallbackReport,
  parseRecommendReport,
} from "../src/lib/trust";

describe("parseEnrichmentReport", () => {
  const valid = {
    generatedAt: "2026-01-01T00:00:00Z",
    promptVersion: "enrich.v3",
    goldenEvents: 60,
    models: [
      {
        key: "spark",
        model: "muse-spark-1.3",
        provider: "meta",
        eventsScored: 60,
        eventsFailed: 0,
        fields: {
          age_min: { accuracy: 0.9, nullRate: 0.1 },
          price_kind: { accuracy: 1, nullRate: 0 },
        },
        falseFree: 0,
        wrongPrice: 0,
        hallucinatedFields: 2,
        tokens: { prompt: 100, completion: 50 },
        costPer1kUsd: 1.25,
      },
    ],
  };

  it("parses a valid report and rejects misshapen input", () => {
    const parsed = parseEnrichmentReport(valid);
    expect(parsed?.goldenEvents).toBe(60);
    expect(parsed?.models).toHaveLength(1);
    expect(parsed?.models[0]?.fields).toEqual([
      { field: "age_min", accuracy: 0.9, nullRate: 0.1 },
      { field: "price_kind", accuracy: 1, nullRate: 0 },
    ]);
    expect(parseEnrichmentReport(null)).toBeNull();
    expect(parseEnrichmentReport({})).toBeNull();
    expect(parseEnrichmentReport({ ...valid, models: [{ key: "x" }] })).toBeNull();
  });
});

describe("parseRecommendReport", () => {
  const valid = {
    generatedAt: "2026-01-01T00:00:00Z",
    mode: "full",
    grading: "model-graded",
    households: [
      { candidates: 10, graded: true },
      { candidates: 0, graded: false },
    ],
    policyProbe: { candidates: 305, freePerOpl: 6, ok: true },
    totals: {
      violations: 0,
      distanceMismatches: 0,
      meanNdcgReranked: 0.99,
      meanNdcgDate: 0.77,
      meanNdcgStage2: 0.9,
    },
  };

  it("parses counts and means, tolerates a missing probe", () => {
    const parsed = parseRecommendReport(valid);
    expect(parsed).toMatchObject({
      households: 2,
      graded: 1,
      withCandidates: 1,
      violations: 0,
      meanNdcgReranked: 0.99,
    });
    expect(parsed?.policyProbe?.ok).toBe(true);
    const { policyProbe: _dropped, ...withoutProbe } = valid;
    expect(parseRecommendReport(withoutProbe)?.policyProbe).toBeNull();
    expect(parseRecommendReport({})).toBeNull();
    expect(parseRecommendReport({ ...valid, totals: {} })).toBeNull();
  });
});

describe("parseFallbackReport", () => {
  it("parses the proof and rejects the full report shape", () => {
    const parsed = parseFallbackReport({
      generatedAt: "2026-01-01T00:00:00Z",
      fallbackProof: { households: 5, orderKept: true, allTemplated: true },
    });
    expect(parsed).toEqual({
      generatedAt: "2026-01-01T00:00:00Z",
      households: 5,
      orderKept: true,
      allTemplated: true,
    });
    expect(parseFallbackReport({ generatedAt: "x", fallbackProof: null })).toBeNull();
    expect(parseFallbackReport(null)).toBeNull();
  });
});
