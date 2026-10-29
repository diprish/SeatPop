import type { LlmConfig } from "./config";
import { readLedgerRows } from "./ledger";
import { BudgetExceeded, type LedgerRow, type LlmProvider } from "./types";

export interface SpendTotals {
  total: number;
  perRun: number;
  dailyLive: number;
  basetenTotal: number;
}

/**
 * Sum spend from ledger rows. `today` is a UTC YYYY-MM-DD date.
 * total/perRun/dailyLive span all providers; basetenTotal is Baseten rows.
 */
export function spendTotals(
  rows: LedgerRow[],
  runId: string,
  today: string,
): SpendTotals {
  let total = 0;
  let perRun = 0;
  let dailyLive = 0;
  let basetenTotal = 0;
  for (const row of rows) {
    total += row.est_cost_usd;
    if (row.run_id === runId) perRun += row.est_cost_usd;
    if (!row.cached && row.ts.slice(0, 10) === today) {
      dailyLive += row.est_cost_usd;
    }
    if (row.provider === "baseten") basetenTotal += row.est_cost_usd;
  }
  return { total, perRun, dailyLive, basetenTotal };
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
 * The Baseten cap guards Baseten calls only; the global limits count all
 * providers. The reservation pool is per ledger file (not per provider),
 * so it counts in full against the Baseten cap too — safe direction.
 */
export function assertWithinBudget(
  config: LlmConfig,
  provider: LlmProvider = "meta",
): SpendTotals {
  const rows = readLedgerRows(config.ledgerPath);
  const totals = spendTotals(rows, config.runId, todayUtc());
  const reserved = inflightReserved(config.ledgerPath);
  const withInflight: SpendTotals = {
    total: totals.total + reserved,
    perRun: totals.perRun + reserved,
    dailyLive: totals.dailyLive + reserved,
    basetenTotal: totals.basetenTotal + reserved,
  };
  const { total, perRun, dailyLive, basetenTotal } = config.budgets;
  if (total !== undefined && withInflight.total >= total) {
    throw new BudgetExceeded("total", withInflight.total, total);
  }
  if (perRun !== undefined && withInflight.perRun >= perRun) {
    throw new BudgetExceeded("per_run", withInflight.perRun, perRun);
  }
  if (dailyLive !== undefined && withInflight.dailyLive >= dailyLive) {
    throw new BudgetExceeded("daily_live", withInflight.dailyLive, dailyLive);
  }
  if (
    provider === "baseten" &&
    basetenTotal !== undefined &&
    withInflight.basetenTotal >= basetenTotal
  ) {
    throw new BudgetExceeded(
      "baseten_total",
      withInflight.basetenTotal,
      basetenTotal,
    );
  }
  return withInflight;
}
