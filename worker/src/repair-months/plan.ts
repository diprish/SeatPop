import type { EnrichCandidate } from "../enrich/store";

/**
 * Months-repair planner: which candidates to re-enrich. A row qualifies
 * when an age evidence quote contains "month" (case-insensitive) AND its
 * stored hash differs from the current one. Pure (tested); run.ts joins
 * the inputs and processes the plan.
 *
 * Idempotent: a repaired row's hash matches afterwards, so a second run
 * plans nothing. Rows without month quotes never qualify, whatever
 * their hash — the prompt bump re-enriches those lazily instead.
 */

export interface MonthsRepairRow {
  candidate: EnrichCandidate;
  ageMinQuote: string | null;
  ageMaxQuote: string | null;
  currentHash: string;
}

export function planMonthsRepair(
  rows: MonthsRepairRow[],
): EnrichCandidate[] {
  return rows
    .filter((row) => {
      const quotes =
        `${row.ageMinQuote ?? ""}\n${row.ageMaxQuote ?? ""}`.toLowerCase();
      if (!quotes.includes("month")) return false;
      return row.candidate.sourceHash !== row.currentHash;
    })
    .map((row) => row.candidate);
}
