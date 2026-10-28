import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRss } from "../src/ingest/rss";

const RSS = new URL("./fixtures/feed-rss.xml", import.meta.url);
const ATOM = new URL("./fixtures/feed-atom.xml", import.meta.url);
const NOW = new Date("2026-10-27T12:00:00.000Z");

describe("rss adapter", () => {
  it("uses explicit event dates and strips item markup", () => {
    const drafts = parseRss(readFileSync(RSS, "utf8"), {
      feedUrl: "https://example.test/feed",
      now: NOW,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("Winter Concert");
    expect(drafts[0].startsAtUtc).toBe("2026-11-21T00:00:00.000Z");
    expect(drafts[0].description).toBe("A concert.");
  });

  it("falls back to publish dates only when the source declares it", () => {
    const strict = parseRss(readFileSync(RSS, "utf8"), {
      feedUrl: "https://example.test/feed",
      now: NOW,
    });
    expect(strict.find((d) => d.title === "Fall Fair")).toBeUndefined();
    const declared = parseRss(readFileSync(RSS, "utf8"), {
      feedUrl: "https://example.test/feed",
      now: NOW,
      pubDateIsEventDate: true,
    });
    expect(declared).toHaveLength(2);
    const fair = declared.find((d) => d.title === "Fall Fair");
    expect(fair?.startsAtUtc).toBe("2026-11-10T12:00:00.000Z");
    expect(fair?.sourceUrl).toBe("https://example.test/fair");
  });

  it("parses Atom entries", () => {
    const drafts = parseRss(readFileSync(ATOM, "utf8"), {
      feedUrl: "https://example.test/atom",
      now: NOW,
      pubDateIsEventDate: true,
    });
    expect(drafts.map((d) => d.title)).toEqual([
      "November Run",
      "December Swim",
    ]);
    expect(drafts[0].sourceUrl).toBe("https://example.test/run");
    const strict = parseRss(readFileSync(ATOM, "utf8"), {
      feedUrl: "https://example.test/atom",
      now: NOW,
    });
    expect(strict).toHaveLength(0);
  });
});
