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
 * total/perRun/dailyLive count Meta spend only; basetenTotal counts
 * Baseten spend only. Baseten is capped solely by its own total.
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
    if (row.provider === "baseten") {
      basetenTotal += row.est_cost_usd;
      continue;
    }
    total += row.est_cost_usd;
    if (row.run_id === runId) perRun += row.est_cost_usd;
    if (!row.cached && row.ts.slice(0, 10) === today) {
      dailyLive += row.est_cost_usd;
    }
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
 * Meta calls check the global limits (Meta spend only); Baseten calls
 * check solely their own total. Ledger spend plus in-flight reservations
 * count against the checked limits. The reservation pool is per ledger
 * file (not per provider), so it counts in full wherever checked —
 * safe direction.
 */
export function assertWithinBudget(
  config: LlmConfig,
  provider: LlmProvider = "meta",
): SpendTotals {
  const rows = readLedgerRows(config.ledgerPath);
  const totals = spendTotals(rows, config.runId, todayUtc());
  const reserved = inflightReserved(config.ledgerPath);
  if (provider === "baseten") {
    const basetenTotal = config.budgets.basetenTotal;
    if (
      basetenTotal !== undefined &&
      totals.basetenTotal + reserved >= basetenTotal
    ) {
      throw new BudgetExceeded(
        "baseten_total",
        totals.basetenTotal + reserved,
        basetenTotal,
      );
    }
    return totals;
  }
  const withInflight: SpendTotals = {
    ...totals,
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
