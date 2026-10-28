import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LlmConfig } from "./config";
import { LedgerRowSchema, type LedgerRow } from "./types";

/** Append one row to the local JSONL ledger (created with parents as needed). */
export function appendLedgerRow(ledgerPath: string, row: LedgerRow): void {
  LedgerRowSchema.parse(row);
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, `${JSON.stringify(row)}\n`, "utf8");
}

/** Read every valid row; a missing file reads as empty, corrupt lines are skipped. */
export function readLedgerRows(ledgerPath: string): LedgerRow[] {
  if (!existsSync(ledgerPath)) return [];
  const rows: LedgerRow[] = [];
  for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const result = LedgerRowSchema.safeParse(parsed);
      if (result.success) rows.push(result.data);
    } catch {
      // Skip corrupt lines; the ledger must stay readable.
    }
  }
  return rows;
}

interface SupabaseInsert {
  created_at: string;
  run_id: string;
  task: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_cached: number;
  tokens_out: number;
  reasoning_tokens: number;
  est_cost_usd: number;
  cached: boolean;
  outcome: string;
  error_kind: string | null;
  latency_ms: number;
}

let warnedInvalidSupabaseUrl = false;

/**
 * Mirror a ledger row to the Supabase `llm_calls` table (service role only).
 * No-op unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
 * A non-https URL warns once and skips the mirror; any other mirror failure
 * is logged, never thrown: the local JSONL file is the source of truth.
 */
export async function mirrorToSupabase(
  config: LlmConfig,
  row: LedgerRow,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!config.supabaseUrl || !config.supabaseServiceKey) return;
  if (!config.supabaseUrl.startsWith("https://")) {
    if (!warnedInvalidSupabaseUrl) {
      warnedInvalidSupabaseUrl = true;
      console.warn(
        "llm ledger supabase mirror skipped: SUPABASE_URL must start with https://",
      );
    }
    return;
  }
  const body: SupabaseInsert = {
    created_at: row.ts,
    run_id: row.run_id,
    task: row.task,
    provider: row.provider,
    model: row.model,
    tokens_in: row.tokens_in,
    tokens_cached: row.tokens_cached,
    tokens_out: row.tokens_out,
    reasoning_tokens: row.reasoning_tokens,
    est_cost_usd: row.est_cost_usd,
    cached: row.cached,
    outcome: row.outcome,
    error_kind: row.error_kind ?? null,
    latency_ms: row.latency_ms,
  };
  try {
    const response = await fetchImpl(
      `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/llm_calls`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.supabaseServiceKey,
          Authorization: `Bearer ${config.supabaseServiceKey}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      console.warn(
        `llm ledger supabase mirror failed: HTTP ${response.status}`,
      );
    }
  } catch (error) {
    console.warn(`llm ledger supabase mirror failed: ${String(error)}`);
  }
}
