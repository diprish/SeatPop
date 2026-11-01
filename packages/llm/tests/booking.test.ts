import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeEvidence } from "@seatpop/shared";
import type { ChatRequest } from "../src/client";
import type { ChatResult } from "../src/types";
import { resolveConfig, type ConfigOverrides, type LlmConfig } from "../src/config";
import {
  parseBookingConfirmation,
  verifyBookingExtract,
} from "../src/booking";

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

const PASTE =
  "Confirmation ABC123 for Saturday Storytime on March 8 at 10:00 AM. " +
  "See you at the Main Branch! Contact you@example.com or 613-555-0123.";

const REPLY = JSON.stringify({
  confirmation_id: "ABC123",
  confirmation_quote: "Confirmation ABC123",
  starts_at: "2031-03-08T10:00:00-05:00",
  datetime_quote: "on March 8 at 10:00 AM",
});

describe("booking_parse", () => {
  it("parses redacted confirmation text on Meta standard Spark", async () => {
    const seen: ChatRequest[] = [];
    const result = await parseBookingConfirmation(PASTE, {
      config: testConfig(tempRoot()),
      chatFn: scriptedChat(REPLY, seen),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.task).toBe("booking_parse");
    expect(seen[0]?.provider).toBe("meta");
    // PII redacted before the call; the model still grounds its quotes.
    const sent = seen[0]?.messages.find((m) => m.role === "user")?.content ?? "";
    expect(sent).toContain("[email]");
    expect(sent).toContain("[phone]");
    expect(sent).not.toContain("you@example.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.booking.confirmation_id).toBe("ABC123");
      expect(result.value.booking.starts_at).toBe("2031-03-08T15:00:00.000Z");
    }
  });

  it("reports empty text and model failures without throwing", async () => {
    const empty = await parseBookingConfirmation("   ", {
      config: testConfig(tempRoot()),
      chatFn: scriptedChat(REPLY, []),
    });
    expect(empty.ok).toBe(false);
    const failed = await parseBookingConfirmation(PASTE, {
      config: testConfig(tempRoot()),
      chatFn: scriptedChat(null, []),
    });
    expect(failed.ok).toBe(false);
    const notJson = await parseBookingConfirmation(PASTE, {
      config: testConfig(tempRoot()),
      chatFn: scriptedChat("no json here", []),
    });
    expect(notJson).toMatchObject({ ok: false });
  });
});

describe("verifyBookingExtract", () => {
  const norm = normalizeEvidence(
    "Confirmation ABC123 on March 8 at 10:00 AM.",
  );

  it("nulls invented ids and unparseable dates", () => {
    expect(
      verifyBookingExtract(
        {
          confirmation_id: "ZZZ999",
          confirmation_quote: "Confirmation ABC123",
          starts_at: "2031-03-08T10:00:00-05:00",
          datetime_quote: "on March 8 at 10:00 AM",
        },
        norm,
      ),
    ).toMatchObject({ confirmation_id: null, confirmation_quote: null });
    expect(
      verifyBookingExtract(
        {
          confirmation_id: "ABC123",
          confirmation_quote: "Confirmation ABC123",
          starts_at: "whenever",
          datetime_quote: "on March 8 at 10:00 AM",
        },
        norm,
      ),
    ).toMatchObject({ starts_at: null, datetime_quote: null });
  });

  it("nulls ungrounded quotes and placeholders", () => {
    expect(
      verifyBookingExtract(
        {
          confirmation_id: "ABC123",
          confirmation_quote: "Reference XYZ000",
          starts_at: "2031-03-08T10:00:00-05:00",
          datetime_quote: "on March 8 at 10:00 AM",
        },
        norm,
      ),
    ).toMatchObject({ confirmation_id: null });
    expect(
      verifyBookingExtract(
        {
          confirmation_id: "[email]",
          confirmation_quote: "[email]",
          starts_at: null,
          datetime_quote: null,
        },
        norm,
      ),
    ).toMatchObject({ confirmation_id: null });
  });

  it("passes nulls through for missing facts", () => {
    expect(
      verifyBookingExtract(
        {
          confirmation_id: null,
          confirmation_quote: null,
          starts_at: null,
          datetime_quote: null,
        },
        norm,
      ),
    ).toEqual({
      confirmation_id: null,
      confirmation_quote: null,
      starts_at: null,
      datetime_quote: null,
    });
  });
});
