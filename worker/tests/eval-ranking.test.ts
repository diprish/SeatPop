import { describe, expect, it } from "vitest";
import {
  constraintViolationsTop10,
  judgmentsFor,
  ndcgAt10,
  parseGoldenRankingJsonl,
  type GoldenRankingRow,
} from "../src/eval/ranking";

function row(): GoldenRankingRow {
  return {
    query_id: "q1",
    candidates: [
      { event_id: "a", relevance: 3, violates_constraint: false },
      { event_id: "b", relevance: 1, violates_constraint: false },
      { event_id: "c", relevance: 0, violates_constraint: true },
    ],
  };
}

describe("ranking metrics", () => {
  it("scores a perfect ranking at 1", () => {
    expect(ndcgAt10(["a", "b", "c"], judgmentsFor(row()))).toBe(1);
  });

  it("discounts late relevant documents", () => {
    // Single relevant doc (relevance 1, gain 1) at rank 2: 1/log2(3).
    const judgments = judgmentsFor({
      query_id: "q",
      candidates: [
        { event_id: "x", relevance: 1, violates_constraint: false },
        { event_id: "y", relevance: 0, violates_constraint: false },
      ],
    });
    expect(ndcgAt10(["y", "x"], judgments)).toBeCloseTo(
      1 / Math.log2(3),
      10,
    );
    expect(ndcgAt10(["x", "y"], judgments)).toBe(1);
  });

  it("gives unjudged ids zero gain", () => {
    const judgments = judgmentsFor(row());
    expect(ndcgAt10(["zzz", "a", "b"], judgments)).toBeLessThan(1);
    expect(ndcgAt10(["zzz"], judgments)).toBe(0);
  });

  it("scores a query with nothing relevant at 1", () => {
    const judgments = judgmentsFor({
      query_id: "q",
      candidates: [
        { event_id: "x", relevance: 0, violates_constraint: false },
      ],
    });
    expect(ndcgAt10(["x"], judgments)).toBe(1);
    expect(ndcgAt10([], judgments)).toBe(1);
  });

  it("counts violations in the top 10 only", () => {
    const candidates = [];
    for (let i = 0; i < 12; i++) {
      candidates.push({
        event_id: `e${i}`,
        relevance: 1 as const,
        violates_constraint: i % 2 === 0,
      });
    }
    const judgments = judgmentsFor({ query_id: "q", candidates });
    const ranked = candidates.map((c) => c.event_id);
    // e0..e8 even in the top 10: e0,e2,e4,e6,e8 = 5; e10 excluded.
    expect(constraintViolationsTop10(ranked, judgments)).toBe(5);
    expect(constraintViolationsTop10(ranked.slice(1), judgments)).toBe(5);
    expect(constraintViolationsTop10(["unknown-id"], judgments)).toBe(0);
  });

  it("parses golden ranking rows and rejects bad ones with line numbers", () => {
    const rows = parseGoldenRankingJsonl(
      `${JSON.stringify(row())}\n\n${JSON.stringify({
        query_id: "q2",
        candidates: [{ event_id: "z", relevance: 2, violates_constraint: false }],
      })}\n`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.query_id).toBe("q1");
    expect(() =>
      parseGoldenRankingJsonl(
        `${JSON.stringify(row())}\n${JSON.stringify({ query_id: "q2", candidates: [] })}\n`,
      ),
    ).toThrow(/ranking\.jsonl line 2/);
  });
});
