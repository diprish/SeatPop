import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "@seatpop/llm";
import { STAGE1_LIMIT } from "../src/recommend/config";
import {
  recommendStages,
  type RecommendDeps,
} from "../src/recommend/run";

interface RpcCall {
  url: string;
  body: unknown;
}

/** Deps with a capturing fetch stub; the RPC returns zero candidates. */
function testDeps(calls: RpcCall[], extra: Partial<RecommendDeps> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "seatpop-stages-"));
  const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
  const deps: RecommendDeps = {
    supabaseUrl: "https://test.invalid",
    anonKey: "test-key",
    fetchImpl,
    llmConfig: resolveConfig(
      {},
      {
        cacheDir: path.join(root, "cache"),
        ledgerPath: path.join(root, "ledger.jsonl"),
        runId: "test-run",
        apiKey: "test-key",
        apiBase: "https://test.invalid/v1",
      },
    ),
    ...extra,
  };
  return deps;
}

const PREFS = {
  members: [{ age_band: "kids", include_adjacent: true }],
  free_only: true,
};

describe("recommend stages", () => {
  it("requests STAGE1_LIMIT candidates by default", async () => {
    const calls: RpcCall[] = [];
    const stages = await recommendStages(
      { prefs: PREFS },
      testDeps(calls),
    );
    expect(stages.candidates).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://test.invalid/rest/v1/rpc/recommend_candidates",
    );
    expect(calls[0]?.body).toMatchObject({ p_limit: STAGE1_LIMIT });
  });

  it("honours a stage1Limit override (eval policy probe)", async () => {
    const calls: RpcCall[] = [];
    await recommendStages(
      { prefs: PREFS },
      testDeps(calls, { stage1Limit: 500 }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ p_limit: 500 });
  });
});
