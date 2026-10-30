import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatRequest } from "../src/client";
import type { ChatResult } from "../src/types";
import { resolveConfig, type ConfigOverrides, type LlmConfig } from "../src/config";
import { parseProfileDescription } from "../src/profile";

function tempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "seatpop-llm-"));
}

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

function scriptedChat(
  content: string | null,
  seen: ChatRequest[],
): (request: ChatRequest) => Promise<ChatResult> {
  return async (request) => {
    seen.push(request);
    if (content === null) {
      return { ok: false, error: { kind: "config", message: "no key" } };
    }
    return {
      ok: true,
      value: {
        content,
        model: "muse-spark-1.3",
        finishReason: "stop",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          cachedTokens: 0,
          reasoningTokens: 0,
        },
        costUsd: 0,
        cached: false,
      },
    };
  };
}

const REPLY = JSON.stringify({
  members: [{ age_band: "kids", include_adjacent: true }],
  max_price_cents: 2500,
  free_only: false,
  max_distance_km: 5,
  fsa: "K1S",
  availability: { sat: ["morning"] },
  language: ["English"],
  accessibility: [],
  interests: ["music"],
  avoid: ["crowds"],
});

describe("profile_parse", () => {
  it("parses a household description on Meta standard Spark", async () => {
    const seen: ChatRequest[] = [];
    const result = await parseProfileDescription(
      "Two kids who love music, Saturdays, under $25, near K1S.",
      {
        config: testConfig(tempRoot()),
        chatFn: scriptedChat(REPLY, seen),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prefs.members).toEqual([
      { age_band: "kids", include_adjacent: true },
    ]);
    expect(result.value.prefs.max_price_cents).toBe(2500);
    expect(result.value.prefs.fsa).toBe("K1S");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.task).toBe("profile_parse");
    expect(seen[0]?.provider).toBe("meta");
    expect(seen[0]?.model).toBeUndefined();
  });

  it("redacts PII before the model sees it", async () => {
    const seen: ChatRequest[] = [];
    await parseProfileDescription(
      "Mail alice@example.com or 613-555-0123, we live at K1S 0A1.",
      { config: testConfig(tempRoot()), chatFn: scriptedChat(REPLY, seen) },
    );
    const user = seen[0]?.messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).not.toContain("alice@example.com");
    expect(user).not.toContain("613-555-0123");
    expect(user).not.toContain("K1S 0A1");
    expect(user).toContain("[email]");
    expect(user).toContain("[phone]");
    expect(user).toContain("[postal code]");
  });

  it("returns typed errors for empty text, bad JSON, and bad prefs", async () => {
    const config = testConfig(tempRoot());
    const empty = await parseProfileDescription("   ", {
      config,
      chatFn: scriptedChat(REPLY, []),
    });
    expect(empty.ok).toBe(false);

    const seen: ChatRequest[] = [];
    const notJson = await parseProfileDescription("two kids", {
      config,
      chatFn: scriptedChat("sure thing!", seen),
    });
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.error.kind).toBe("schema");

    const badPrefs = await parseProfileDescription("two kids", {
      config,
      chatFn: scriptedChat(JSON.stringify({ members: [] }), []),
    });
    expect(badPrefs.ok).toBe(false);
    if (!badPrefs.ok) expect(badPrefs.error.kind).toBe("schema");
    expect(seen).toHaveLength(1);
  });
});
