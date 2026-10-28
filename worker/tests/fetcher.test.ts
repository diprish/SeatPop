import { describe, expect, it } from "vitest";
import {
  Fetcher,
  HttpNoRetry,
  RobotsDisallowed,
  memoryEtagStore,
  parseRobotsTxt,
} from "../src/ingest/fetcher";

interface Captured {
  url: string;
  headers: Record<string, string>;
}

function mockFetch(
  handler: (url: string, headers: Record<string, string>) => Response,
): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: unknown, init?: { headers?: unknown }) => {
    const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
    calls.push({ url: String(url), headers });
    return handler(String(url), headers);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const text = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe("fetcher", () => {
  it("parses robots groups, disallows and crawl-delay", () => {
    const rules = parseRobotsTxt(
      "User-agent: *\nDisallow: /admin\nCrawl-delay: 5\n",
    );
    expect(rules.disallows).toEqual(["/admin"]);
    expect(rules.crawlDelayMs).toBe(5000);
  });

  it("refuses disallowed paths without fetching them", async () => {
    const { fetchImpl, calls } = mockFetch((url) =>
      url.endsWith("/robots.txt")
        ? text("User-agent: *\nDisallow: /events\n")
        : text("page"),
    );
    const fetcher = new Fetcher({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      minDelayMs: 1,
    });
    await expect(
      fetcher.fetchText("https://example.test/events/x"),
    ).rejects.toBeInstanceOf(RobotsDisallowed);
    expect(calls.map((c) => c.url)).toEqual([
      "https://example.test/robots.txt",
    ]);
  });

  it("honors crawl-delay above the configured floor", async () => {
    const { fetchImpl } = mockFetch((url) =>
      url.endsWith("/robots.txt")
        ? text("User-agent: *\nCrawl-delay: 5\n")
        : text("page"),
    );
    let now = 1000;
    const sleeps: number[] = [];
    const fetcher = new Fetcher({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      minDelayMs: 10,
      now: () => now,
      sleep: (ms: number) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    await fetcher.fetchText("https://example.test/a");
    await fetcher.fetchText("https://example.test/b");
    // Both content fetches wait out the 5 s crawl-delay, not the 10 ms floor.
    expect(sleeps).toEqual([5000, 5000]);
  });

  it("never retries after 403", async () => {
    const { fetchImpl, calls } = mockFetch((url) =>
      url.endsWith("/robots.txt") ? text("User-agent: *\n") : text("no", 403),
    );
    const fetcher = new Fetcher({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      minDelayMs: 1,
    });
    const error = await fetcher
      .fetchText("https://example.test/page")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpNoRetry);
    expect((error as HttpNoRetry).status).toBe(403);
    expect(calls).toHaveLength(2);
  });

  it("sends conditional headers and honors 304", async () => {
    const seen: Array<Record<string, string>> = [];
    // The Response constructor rejects null-body statuses, so 304 needs a stub.
    const notModified = {
      status: 304,
      ok: false,
      url: "",
      headers: new Headers(),
      text: async () => "",
    } as unknown as Response;
    const { fetchImpl } = mockFetch((url, headers) => {
      if (url.endsWith("/robots.txt")) return text("User-agent: *\n");
      seen.push(headers);
      if (headers["If-None-Match"] === '"abc"') {
        return notModified;
      }
      return text("v1", 200, { ETag: '"abc"' });
    });
    const fetcher = new Fetcher({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      minDelayMs: 1,
      etagStore: memoryEtagStore(),
    });
    const first = await fetcher.fetchText("https://example.test/feed");
    expect(first.notModified).toBe(false);
    expect(first.text).toBe("v1");
    const second = await fetcher.fetchText("https://example.test/feed");
    expect(second.notModified).toBe(true);
    expect(second.text).toBe("");
    expect(seen[1]?.["User-Agent"]).toContain("https://example.test/contact");
  });

  it("treats a hidden robots.txt as disallow-all", async () => {
    const { fetchImpl } = mockFetch((url) =>
      url.endsWith("/robots.txt") ? text("no", 403) : text("page"),
    );
    const fetcher = new Fetcher({
      fetchImpl,
      contactUrl: "https://example.test/contact",
      minDelayMs: 1,
    });
    await expect(fetcher.robotsOk("https://example.test/anything")).resolves.toBe(
      false,
    );
  });
});
