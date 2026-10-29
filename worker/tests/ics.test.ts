import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Fetcher } from "../src/ingest/fetcher";
import { IcsAdapter, extractIcsLinks, parseIcs } from "../src/ingest/ics";

const FIXTURE = new URL("./fixtures/sample.ics", import.meta.url);
const NOW = new Date("2026-10-27T12:00:00.000Z");
const FEED_URL = "https://example.test/calendar.ics";

function parse(text: string = readFileSync(FIXTURE, "utf8")) {
  return parseIcs(text, { feedUrl: FEED_URL, now: NOW });
}

describe("ics adapter", () => {
  it("parses single events with timezone conversion", () => {
    const drafts = parse();
    const story = drafts.find((d) => d.title === "Ottawa Story Night");
    expect(story).toBeDefined();
    expect(story?.startsAtUtc).toBe("2026-11-06T00:00:00.000Z");
    expect(story?.endsAtUtc).toBe("2026-11-06T02:00:00.000Z");
    expect(story?.timezone).toBe("America/Toronto");
    expect(story?.venueName).toBe("Main Library, 120 Metcalfe St");
    expect(story?.sourceUrl).toBe("https://example.test/events/story-night");
    expect(story?.description).toBe("A night of stories, told live.");
  });

  it("expands weekly RRULE and honors EXDATE", () => {
    const drafts = parse().filter((d) => d.title === "Wednesday Yoga");
    expect(drafts.map((d) => d.startsAtUtc)).toEqual([
      "2026-11-04T23:00:00.000Z",
      "2026-11-18T23:00:00.000Z",
      "2026-11-25T23:00:00.000Z",
      "2026-12-02T23:00:00.000Z",
    ]);
  });

  it("gives every RRULE occurrence its own raw text", () => {
    const drafts = parse().filter((d) => d.title === "Wednesday Yoga");
    expect(drafts.length).toBeGreaterThan(1);
    const raws = new Set(drafts.map((d) => d.rawText));
    expect(raws.size).toBe(drafts.length);
    for (const draft of drafts) {
      expect(draft.rawText).toContain(draft.startsAtUtc);
    }
  });

  it("maps cancelled status, all-day events, and drops the past", () => {
    const drafts = parse();
    expect(drafts).toHaveLength(7);
    const cancelled = drafts.find((d) => d.title === "Cancelled Concert");
    expect(cancelled?.status).toBe("cancelled");
    const market = drafts.find((d) => d.title === "Christmas Market");
    expect(market?.startsAtUtc).toBe("2026-12-25T05:00:00.000Z");
    expect(market?.endsAtUtc).toBe("2026-12-26T05:00:00.000Z");
    expect(drafts.find((d) => d.title === "Old Event")).toBeUndefined();
  });

  it("supports COUNT, UNTIL, BYDAY and MONTHLY rules", () => {
    const calendar = (rrule: string, dtstart = "20261102T100000") =>
      parse(
        `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;TZID=America/Toronto:${dtstart}\nSUMMARY:T\nRRULE:${rrule}\nEND:VEVENT\nEND:VCALENDAR`,
      );
    // Nov 2 2026 is a Monday.
    expect(
      calendar("FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE").map((d) =>
        d.startsAtUtc.slice(0, 10),
      ),
    ).toEqual(["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"]);
    expect(calendar("FREQ=DAILY;COUNT=3")).toHaveLength(3);
    expect(calendar("FREQ=DAILY;UNTIL=20261001T000000Z")).toHaveLength(0);
    expect(
      calendar("FREQ=MONTHLY;COUNT=2;BYMONTHDAY=15", "20261115T100000").map(
        (d) => d.startsAtUtc.slice(0, 10),
      ),
    ).toEqual(["2026-11-15", "2026-12-15"]);
  });

  it("falls back to a single instance for unsupported frequencies", () => {
    const drafts = parse(
      `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;TZID=America/Toronto:20261102T100000\nSUMMARY:T\nRRULE:FREQ=HOURLY;COUNT=5\nEND:VEVENT\nEND:VCALENDAR`,
    );
    expect(drafts).toHaveLength(1);
  });

  it("forces times into overrideTimezone for mis-tagged feeds", () => {
    const text = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;TZID=America/Halifax:20261105T190000\nDTEND;TZID=America/Halifax:20261105T200000\nSUMMARY:T\nEND:VEVENT\nEND:VCALENDAR`;
    const plain = parse(text);
    expect(plain[0].startsAtUtc).toBe("2026-11-05T23:00:00.000Z");
    const forced = parseIcs(text, {
      feedUrl: FEED_URL,
      now: NOW,
      overrideTimezone: "America/Toronto",
    });
    expect(forced[0].startsAtUtc).toBe("2026-11-06T00:00:00.000Z");
    expect(forced[0].timezone).toBe("America/Toronto");
  });

  it("extracts same-host .ics links from an index page", () => {
    const links = extractIcsLinks(
      "https://example.test/events/",
      `<a href="/feeds/a.ics">a</a><a href="https://example.test/b.ics?x=1">b</a>` +
        `<a href="https://other.test/c.ics">c</a><a href="/page">d</a>`,
    );
    expect(links).toEqual([
      "https://example.test/feeds/a.ics",
      "https://example.test/b.ics?x=1",
    ]);
  });

  it("skips failing files in ics-index mode without failing the source", async () => {
    const good = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;TZID=America/Toronto:20261102T100000\nSUMMARY:Kept\nEND:VEVENT\nEND:VCALENDAR`;
    const fetcher = {
      fetchText: (url: string) => {
        if (url.endsWith("/index")) {
          return Promise.resolve({
            status: 200,
            url,
            text: `<a href="https://example.test/a.ics">a</a><a href="https://example.test/b.ics">b</a>`,
            notModified: false,
          });
        }
        if (url.endsWith("/b.ics")) {
          return Promise.reject(new Error("HTTP 404"));
        }
        return Promise.resolve({
          status: 200,
          url,
          text: good,
          notModified: false,
        });
      },
    } as unknown as Fetcher;
    const drafts = await IcsAdapter.collect(
      {
        name: "test",
        kind: "ics",
        url: "https://example.test/index",
        icsIndex: true,
      },
      { fetcher, now: NOW },
    );
    expect(drafts.map((d) => d.title)).toEqual(["Kept"]);
  });
});
