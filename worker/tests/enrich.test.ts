import { describe, expect, it } from "vitest";
import type { ChatRequest } from "@seatpop/llm";
import type { ChatFn } from "../src/ingest/extract";
import {
  resolveEnrichConfig,
  resolveProvider,
} from "../src/enrich/config";
import { listCandidates } from "../src/enrich/store";
import {
  sourceHashFor,
  verificationSource,
  voteEnrichment,
  type EnrichEventInput,
} from "../src/enrich/vote";

const INPUT: EnrichEventInput = {
  id: "e1",
  title: "Winter Concert",
  description:
    "An evening of seasonal music. Tickets $15 at the door. Ages 10 to 12.",
  venueName: "Grand Hall",
};

const AGE_QUOTE = "Ages 10 to 12.";
const PRICE_QUOTE = "Tickets $15 at the door.";

function field(value: unknown, quote: string | null): unknown {
  return { value, quote };
}

function reply(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    age_min: field(10, AGE_QUOTE),
    price_kind: field("paid", PRICE_QUOTE),
    amount_min_cents: field(1500, PRICE_QUOTE),
    summary_short: { value: "Seasonal concert for ages 10 to 12." },
    tags: { value: ["music", "concert"] },
    ...overrides,
  });
}

interface Seen {
  requests: ChatRequest[];
}

function scriptedChat(
  contents: Array<string | null>,
  seen?: Seen,
): ChatFn {
  let calls = 0;
  return async (request) => {
    seen?.requests.push(request);
    const content = contents[Math.min(calls, contents.length - 1)] ?? null;
    calls++;
    if (content === null) {
      return {
        ok: false,
        error: { kind: "config", message: "MODEL_API_KEY is not set" },
      };
    }
    return {
      ok: true,
      value: {
        content,
        model: "muse-spark-1.3-contributor",
        finishReason: "stop",
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          cachedTokens: 0,
          reasoningTokens: 5,
        },
        costUsd: 0.001,
        cached: false,
      },
    };
  };
}

const config = () => resolveEnrichConfig({} as NodeJS.ProcessEnv);

describe("enrichment voting", () => {
  it("takes agreeing passes after two calls with confidence 1", async () => {
    const seen: Seen = { requests: [] };
    const result = await voteEnrichment(INPUT, {
      config: config(),
      chatFn: scriptedChat([reply(), reply()], seen),
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(result).not.toBeNull();
    expect(result?.passesUsed).toBe(2);
    expect(result?.confidence).toBe(1);
    expect(result?.values.age_min).toBe(10);
    expect(result?.values.price_kind).toBe("paid");
    expect(result?.values.amount_min_cents).toBe(1500);
    expect(result?.values.age_max).toBeNull();
    expect(result?.summary).toBe("Seasonal concert for ages 10 to 12.");
    expect(result?.tags).toEqual(["music", "concert"]);
    expect(result?.model).toBe("muse-spark-1.3-contributor");
    expect(result?.calls).toHaveLength(2);
    expect(seen.requests).toHaveLength(2);
  });

  it("runs a third pass on disagreement and takes the majority", async () => {
    const p1 = reply();
    const p2 = reply({ age_min: field(12, AGE_QUOTE) });
    const p3 = reply();
    const result = await voteEnrichment(INPUT, {
      config: config(),
      chatFn: scriptedChat([p1, p2, p3]),
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(result?.passesUsed).toBe(3);
    expect(result?.values.age_min).toBe(10);
    expect(result?.confidence).toBeCloseTo(16 / 17, 5);
  });

  it("nulls fields with no majority across three passes", async () => {
    const varied: EnrichEventInput = {
      ...INPUT,
      description: "Show indoors or outdoors, also online.",
    };
    const vote = (setting: string): string =>
      JSON.stringify({
        setting: field(setting, "Show indoors or outdoors, also online."),
      });
    const result = await voteEnrichment(varied, {
      config: config(),
      chatFn: scriptedChat([vote("indoors"), vote("outdoors"), vote("online")]),
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(result?.passesUsed).toBe(3);
    expect(result?.values.setting).toBeNull();
    expect(result?.confidence).toBeCloseTo(16 / 17, 5);
  });

  it("falls back to one parsed pass at low confidence", async () => {
    const result = await voteEnrichment(INPUT, {
      config: config(),
      chatFn: scriptedChat(["not json at all", reply()]),
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(result?.passesUsed).toBe(2);
    expect(result?.confidence).toBe(0.5);
    expect(result?.values.age_min).toBe(10);
  });

  it("returns null when no pass parses", async () => {
    const result = await voteEnrichment(INPUT, {
      config: config(),
      chatFn: scriptedChat(["nope", null]),
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(result).toBeNull();
  });

  it("repairs inverted ranges to null", async () => {
    const bad = reply({
      age_min: field(12, AGE_QUOTE),
      age_max: field(10, AGE_QUOTE),
    });
    const result = await voteEnrichment(INPUT, {
      config: config(),
      chatFn: scriptedChat([bad, bad]),
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(result?.values.age_min).toBeNull();
    expect(result?.values.age_max).toBeNull();
  });

  it("flows v2 vocab and word-form durations end to end", async () => {
    const input: EnrichEventInput = {
      ...INPUT,
      description:
        "A quiet morning session in the main hall. A one-hour workshop. Limited to 12 spots.",
    };
    const content = JSON.stringify({
      setting: field("indoors", "in the main hall"),
      energy: field("calm", "A quiet morning session"),
      crowd: field("small-group", "Limited to 12 spots"),
      duration_min: field(60, "A one-hour workshop"),
    });
    const result = await voteEnrichment(input, {
      config: config(),
      chatFn: scriptedChat([content, content]),
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(result?.values.setting).toBe("indoors");
    expect(result?.values.energy).toBe("calm");
    expect(result?.values.crowd).toBe("small-group");
    expect(result?.values.duration_min).toBe(60);
  });

  it("uppercases grounded currency codes", async () => {
    const withCad = reply({
      currency: field("cad", "Tickets $15 CAD at the door."),
      amount_min_cents: field(1500, "Tickets $15 CAD at the door."),
    });
    const input: EnrichEventInput = {
      ...INPUT,
      description: "Concert. Tickets $15 CAD at the door. Ages 10 to 12.",
    };
    const result = await voteEnrichment(input, {
      config: config(),
      chatFn: scriptedChat([withCad, withCad]),
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(result?.values.currency).toBe("CAD");
  });

  it("sends the listing task at temperature 0.3 with distinct pass keys", async () => {
    const seen: Seen = { requests: [] };
    await voteEnrichment(INPUT, {
      config: config(),
      chatFn: scriptedChat([reply(), reply()], seen),
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    for (const request of seen.requests) {
      expect(request.task).toBe("listing_extraction");
      expect(request.temperature).toBe(0.3);
      expect(request.maxTokens).toBe(2048);
      expect(request.model).toBeUndefined();
    }
    expect(seen.requests[0].messages).not.toEqual(seen.requests[1].messages);
  });

  it("pins the spark model when the comparison flag sets one", async () => {
    const seen: Seen = { requests: [] };
    await voteEnrichment(INPUT, {
      config: config(),
      chatFn: scriptedChat([reply(), reply()], seen),
      model: "muse-spark-1.3",
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(seen.requests[0].model).toBe("muse-spark-1.3");
  });

  it("routes votes to Baseten when the provider flag sets it", async () => {
    const seen: Seen = { requests: [] };
    await voteEnrichment(INPUT, {
      config: config(),
      chatFn: scriptedChat([reply(), reply()], seen),
      provider: "baseten",
      now: new Date("2026-10-28T12:00:00.000Z"),
    });
    expect(seen.requests[0].provider).toBe("baseten");
    expect(seen.requests[0].model).toBeUndefined();
  });

  it("hashes the source stably and detects changes", () => {
    const base = {
      title: INPUT.title,
      description: INPUT.description,
      venueName: INPUT.venueName,
    };
    expect(sourceHashFor(base)).toBe(sourceHashFor({ ...base }));
    expect(sourceHashFor({ ...base, description: "changed" })).not.toBe(
      sourceHashFor(base),
    );
  });

  it("verifies against the event text only", () => {
    const source = verificationSource(INPUT);
    expect(source).toContain("winter concert");
    expect(source).toContain("grand hall");
    expect(source).not.toContain("voting pass");
  });

  it("resolves the provider from flag, env, then default", () => {
    expect(resolveProvider("baseten")).toBe("baseten");
    expect(resolveProvider("spark")).toBe("spark");
    expect(resolveProvider("contributor")).toBe("contributor");
    expect(resolveProvider(undefined, { ENRICH_PROVIDER: "spark" } as NodeJS.ProcessEnv)).toBe(
      "spark",
    );
    expect(resolveProvider(undefined, {} as NodeJS.ProcessEnv)).toBe("baseten");
    expect(resolveProvider(undefined, { ENRICH_PROVIDER: "bogus" } as NodeJS.ProcessEnv)).toBe(
      "baseten",
    );
  });

  it("forces the $5 per-run cap", () => {
    const forced = resolveEnrichConfig({
      LLM_MAX_USD_PER_RUN: "10",
    } as NodeJS.ProcessEnv);
    expect(forced.budgets.perRun).toBe(5);
  });

  it("disambiguates the sources embed or PostgREST answers 300", async () => {
    let seenUrl = "";
    const fetchImpl = (async (url: unknown) => {
      seenUrl = String(url);
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;
    await listCandidates({
      url: "https://test.invalid",
      serviceKey: "key",
      fetchImpl,
    });
    expect(seenUrl).toContain("src:sources!events_source_id_fkey(");
  });
});
