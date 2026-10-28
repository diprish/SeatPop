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
import { readLedgerRows } from "../src/ledger";
import type { TaskKind } from "../src/types";

function tempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "seatpop-llm-"));
}

/** Hermetic config: empty env plus overrides (never touches process.env). */
function testConfig(root: string, extra: ConfigOverrides = {}): LlmConfig {
  return resolveConfig(
    {},
    {
      cacheDir: path.join(root, "cache"),
      ledgerPath: path.join(root, "ledger", "calls.jsonl"),
      runId: "test-run",
      apiKey: "test-key",
      apiBase: "https://test.invalid/v1",
      timeoutMs: 1000,
      retryDelayMs: 0,
      budgets: {},
      ...extra,
    },
  );
}

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function mockFetch(responses: Array<{ status: number; body: unknown }>): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function okBody(overrides: {
  content?: string | null;
  finish?: string | null;
  model?: string;
  prompt?: number;
  cached?: number;
  completion?: number;
  reasoning?: number;
} = {}): Record<string, unknown> {
  return {
    id: "chatcmpl-test",
    model: overrides.model ?? "muse-spark-1.3",
    choices: [
      {
        message: {
          role: "assistant",
          content: "content" in overrides ? overrides.content : "ok",
        },
        finish_reason: "finish" in overrides ? overrides.finish : "stop",
      },
    ],
    usage: {
      prompt_tokens: overrides.prompt ?? 10,
      completion_tokens: overrides.completion ?? 5,
      prompt_tokens_details: { cached_tokens: overrides.cached ?? 0 },
      completion_tokens_details: { reasoning_tokens: overrides.reasoning ?? 0 },
    },
  };
}

const REQUEST = {
  task: "extraction" as const,
  messages: [{ role: "user" as const, content: "extract" }],
};

describe("chat client", () => {
  it("posts to {base}/chat/completions with task model and minimal reasoning", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const { fetchImpl, calls } = mockFetch([{ status: 200, body: okBody() }]);

    const result = await chat(REQUEST, { fetchImpl, config });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://test.invalid/v1/chat/completions");
    expect(calls[0].body["model"]).toBe("muse-spark-1.3");
    expect(calls[0].body["reasoning_effort"]).toBe("minimal");
    expect(calls[0].body["max_tokens"]).toBe(512);
  });

  it("routes only listing_extraction to the contributor model", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const cases: Array<{ task: TaskKind; model: string }> = [
      { task: "listing_extraction", model: "muse-spark-1.3-contributor" },
      { task: "extraction", model: "muse-spark-1.3" },
      { task: "classification", model: "muse-spark-1.3" },
      { task: "parsing", model: "muse-spark-1.3" },
    ];
    for (const { task, model } of cases) {
      const { fetchImpl, calls } = mockFetch([
        { status: 200, body: okBody() },
      ]);
      const result = await chat(
        // Distinct prompt per task so each iteration is a live call.
        { task, messages: [{ role: "user", content: `go ${task}` }] },
        { fetchImpl, config },
      );
      expect(result.ok).toBe(true);
      expect(calls[0].body["model"]).toBe(model);
      expect(calls[0].body["reasoning_effort"]).toBe("minimal");
    }
  });

  it("retries once on a transient failure then succeeds", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const { fetchImpl, calls } = mockFetch([
      { status: 500, body: { error: "boom" } },
      { status: 200, body: okBody({ content: "recovered" }) },
    ]);

    const result = await chat(REQUEST, { fetchImpl, config });

    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.content).toBe("recovered");
  });

  it("returns a typed error on schema failure without retrying", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { garbage: true } },
    ]);

    const result = await chat(REQUEST, { fetchImpl, config });

    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("schema");
      expect(result.error.status).toBe(200);
    }
    const rows = readLedgerRows(config.ledgerPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("error");
    expect(rows[0].error_kind).toBe("schema");
  });

  it("retries a length failure once with a higher limit, then returns a typed error", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const lengthBody = okBody({ content: null, finish: "length" });
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: lengthBody },
      { status: 200, body: lengthBody },
    ]);

    const result = await chat(REQUEST, { fetchImpl, config });

    expect(calls).toHaveLength(2);
    expect(calls[0].body["max_tokens"]).toBe(512);
    expect(calls[1].body["max_tokens"]).toBe(1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("length");
    const rows = readLedgerRows(config.ledgerPath);
    expect(rows).toHaveLength(2);
    expect(rows[0].outcome).toBe("length_retry");
    expect(rows[0].tokens_in).toBe(10);
    expect(rows[0].est_cost_usd).toBeGreaterThan(0);
    expect(rows[1].outcome).toBe("error");
    expect(rows[1].error_kind).toBe("length");
  });

  it("recovers when the length retry succeeds", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: okBody({ content: null, finish: "length" }) },
      { status: 200, body: okBody({ content: "fits now" }) },
    ]);

    const result = await chat(REQUEST, { fetchImpl, config });

    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.content).toBe("fits now");
  });

  it("logs a length_retry row with real usage when the retry succeeds", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const { fetchImpl, calls } = mockFetch([
      {
        status: 200,
        body: okBody({
          content: null,
          finish: "length",
          prompt: 100,
          completion: 50,
          reasoning: 10,
        }),
      },
      { status: 200, body: okBody({ content: "fits now" }) },
    ]);

    const result = await chat(REQUEST, { fetchImpl, config });

    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(true);
    const rows = readLedgerRows(config.ledgerPath);
    expect(rows).toHaveLength(2);
    expect(rows[0].outcome).toBe("length_retry");
    expect(rows[0].tokens_in).toBe(100);
    expect(rows[0].tokens_out).toBe(50);
    expect(rows[0].reasoning_tokens).toBe(10);
    expect(rows[0].est_cost_usd).toBeGreaterThan(0);
    expect(rows[0].error_kind).toBeUndefined();
    expect(rows[1].outcome).toBe("ok");
  });

  it("serves a cache hit with zero network calls", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const first = mockFetch([{ status: 200, body: okBody({ content: "live" }) }]);
    const live = await chat(REQUEST, { fetchImpl: first.fetchImpl, config });
    expect(live.ok).toBe(true);

    const second = mockFetch([{ status: 200, body: okBody() }]);
    const cached = await chat(REQUEST, {
      fetchImpl: second.fetchImpl,
      config,
    });

    expect(second.calls).toHaveLength(0);
    expect(cached.ok).toBe(true);
    if (cached.ok) {
      expect(cached.value.content).toBe("live");
      expect(cached.value.cached).toBe(true);
      expect(cached.value.costUsd).toBe(0);
    }
    const rows = readLedgerRows(config.ledgerPath);
    expect(rows).toHaveLength(2);
    expect(rows[1].cached).toBe(true);
    expect(rows[1].est_cost_usd).toBe(0);
  });

  it("estimates cost with reasoning tokens counted as output tokens", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const { fetchImpl } = mockFetch([
      {
        status: 200,
        body: okBody({
          model: "muse-spark-1.3",
          prompt: 1000,
          cached: 200,
          completion: 500,
          reasoning: 100,
        }),
      },
    ]);

    const result = await chat(
      { ...REQUEST, task: "plan", model: "muse-spark-1.3" },
      { fetchImpl, config },
    );

    // (800 * 1.25 + 200 * 0.15 + 500 * 4.25) / 1e6; completion already
    // includes the 100 reasoning tokens, no extra term.
    const expected = 3155 / 1_000_000;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.costUsd).toBeCloseTo(expected, 9);
    const rows = readLedgerRows(config.ledgerPath);
    expect(rows[0].est_cost_usd).toBeCloseTo(expected, 9);
    expect(rows[0].reasoning_tokens).toBe(100);
  });

  it("uses higher reasoning only for the plan agent and the Wonder judge", async () => {
    const root = tempRoot();
    const config = testConfig(root);
    const plan = mockFetch([{ status: 200, body: okBody() }]);
    await chat(
      { ...REQUEST, task: "plan", maxTokens: 10 },
      { fetchImpl: plan.fetchImpl, config },
    );
    expect(plan.calls[0].body["model"]).toBe("muse-spark-1.3");
    expect(plan.calls[0].body["reasoning_effort"]).toBe("high");
    expect(plan.calls[0].body["max_tokens"]).toBe(512);

    const judge = mockFetch([
      { status: 200, body: okBody({ model: "muse-wonder-1.0" }) },
    ]);
    await chat({ ...REQUEST, task: "judge" }, { fetchImpl: judge.fetchImpl, config });
    expect(judge.calls[0].body["model"]).toBe("muse-wonder-1.0");
    expect(judge.calls[0].body["reasoning_effort"]).toBe("max");
  });

  it("returns a typed timeout error when the request hangs", async () => {
    const root = tempRoot();
    const config = testConfig(root, { timeoutMs: 20 });
    let calls = 0;
    const hangingFetch = (async (
      _url: unknown,
      init?: { signal?: AbortSignal },
    ) =>
      new Promise((_, reject) => {
        calls += 1;
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;

    const result = await chat(REQUEST, { fetchImpl: hangingFetch, config });

    expect(calls).toBe(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("timeout");
  });

  it("returns a typed config error when the API key is missing", async () => {
    const root = tempRoot();
    const config = testConfig(root, { apiKey: undefined });
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: okBody() },
    ]);

    const result = await chat(REQUEST, { fetchImpl, config });

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("config");
  });
});
