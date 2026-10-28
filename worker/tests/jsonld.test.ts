import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HttpNoRetry, type Fetcher } from "../src/ingest/fetcher";
import { JsonLdAdapter, parseJsonLd } from "../src/ingest/jsonld";

const FIXTURE = new URL("./fixtures/events-jsonld.html", import.meta.url);
const NOW = new Date("2026-10-27T12:00:00.000Z");

describe("jsonld adapter", () => {
  it("extracts schema.org Events from script blocks and @graph", () => {
    const drafts = parseJsonLd(readFileSync(FIXTURE, "utf8"), {
      pageUrl: "https://example.test/events",
      now: NOW,
    });
    expect(drafts).toHaveLength(2);
    const gallery = drafts.find((d) => d.title === "Gallery Opening");
    expect(gallery?.startsAtUtc).toBe("2026-11-06T23:00:00.000Z");
    expect(gallery?.endsAtUtc).toBe("2026-11-07T02:00:00.000Z");
    expect(gallery?.venueName).toBe("Test Gallery");
    expect(gallery?.venueAddress).toBe("10 Gallery St, Ottawa");
    expect(gallery?.sourceUrl).toBe("https://example.test/opening");
    const concert = drafts.find((d) => d.title === "Graph Concert");
    expect(concert?.startsAtUtc).toBe("2026-12-01T20:00:00.000Z");
    expect(concert?.venueName).toBe("Old Hall");
    expect(concert?.sourceUrl).toBe("https://example.test/events");
  });

  it("follows an index page through linkPattern", async () => {
    const pages: Record<string, string> = {
      "https://example.test/index":
        `<a href="/e1">one</a><a href="/e2">two</a><a href="/about">x</a>`,
      "https://example.test/e1":
        `<script type="application/ld+json">{"@type":"Event","name":"One","startDate":"2026-11-10T19:00:00-05:00"}</script>`,
      "https://example.test/e2":
        `<script type="application/ld+json">{"@type":"Event","name":"Two","startDate":"2026-12-10T19:00:00-05:00"}</script>`,
    };
    const fetcher = {
      fetchText: (url: string) =>
        Promise.resolve({
          status: 200,
          url,
          text: pages[url] ?? "",
          notModified: false,
        }),
    } as unknown as Fetcher;
    const drafts = await JsonLdAdapter.collect(
      {
        name: "test",
        kind: "jsonld",
        url: "https://example.test/index",
        linkPattern: "/e\\d",
      },
      { fetcher, now: NOW },
    );
    expect(drafts.map((d) => d.title).sort()).toEqual(["One", "Two"]);
  });

  it("skips failing detail pages without failing the source", async () => {
    const fetcher = {
      fetchText: (url: string) => {
        if (url.endsWith("/index")) {
          return Promise.resolve({
            status: 200,
            url,
            text: `<a href="/ok">ok</a><a href="/bad">bad</a>`,
            notModified: false,
          });
        }
        if (url.endsWith("/bad")) {
          return Promise.reject(new HttpNoRetry(url, 403));
        }
        return Promise.resolve({
          status: 200,
          url,
          text: `<script type="application/ld+json">{"@type":"Event","name":"Ok","startDate":"2026-11-10T19:00:00-05:00"}</script>`,
          notModified: false,
        });
      },
    } as unknown as Fetcher;
    const drafts = await JsonLdAdapter.collect(
      {
        name: "test",
        kind: "jsonld",
        url: "https://example.test/index",
        linkPattern: "example\\.test/(ok|bad)",
      },
      { fetcher, now: NOW },
    );
    expect(drafts.map((d) => d.title)).toEqual(["Ok"]);
  });
});
