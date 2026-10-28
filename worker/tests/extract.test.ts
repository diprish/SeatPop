import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chat, type LlmConfig } from "@seatpop/llm";
import {
  EXTRACTION_MAX_TOKENS,
  EXTRACTION_RUN_BUDGET_USD,
  buildExtractionMessages,
  extractEventsFromPage,
  normalizeSpace,
  resolveExtractionConfig,
  type ChatFn,
  type ExtractionPage,
} from "../src/ingest/extract";
import { Fetcher, memoryEtagStore } from "../src/ingest/fetcher";
import { HtmlAdapter } from "../src/ingest/html";
import type { SourceConfig } from "../src/ingest/types";

const PAGE_URL = "https://example.test/whats-on";
const CONCERT_URL = "https://example.test/winter-concert";
const PAGE_TEXT = [
  "What's On",
  "Winter Concert",
  "November 21 at 7:30 PM",
  "A concert of seasonal music in the Grand Hall.",
  "Grand Hall, 123 Main Street",
  "Concerts are popular: book early.",
].join("\n");

function page(text: string = PAGE_TEXT): ExtractionPage {
  return {
    url: PAGE_URL,
    text,
    links: [
      { text: "Winter Concert", url: CONCERT_URL },
      { text: "What's On", url: PAGE_URL },
    ],
  };
}

function source(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    name: "Example Museum",
    kind: "html",
    url: PAGE_URL,
    category: "museums",
    ...overrides,
  };
}

const NOW = new Date("2026-10-28T12:00:00.000Z");

const GOOD_EVENT = {
  title: "Winter Concert",
  title_evidence: "Winter Concert",
  starts_at: "2026-11-21T19:30:00",
  starts_at_evidence: "November 21 at 7:30 PM",
  ends_at: null,
  ends_at_evidence: null,
  description: "A concert of seasonal music in the Grand Hall.",
  description_evidence: "A concert of seasonal music in the Grand Hall.",
  venue_name: "Grand Hall",
  venue_name_evidence: "A concert of seasonal music in the Grand Hall.",
  venue_address: "123 Main Street",
  venue_address_evidence: "Grand Hall, 123 Main Street",
  source_url: CONCERT_URL,
  source_url_evidence: `Winter Concert -> ${CONCERT_URL}`,
  status: "scheduled",
  status_evidence: null,
};

interface Capture {
  calls: number;
  task?: string;
  maxTokens?: number;
  model?: string;
}

function okChat(content: string, capture?: Capture): ChatFn {
  return async (request) => {
    if (capture) {
      capture.calls++;
      capture.task = request.task;
      capture.maxTokens = request.maxTokens;
      capture.model = request.model;
    }
    return {
      ok: true,
      value: {
        content,
        model: "muse-spark-1.3-contributor",
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

const eventsReply = (events: unknown[]): string =>
  JSON.stringify({ events });

function testConfig(): LlmConfig {
  return resolveExtractionConfig({} as NodeJS.ProcessEnv);
}

describe("listing extraction", () => {
  it("extracts a fully-quoted event with UTC times and the official link", async () => {
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([GOOD_EVENT])), now: NOW },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("Winter Concert");
    // Nov 21 is EST (UTC-5): 19:30 local -> 00:30Z next day.
    expect(drafts[0].startsAtUtc).toBe("2026-11-22T00:30:00.000Z");
    expect(drafts[0].sourceUrl).toBe(CONCERT_URL);
    expect(drafts[0].venueName).toBe("Grand Hall");
    expect(drafts[0].venueAddress).toBe("123 Main Street");
    expect(drafts[0].category).toBe("museums");
    expect(drafts[0].timezone).toBe("America/Toronto");
    expect(drafts[0].status).toBe("scheduled");
    expect(drafts[0].rawText).toContain("Winter Concert");
  });

  it("drops events whose title quote is not in the page", async () => {
    const bad = { ...GOOD_EVENT, title_evidence: "Spring Gala Extravaganza" };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([bad])), now: NOW },
    );
    expect(drafts).toHaveLength(0);
  });

  it("drops events whose start quote is not in the page", async () => {
    const bad = { ...GOOD_EVENT, starts_at_evidence: "December 25 at noon" };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([bad])), now: NOW },
    );
    expect(drafts).toHaveLength(0);
  });

  it("drops events whose title is not inside its own quote", async () => {
    const bad = {
      ...GOOD_EVENT,
      title: "Winter Concert (Sold Out!)",
      title_evidence: "Winter Concert",
    };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([bad])), now: NOW },
    );
    expect(drafts).toHaveLength(0);
  });

  it("nulls a paraphrased description but keeps the event", async () => {
    const bad = {
      ...GOOD_EVENT,
      description: "An evening of holiday tunes you will love",
      description_evidence: "A concert of seasonal music in the Grand Hall.",
    };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([bad])), now: NOW },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].description).toBeUndefined();
  });

  it("matches quotes after whitespace normalisation", async () => {
    const messy = PAGE_TEXT.replace("Winter Concert", "Winter   Concert\n");
    const drafts = await extractEventsFromPage(
      page(messy),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([GOOD_EVENT])), now: NOW },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("Winter Concert");
  });

  it("treats date-only starts as local midnight, never an invented time", async () => {
    const dateOnly = {
      ...GOOD_EVENT,
      starts_at: "2026-11-21",
      starts_at_evidence: "November 21 at 7:30 PM",
    };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([dateOnly])), now: NOW },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].startsAtUtc).toBe("2026-11-21T05:00:00.000Z");
  });

  it("drops events with impossible dates", async () => {
    const bad = {
      ...GOOD_EVENT,
      starts_at: "2026-02-30T19:30:00",
      starts_at_evidence: "November 21 at 7:30 PM",
    };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([bad])), now: NOW },
    );
    expect(drafts).toHaveLength(0);
  });

  it("drops an end before the start but keeps the event", async () => {
    const bad = {
      ...GOOD_EVENT,
      ends_at: "2026-11-21T18:00:00",
      ends_at_evidence: "November 21 at 7:30 PM",
    };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([bad])), now: NOW },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].endsAtUtc).toBeUndefined();
  });

  it("honours a verified source time-zone override", async () => {
    const drafts = await extractEventsFromPage(
      page(),
      source({ overrideTimezone: "America/Vancouver" }),
      { config: testConfig(), chatFn: okChat(eventsReply([GOOD_EVENT])), now: NOW },
    );
    expect(drafts).toHaveLength(1);
    // Nov 21 is PST (UTC-8): 19:30 local -> 03:30Z next day.
    expect(drafts[0].startsAtUtc).toBe("2026-11-22T03:30:00.000Z");
  });

  it("falls back to the listing page when the event link is unknown", async () => {
    const bad = {
      ...GOOD_EVENT,
      source_url: "https://evil.test/phish",
      source_url_evidence: `Winter Concert -> ${CONCERT_URL}`,
    };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([bad])), now: NOW },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sourceUrl).toBe(PAGE_URL);
  });

  it("falls back to the listing page when the event link is null", async () => {
    const bare = { ...GOOD_EVENT, source_url: null, source_url_evidence: null };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([bare])), now: NOW },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sourceUrl).toBe(PAGE_URL);
  });

  it("keeps a quoted non-scheduled status, drops an unquoted one", async () => {
    const quoted = {
      ...GOOD_EVENT,
      status: "full",
      status_evidence: "Concerts are popular: book early.",
    };
    const unquoted = { ...GOOD_EVENT, status: "cancelled", status_evidence: null };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      {
        config: testConfig(),
        chatFn: okChat(eventsReply([quoted, unquoted])),
        now: NOW,
      },
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[0].status).toBe("full");
    expect(drafts[1].status).toBe("scheduled");
  });

  it("strips price, age and other unknown keys: no inference escapes", async () => {
    const sneaky = {
      ...GOOD_EVENT,
      price: "free",
      ages: "all ages",
      is_free: true,
    };
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([sneaky])), now: NOW },
    );
    expect(drafts).toHaveLength(1);
    expect("price" in drafts[0]).toBe(false);
    expect("ages" in drafts[0]).toBe(false);
    expect("is_free" in drafts[0]).toBe(false);
  });

  it("skips invalid events without losing the valid ones", async () => {
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      {
        config: testConfig(),
        chatFn: okChat(eventsReply([{ nope: true }, GOOD_EVENT])),
        now: NOW,
      },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("Winter Concert");
  });

  it("returns nothing when the reply is not JSON", async () => {
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat("sorry, no events here"), now: NOW },
    );
    expect(drafts).toHaveLength(0);
  });

  it("returns nothing when the reply has no events array", async () => {
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      {
        config: testConfig(),
        chatFn: okChat(JSON.stringify({ concerts: [] })),
        now: NOW,
      },
    );
    expect(drafts).toHaveLength(0);
  });

  it("returns nothing when the model call fails", async () => {
    const failing: ChatFn = async () => ({
      ok: false,
      error: { kind: "config", message: "MODEL_API_KEY is not set" },
    });
    const drafts = await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: failing, now: NOW },
    );
    expect(drafts).toHaveLength(0);
  });

  it("sends task listing_extraction with a fixed limit and no model override", async () => {
    const capture: Capture = { calls: 0 };
    await extractEventsFromPage(
      page(),
      source(),
      { config: testConfig(), chatFn: okChat(eventsReply([GOOD_EVENT]), capture), now: NOW },
    );
    expect(capture.calls).toBe(1);
    // Routing by task only: the client maps listing_extraction (and nothing
    // else) to the contributor model.
    expect(capture.task).toBe("listing_extraction");
    expect(capture.model).toBeUndefined();
    expect(capture.maxTokens).toBe(EXTRACTION_MAX_TOKENS);
    expect(EXTRACTION_MAX_TOKENS).toBe(4096);
  });

  it("builds a deterministic prompt for identical input", () => {
    const input = {
      sourceName: "Example Museum",
      pageUrl: PAGE_URL,
      today: "2026-10-28",
      timezone: "America/Toronto",
      text: PAGE_TEXT,
      links: page().links,
    };
    expect(buildExtractionMessages(input)).toEqual(
      buildExtractionMessages(input),
    );
  });

  it("forces the $2 per-run cap even when the env allows more", () => {
    expect(EXTRACTION_RUN_BUDGET_USD).toBe(2);
    const config = resolveExtractionConfig({
      LLM_MAX_USD_PER_RUN: "10",
    } as NodeJS.ProcessEnv);
    expect(config.budgets.perRun).toBe(2);
  });

  it("normalises whitespace for evidence matching", () => {
    expect(normalizeSpace("  Winter\n\t Concert  ")).toBe("Winter Concert");
  });

  it("serves the second identical extraction from cache with zero network calls", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "extract-cache-"));
    const config = resolveExtractionConfig({
      MODEL_API_KEY: "test-key",
      LLM_CACHE_DIR: path.join(root, "cache"),
      LLM_LEDGER_PATH: path.join(root, "ledger.jsonl"),
      LLM_RUN_ID: "extract-cache-test",
    } as NodeJS.ProcessEnv);
    let calls = 0;
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          model: "muse-spark-1.3-contributor",
          choices: [
            {
              message: {
                role: "assistant",
                content: eventsReply([GOOD_EVENT]),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const counting: typeof fetch = (async (...args: unknown[]) => {
      calls++;
      return (fetchImpl as (...a: unknown[]) => Promise<Response>)(...args);
    }) as unknown as typeof fetch;
    const deps = { config, fetchImpl: counting, chatFn: chat, now: NOW };
    const first = await extractEventsFromPage(page(), source(), deps);
    const second = await extractEventsFromPage(page(), source(), deps);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("extracts through the html adapter from raw listing HTML", async () => {
    const html = [
      "<html><head><title>What’s On</title></head><body>",
      "<h1>What’s On</h1>",
      `<h2><a href="/winter-concert">Winter Concert</a></h2>`,
      "<p>November 21 at 7:30 PM</p>",
      "<p>A concert of seasonal music in the Grand Hall.</p>",
      "<p>Grand Hall, 123 Main Street</p>",
      "<p>Concerts are popular: book early.</p>",
      "</body></html>",
    ].join("\n");
    const fetchImpl = (async (url: unknown) => {
      const target = String(url);
      if (target.endsWith("/robots.txt")) {
        return new Response("User-agent: *\n", { status: 200 });
      }
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;
    const fetcher = new Fetcher({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      minDelayMs: 1,
      etagStore: memoryEtagStore(),
    });
    const drafts = await HtmlAdapter.collect(source(), {
      fetcher,
      now: NOW,
      llm: {
        config: testConfig(),
        chatFn: okChat(eventsReply([GOOD_EVENT])),
      },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("Winter Concert");
    expect(drafts[0].sourceUrl).toBe(CONCERT_URL);
  });

  it("yields nothing without LLM access", async () => {
    const fetcher = new Fetcher({
      contactUrl: "https://example.test/contact",
      minDelayMs: 1,
      etagStore: memoryEtagStore(),
    });
    const drafts = await HtmlAdapter.collect(source(), {
      fetcher,
      now: NOW,
    });
    expect(drafts).toHaveLength(0);
  });
});
