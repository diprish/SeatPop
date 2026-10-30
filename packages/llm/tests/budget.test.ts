import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chat } from "../src/client";
import {
  resolveConfig,
  type ConfigOverrides,
  type LlmConfig,
} from "../src/config";
import { appendLedgerRow, readLedgerRows } from "../src/ledger";
import {
  BudgetExceeded,
  type BudgetLimit,
  type ChatResult,
  type LedgerRow,
} from "../src/types";

function tempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "seatpop-llm-budget-"));
}

function testConfig(root: string, extra: ConfigOverrides = {}): LlmConfig {
  return resolveConfig(
    {},
    {
      cacheDir: path.join(root, "cache"),
      ledgerPath: path.join(root, "ledger", "calls.jsonl"),
      runId: "budget-run",
      apiKey: "test-key",
      apiBase: "https://test.invalid/v1",
      timeoutMs: 1000,
      retryDelayMs: 0,
      budgets: {},
      ...extra,
    },
  );
}

/** A fetch that fails the test if the client makes a network call. */
const noFetch = (() => {
  throw new Error("network call made despite budget");
}) as unknown as typeof fetch;

const okFetch = (async () =>
  new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      model: "muse-spark-1.3",
      choices: [
        {
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200 },
  )) as unknown as typeof fetch;

function seedRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    ts: "2020-01-01T00:00:00.000Z",
    run_id: "other-run",
    task: "smoke",
    provider: "meta",
    model: "muse-spark-1.3",
    tokens_in: 100,
    tokens_cached: 0,
    tokens_out: 50,
    reasoning_tokens: 0,
    est_cost_usd: 10,
    cached: false,
    outcome: "ok",
    latency_ms: 5,
    ...overrides,
  };
}

async function expectBudgetExceeded(
  config: LlmConfig,
  limit: BudgetLimit,
): Promise<void> {
  try {
    await chat(
      {
        task: "extraction",
        messages: [{ role: "user", content: "extract" }],
      },
      { fetchImpl: noFetch, config },
    );
  } catch (error) {
    expect(error).toBeInstanceOf(BudgetExceeded);
    expect((error as BudgetExceeded).limit).toBe(limit);
    return;
  }
  throw new Error(`expected BudgetExceeded(${limit}), call went through`);
}

describe("budget guard", () => {
  it("stops a run at the total limit", async () => {
    const root = tempRoot();
    const config = testConfig(root, { budgets: { total: 5 } });
    appendLedgerRow(config.ledgerPath, seedRow({ est_cost_usd: 10 }));

    await expectBudgetExceeded(config, "total");
  });

  it("stops a run at the per-run limit", async () => {
    const root = tempRoot();
    const config = testConfig(root, { budgets: { perRun: 5 } });
    appendLedgerRow(
      config.ledgerPath,
      seedRow({ run_id: "budget-run", est_cost_usd: 10 }),
    );

    await expectBudgetExceeded(config, "per_run");
  });

  it("stops a run at the daily live limit", async () => {
    const root = tempRoot();
    const config = testConfig(root, { budgets: { dailyLive: 5 } });
    appendLedgerRow(
      config.ledgerPath,
      seedRow({
        ts: new Date().toISOString(),
        cached: false,
        est_cost_usd: 10,
      }),
    );

    await expectBudgetExceeded(config, "daily_live");
  });

  it("ignores cached spend for the daily live limit", async () => {
    const root = tempRoot();
    const config = testConfig(root, { budgets: { dailyLive: 5 } });
    appendLedgerRow(
      config.ledgerPath,
      seedRow({
        ts: new Date().toISOString(),
        cached: true,
        est_cost_usd: 0,
      }),
    );
    const okFetch = (async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          model: "muse-spark-1.3",
          choices: [
            {
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await chat(
      {
        task: "extraction",
        messages: [{ role: "user", content: "extract" }],
      },
      { fetchImpl: okFetch, config },
    );
    expect(result.ok).toBe(true);
  });

  it("counts in-flight estimates so 20 parallel calls cannot overshoot", async () => {
    const root = tempRoot();
    const config = testConfig(root, {
      budgets: { total: 1 },
      reserveUsdPerCall: 0.25,
    });
    const delayedOk = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          model: "muse-spark-1.3",
          choices: [
            {
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        chat(
          {
            task: "extraction",
            messages: [{ role: "user", content: "extract" }],
          },
          { fetchImpl: delayedOk, config },
        ),
      ),
    );
    // 0.25 is exact in binary: 4 calls reserve 1.00, the other 16 stop.
    const values = settled.flatMap((s): ChatResult[] =>
      s.status === "fulfilled" ? [s.value] : [],
    );
    const reasons = settled.flatMap((s): unknown[] =>
      s.status === "rejected" ? [s.reason] : [],
    );
    expect(values).toHaveLength(4);
    for (const value of values) expect(value.ok).toBe(true);
    expect(reasons).toHaveLength(16);
    for (const reason of reasons) {
      expect(reason).toBeInstanceOf(BudgetExceeded);
      expect((reason as BudgetExceeded).limit).toBe("total");
    }
    const rows = readLedgerRows(config.ledgerPath);
    expect(rows).toHaveLength(4);
  });

  it("falls back to Meta when the Baseten cap is reached", async () => {
    const root = tempRoot();
    const config = testConfig(root, { budgets: { basetenTotal: 5 } });
    appendLedgerRow(
      config.ledgerPath,
      seedRow({ provider: "baseten", est_cost_usd: 10 }),
    );

    const result = await chat(
      {
        task: "listing_extraction",
        provider: "baseten",
        messages: [{ role: "user", content: "go" }],
      },
      { fetchImpl: okFetch, config },
    );

    expect(result.ok).toBe(true);
    const rows = readLedgerRows(config.ledgerPath);
    expect(rows.map((r) => r.provider)).toEqual(["baseten", "meta"]);
  });

  it("throws the Baseten cap instead of falling back when fallback is none", async () => {
    const root = tempRoot();
    const config = testConfig(root, { budgets: { basetenTotal: 5 } });
    appendLedgerRow(
      config.ledgerPath,
      seedRow({ provider: "baseten", est_cost_usd: 10 }),
    );

    await expect(
      chat(
        {
          task: "listing_extraction",
          provider: "baseten",
          fallback: "none",
          messages: [{ role: "user", content: "go" }],
        },
        { fetchImpl: okFetch, config },
      ),
    ).rejects.toBeInstanceOf(BudgetExceeded);
    const rows = readLedgerRows(config.ledgerPath);
    expect(rows.every((r) => r.provider === "baseten")).toBe(true);
  });

  it("lets Meta calls through when only the Baseten total is spent", async () => {
    const root = tempRoot();
    const config = testConfig(root, { budgets: { basetenTotal: 5 } });
    appendLedgerRow(
      config.ledgerPath,
      seedRow({ provider: "baseten", est_cost_usd: 10 }),
    );

    const result = await chat(
      {
        task: "extraction",
        messages: [{ role: "user", content: "extract" }],
      },
      { fetchImpl: okFetch, config },
    );
    expect(result.ok).toBe(true);
  });

  it("ignores Baseten spend in the global limits", async () => {
    const root = tempRoot();
    const config = testConfig(root, { budgets: { total: 5 } });
    appendLedgerRow(
      config.ledgerPath,
      seedRow({ provider: "baseten", est_cost_usd: 10 }),
    );

    const result = await chat(
      {
        task: "extraction",
        messages: [{ role: "user", content: "extract" }],
      },
      { fetchImpl: okFetch, config },
    );
    expect(result.ok).toBe(true);
  });
});
