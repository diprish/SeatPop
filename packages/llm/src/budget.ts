import type { LlmConfig } from "./config";
import { readLedgerRows } from "./ledger";
import { BudgetExceeded, type LedgerRow } from "./types";

export interface SpendTotals {
  total: number;
  perRun: number;
  dailyLive: number;
}

/** Sum spend from ledger rows. `today` is a UTC YYYY-MM-DD date. */
export function spendTotals(
  rows: LedgerRow[],
  runId: string,
  today: string,
): SpendTotals {
  let total = 0;
  let perRun = 0;
  let dailyLive = 0;
  for (const row of rows) {
    total += row.est_cost_usd;
    if (row.run_id === runId) perRun += row.est_cost_usd;
    if (!row.cached && row.ts.slice(0, 10) === today) {
      dailyLive += row.est_cost_usd;
    }
  }
  return { total, perRun, dailyLive };
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Estimated USD currently held by in-flight calls, per ledger file.
 * Reservations are added after the budget check and released when the call
 * settles, so parallel calls cannot collectively overshoot a limit.
 */
const inflightReservedByLedger = new Map<string, number>();

export function inflightReserved(ledgerPath: string): number {
  return inflightReservedByLedger.get(ledgerPath) ?? 0;
}

export function reserveInflight(ledgerPath: string, usd: number): void {
  if (!(usd > 0)) return;
  inflightReservedByLedger.set(ledgerPath, inflightReserved(ledgerPath) + usd);
}

export function releaseInflight(ledgerPath: string, usd: number): void {
  if (!(usd > 0)) return;
  inflightReservedByLedger.set(
    ledgerPath,
    Math.max(0, inflightReserved(ledgerPath) - usd),
  );
}

/**
 * Throw BudgetExceeded when any configured limit is already reached.
 * Ledger spend plus in-flight reservations count against every limit.
 */
export function assertWithinBudget(config: LlmConfig): SpendTotals {
  const rows = readLedgerRows(config.ledgerPath);
  const totals = spendTotals(rows, config.runId, todayUtc());
  const reserved = inflightReserved(config.ledgerPath);
  const withInflight: SpendTotals = {
    total: totals.total + reserved,
    perRun: totals.perRun + reserved,
    dailyLive: totals.dailyLive + reserved,
  };
  const { total, perRun, dailyLive } = config.budgets;
  if (total !== undefined && withInflight.total >= total) {
    throw new BudgetExceeded("total", withInflight.total, total);
  }
  if (perRun !== undefined && withInflight.perRun >= perRun) {
    throw new BudgetExceeded("per_run", withInflight.perRun, perRun);
  }
  if (dailyLive !== undefined && withInflight.dailyLive >= dailyLive) {
    throw new BudgetExceeded("daily_live", withInflight.dailyLive, dailyLive);
  }
  return withInflight;
}
