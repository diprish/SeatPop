import { describe, expect, it } from "vitest";
import type { EnrichCandidate } from "../src/enrich/store";
import {
  planMonthsRepair,
  type MonthsRepairRow,
} from "../src/repair-months/plan";

function candidate(overrides: Partial<EnrichCandidate> = {}): EnrichCandidate {
  return {
    id: "e1",
    title: "Babytime",
    description: "Songs for babies 0-18 months.",
    starts_at: "2026-11-07T15:00:00.000Z",
    timezone: "America/Toronto",
    category: "library",
    venueName: "Main Branch",
    sourceHash: "old",
    policy: null,
    ...overrides,
  };
}

function row(overrides: Partial<MonthsRepairRow> = {}): MonthsRepairRow {
  return {
    candidate: candidate(),
    ageMinQuote: null,
    ageMaxQuote: null,
    currentHash: "new",
    ...overrides,
  };
}

describe("planMonthsRepair", () => {
  it("plans stale rows whose age quote mentions months", () => {
    const planned = planMonthsRepair([
      row({ ageMinQuote: "0-18 months" }),
      row({
        candidate: candidate({ id: "e2" }),
        ageMaxQuote: "19-35 MONTHS",
      }),
    ]);
    expect(planned.map((c) => c.id)).toEqual(["e1", "e2"]);
  });

  it("skips month rows that are already current", () => {
    const planned = planMonthsRepair([
      row({
        candidate: candidate({ sourceHash: "new" }),
        ageMinQuote: "0-18 months",
      }),
    ]);
    expect(planned).toEqual([]);
  });

  it("never touches rows without month quotes", () => {
    const planned = planMonthsRepair([
      row({ ageMinQuote: "ages 3 to 5", ageMaxQuote: "ages 3 to 5" }),
      row(),
    ]);
    expect(planned).toEqual([]);
  });

  it("is idempotent: repaired rows plan nothing on re-run", () => {
    const input = row({ ageMinQuote: "0-18 months" });
    expect(planMonthsRepair([input])).toHaveLength(1);
    const repaired: MonthsRepairRow = {
      ...input,
      candidate: { ...input.candidate, sourceHash: input.currentHash },
    };
    expect(planMonthsRepair([repaired])).toEqual([]);
  });
});
