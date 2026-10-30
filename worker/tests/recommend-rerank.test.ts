import { describe, expect, it } from "vitest";
import {
  BudgetExceeded,
  resolveConfig,
  type ChatRequest,
  type ChatResult,
} from "@seatpop/llm";
import type { Preferences } from "@seatpop/shared";
import {
  reasonMarked,
  rerankCandidates,
  templatedReason,
  type RerankCandidate,
} from "../src/recommend/rerank";

function candidate(id: string): RerankCandidate {
  return {
    event_id: id,
    title: `Title ${id}`,
    summary_short: "A pleasant gathering.",
    category: "music",
    starts_at: "2026-11-07T14:00:00.000Z",
    venue_name: "Hall",
    price_label: "Free",
    age_min: 6,
    age_max: 12,
    age_flag: null,
    tags: ["music"],
  };
}

const PREFS = {
  members: [{ age_band: "kids", include_adjacent: true }],
  free_only: false,
  language: [],
  accessibility: [],
  interests: ["music"],
  avoid: [],
} as Preferences;

const config = () =>
  resolveConfig({} as NodeJS.ProcessEnv, {
    cacheDir: "/tmp/seatpop-test-cache",
    ledgerPath: "/tmp/seatpop-test-ledger/calls.jsonl",
    runId: "test",
  });

function scriptedChat(
  reply: string | null,
  seen: ChatRequest[],
): (request: ChatRequest) => Promise<ChatResult> {
  return async (request) => {
    seen.push(request);
    if (reply === null) {
      return { ok: false, error: { kind: "timeout", message: "slow" } };
    }
    return {
      ok: true,
      value: {
        content: reply,
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

describe("rerank", () => {
  it("takes the model order with marked reasons on Meta Spark", async () => {
    const seen: ChatRequest[] = [];
    const outcome = await rerankCandidates(
      [candidate("e1"), candidate("e2")],
      PREFS,
      {
        config: config(),
        chatFn: scriptedChat(
          JSON.stringify([
            { event_id: "e2", reason: "Evening show (stated), suits kids (inferred)" },
            { event_id: "e1", reason: "Free entry (stated)" },
          ]),
          seen,
        ),
      },
    );
    expect(outcome.fallback).toBe(false);
    expect(outcome.model).toBe("muse-spark-1.3");
    expect(outcome.items.map((i) => i.event_id)).toEqual(["e2", "e1"]);
    expect(outcome.items.every((i) => i.fromModel)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.task).toBe("rerank");
    expect(seen[0]?.provider).toBe("meta");
  });

  it("discards unknown and duplicate ids, keeps dropped ones last", async () => {
    const seen: ChatRequest[] = [];
    const outcome = await rerankCandidates(
      [candidate("e1"), candidate("e2"), candidate("e3")],
      PREFS,
      {
        config: config(),
        chatFn: scriptedChat(
          JSON.stringify([
            { event_id: "e2", reason: "Good fit (stated)" },
            { event_id: "nope", reason: "Invented (stated)" },
            { event_id: "e2", reason: "Again (stated)" },
          ]),
          seen,
        ),
      },
    );
    expect(outcome.items.map((i) => i.event_id)).toEqual(["e2", "e1", "e3"]);
    expect(outcome.items[0]?.fromModel).toBe(true);
    expect(outcome.items[1]?.fromModel).toBe(false);
    expect(outcome.items[2]?.fromModel).toBe(false);
  });

  it("templates unmarked reasons per item", () => {
    expect(reasonMarked("Free entry (stated)")).toBe(true);
    expect(reasonMarked("probably fun, inferred")).toBe(true);
    expect(reasonMarked("a great show")).toBe(false);
  });

  it("falls back to stage-2 order on timeout, bad JSON, and budget stop", async () => {
    const inputs = [candidate("e1"), candidate("e2")];
    const timeout = await rerankCandidates(inputs, PREFS, {
      config: config(),
      chatFn: scriptedChat(null, []),
    });
    expect(timeout.fallback).toBe(true);
    expect(timeout.model).toBeNull();
    expect(timeout.items.map((i) => i.event_id)).toEqual(["e1", "e2"]);

    const badJson = await rerankCandidates(inputs, PREFS, {
      config: config(),
      chatFn: scriptedChat("not json", []),
    });
    expect(badJson.fallback).toBe(true);
    expect(badJson.model).toBe("muse-spark-1.3");
    expect(badJson.items[0]?.reason).toBe(templatedReason(candidate("e1")));

    const throwing = async (): Promise<ChatResult> => {
      throw new BudgetExceeded("per_run", 5, 5);
    };
    const stopped = await rerankCandidates(inputs, PREFS, {
      config: config(),
      chatFn: throwing,
    });
    expect(stopped.fallback).toBe(true);
    expect(stopped.items.every((i) => !i.fromModel)).toBe(true);
  });

  it("skips the model entirely for an empty shortlist", async () => {
    const seen: ChatRequest[] = [];
    const outcome = await rerankCandidates([], PREFS, {
      config: config(),
      chatFn: scriptedChat("[]", seen),
    });
    expect(outcome).toEqual({ items: [], model: null, fallback: false });
    expect(seen).toHaveLength(0);
  });
});
