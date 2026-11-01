import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGoldenJsonl, type GoldenEvent } from "../src/eval/golden";
import { fieldCorrect, type ModelPrediction } from "../src/eval/score";
import { findMonthsRanges } from "../src/repair-months/plan";

/**
 * Months-as-years regression on the enrichment eval: the golden set
 * must keep month-range events labeled as years, and the scorer must
 * fail months-magnitude predictions on them — otherwise a future
 * enrichment that stores months as years scores green.
 */

const GOLDEN_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "eval",
  "golden",
  "events.jsonl",
);

function monthGoldens(): GoldenEvent[] {
  const goldens = parseGoldenJsonl(readFileSync(GOLDEN_PATH, "utf8"));
  return goldens.filter(
    (golden) =>
      findMonthsRanges(`${golden.title}\n${golden.description ?? ""}`).length >
      0,
  );
}

function blankPred(): ModelPrediction {
  return {
    age_min: null,
    age_max: null,
    price_kind: "unknown",
    amount_min_cents: null,
    amount_max_cents: null,
    setting: null,
    language: null,
    registration_hint: null,
    accessibility: [],
  };
}

describe("months eval regression", () => {
  it("keeps at least 3 month-range goldens labeled as years", () => {
    const goldens = monthGoldens();
    expect(goldens.length).toBeGreaterThanOrEqual(3);
    for (const golden of goldens) {
      // Years, never months magnitudes (a month quote can never
      // legitimately yield 5+ — the verifyAge ceiling).
      for (const age of [golden.labels.age_min, golden.labels.age_max]) {
        expect(age === null || age < 5).toBe(true);
      }
    }
  });

  it("fails months-magnitude predictions on month-range goldens", () => {
    const goldens = monthGoldens();
    expect(goldens.length).toBeGreaterThanOrEqual(3);
    for (const golden of goldens) {
      const ranges = findMonthsRanges(
        `${golden.title}\n${golden.description ?? ""}`,
      );
      const first = ranges[0] as { minMonths: number; maxMonths: number };
      // A prediction that copies the raw months numbers must score
      // wrong wherever the magnitude is unambiguous (≥ 5).
      if (first.minMonths >= 5) {
        expect(
          fieldCorrect("age_min", golden.labels, {
            ...blankPred(),
            age_min: first.minMonths,
          }),
        ).toBe(false);
      }
      if (first.maxMonths >= 5) {
        expect(
          fieldCorrect("age_max", golden.labels, {
            ...blankPred(),
            age_max: first.maxMonths,
          }),
        ).toBe(false);
      }
    }
  });
});
