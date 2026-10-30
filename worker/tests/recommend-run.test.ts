import { describe, expect, it } from "vitest";
import {
  BudgetExceeded,
  resolveConfig,
  type ChatRequest,
  type ChatResult,
} from "@seatpop/llm";
import {
  RecommendError,
  runRecommend,
  type CandidateRow,
  type RecommendDeps,
} from "../src/recommend/run";

function row(id: string, starts: string): CandidateRow {
  return {
    event_id: id,
    title: `Title ${id}`,
    description: "Text.",
    starts_at: starts,
    ends_at: null,
    timezone: "America/Toronto",
    venue_name: "Hall",
    venue_lat: 45.42,
    venue_lng: -75.7,
    distance_km: 2,
    category: "music",
    status: "scheduled",
    source_url: "https://example.test/e",
    age_min: 6,
    age_max: 12,
    age_fallback: false,
    age_flag: null,
    price_kind: "paid",
    price_label: "$15.00",
    amount_min_cents: 1500,
    amount_max_cents: 1500,
    currency: "CAD",
    accessibility: [],
    language: null,
    tags: ["music"],
    summary_short: "Show.",
    fetched_at: "2026-05-20T00:00:00.000Z",
  };
}

interface Router {
  fetchImpl: typeof fetch;
  bodies: unknown[];
}

function router(handle: (url: string) => { status: number; body: unknown }): Router {
  const bodies: unknown[] = [];
  const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
    if (init?.body !== undefined) bodies.push(JSON.parse(String(init.body)));
    const { status, body } = handle(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

function successRouter(rows: CandidateRow[]): Router {
  return router((url) => {
    if (url.includes("home_area")) return { status: 200, body: [{ fsa: "K1S" }] };
    if (url.includes("households")) {
      return { status: 200, body: [{ id: "h1", home_fsa: "K1S" }] };
    }
    if (url.includes("members")) {
      return {
        status: 200,
        body: [{ age_band: "kids", include_adjacent: true }],
      };
    }
    if (url.includes("preferences")) {
      return {
        status: 200,
        body: [
          {
            max_price_cents: 2500,
            free_only: false,
            max_distance_km: 5,
            availability: {},
            language: [],
            accessibility: [],
            interests: ["music"],
            avoid: [],
          },
        ],
      };
    }
    if (url.includes("rpc/recommend_candidates")) {
      return { status: 200, body: rows };
    }
    throw new Error(`unexpected url ${url}`);
  });
}

function rerankReply(ids: string[]): string {
  return JSON.stringify(
    ids.map((event_id) => ({ event_id, reason: "Fits well (stated)" })),
  );
}

function scriptedChat(
  reply: string,
  seen: ChatRequest[],
): (request: ChatRequest) => Promise<ChatResult> {
  return async (request) => {
    seen.push(request);
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

function deps(
  fetchImpl: typeof fetch,
  chatFn: (request: ChatRequest) => Promise<ChatResult>,
  extra: Partial<RecommendDeps> = {},
): RecommendDeps {
  return {
    supabaseUrl: "https://test.invalid",
    anonKey: "anon",
    fetchImpl,
    chatFn,
    llmConfig: resolveConfig({} as NodeJS.ProcessEnv, {
      cacheDir: "/tmp/seatpop-test-cache",
      ledgerPath: "/tmp/seatpop-test-ledger/calls.jsonl",
      runId: "test",
    }),
    now: new Date("2026-06-01T00:00:00.000Z"),
    ...extra,
  };
}

const GUEST_PREFS = {
  members: [{ age_band: "kids", include_adjacent: true }],
  max_price_cents: 2500,
  max_distance_km: 5,
  fsa: "K1S",
  interests: ["music"],
};

describe("runRecommend", () => {
  it("serves guests end to end with a reranked top 10", async () => {
    const seen: ChatRequest[] = [];
    const { fetchImpl, bodies } = successRouter([
      row("e1", "2026-06-10T14:00:00.000Z"),
      row("e2", "2026-06-11T14:00:00.000Z"),
    ]);
    const result = await runRecommend(
      { prefs: GUEST_PREFS },
      deps(fetchImpl, scriptedChat(rerankReply(["e2", "e1"]), seen)),
    );
    expect(result.items.map((i) => i.event_id)).toEqual(["e2", "e1"]);
    expect(result.items[0]?.reason).toBe("Fits well (stated)");
    expect(result.items[0]?.reasonFromModel).toBe(true);
    expect(typeof result.items[0]?.score).toBe("number");
    expect(result.meta.reranked).toBe(true);
    expect(result.meta.model).toBe("muse-spark-1.3");
    expect(result.meta.warnings).toEqual([
      "only 2 event(s) passed the hard constraints",
    ]);
    expect(seen).toHaveLength(1);
    const rpc = bodies.find(
      (b): b is { p_prefs: unknown; p_limit: number } =>
        typeof b === "object" && b !== null && "p_prefs" in b,
    );
    expect(rpc?.p_limit).toBe(200);
    expect(rpc?.p_prefs).toMatchObject({ fsa: "K1S", max_price_cents: 2500 });
  });

  it("rejects invalid prefs, missing areas, and unknown areas", async () => {
    const { fetchImpl } = successRouter([]);
    const d = deps(fetchImpl, scriptedChat("[]", []));
    await expect(runRecommend({ prefs: { members: [] } }, d)).rejects.toThrow(
      RecommendError,
    );
    await expect(
      runRecommend(
        { prefs: { members: [{ age_band: "kids" }], max_distance_km: 5 } },
        d,
      ),
    ).rejects.toThrow(/needs an fsa/);
    const noArea = router((url) => {
      if (url.includes("home_area")) return { status: 200, body: [] };
      throw new Error(`unexpected url ${url}`);
    });
    await expect(
      runRecommend(
        { prefs: GUEST_PREFS },
        deps(noArea.fetchImpl, scriptedChat("[]", [])),
      ),
    ).rejects.toThrow(/unknown area/);
  });

  it("loads saved households behind sign-in", async () => {
    const seen: ChatRequest[] = [];
    const { fetchImpl, bodies } = successRouter([
      row("e1", "2026-06-10T14:00:00.000Z"),
    ]);
    const result = await runRecommend(
      { householdId: "h1" },
      deps(fetchImpl, scriptedChat(rerankReply(["e1"]), seen), {
        userJwt: "jwt",
      }),
    );
    expect(result.items).toHaveLength(1);
    const rpc = bodies.find(
      (b): b is { p_prefs: Record<string, unknown> } =>
        typeof b === "object" && b !== null && "p_prefs" in b,
    );
    expect(rpc?.p_prefs).toMatchObject({ fsa: "K1S", max_price_cents: 2500 });

    // No JWT: RLS would blind the reads, so refuse before calling.
    await expect(
      runRecommend({ householdId: "h1" }, deps(fetchImpl, scriptedChat("[]", []))),
    ).rejects.toThrow(/sign-in/);

    // Unknown household or memberless household: invalid.
    const emptyHouse = router(() => ({ status: 200, body: [] }));
    await expect(
      runRecommend(
        { householdId: "nope" },
        deps(emptyHouse.fetchImpl, scriptedChat("[]", []), { userJwt: "jwt" }),
      ),
    ).rejects.toThrow(/not found/);
  });

  it("maps supabase failures to upstream or unauthorized", async () => {
    const d500 = router(() => ({ status: 500, body: {} }));
    await expect(
      runRecommend(
        { prefs: GUEST_PREFS },
        deps(d500.fetchImpl, scriptedChat("[]", [])),
      ),
    ).rejects.toThrow(/HTTP 500/);

    const d401 = router(() => ({ status: 401, body: {} }));
    await expect(
      runRecommend(
        { prefs: GUEST_PREFS },
        deps(d401.fetchImpl, scriptedChat("[]", [])),
      ),
    ).rejects.toThrow(/sign-in/);

    const badRows = router((url) => {
      if (url.includes("home_area")) return { status: 200, body: [{ fsa: "K1S" }] };
      if (url.includes("rpc/recommend_candidates")) {
        return { status: 200, body: [{ nope: true }] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    await expect(
      runRecommend(
        { prefs: GUEST_PREFS },
        deps(badRows.fetchImpl, scriptedChat("[]", [])),
      ),
    ).rejects.toThrow(/schema drift/);
  });

  it("falls back to stage-2 order with templated reasons on budget stop", async () => {
    const seen: ChatRequest[] = [];
    const { fetchImpl } = successRouter([
      row("e1", "2026-06-10T14:00:00.000Z"),
      row("e2", "2026-06-11T14:00:00.000Z"),
    ]);
    const throwing = async (request: ChatRequest): Promise<ChatResult> => {
      seen.push(request);
      throw new BudgetExceeded("per_run", 5, 5);
    };
    const result = await runRecommend({ prefs: GUEST_PREFS }, deps(fetchImpl, throwing));
    // Stage-2 order (sooner first), templated reasons, honest warnings.
    expect(result.items.map((i) => i.event_id)).toEqual(["e1", "e2"]);
    expect(result.items.every((i) => !i.reasonFromModel)).toBe(true);
    expect(result.items[0]?.reason).toContain("(stated)");
    expect(result.meta.reranked).toBe(false);
    expect(result.meta.model).toBeNull();
    expect(result.meta.warnings).toContain("rerank unavailable; showing match order");
  });

  it("short-circuits an empty candidate set without model calls", async () => {
    const seen: ChatRequest[] = [];
    const { fetchImpl } = successRouter([]);
    const result = await runRecommend(
      { prefs: GUEST_PREFS },
      deps(fetchImpl, scriptedChat("[]", seen)),
    );
    expect(result.items).toEqual([]);
    expect(seen).toHaveLength(0);
    expect(result.meta.reranked).toBe(false);
    expect(result.meta.warnings).toEqual([
      "only 0 event(s) passed the hard constraints",
    ]);
  });
});
