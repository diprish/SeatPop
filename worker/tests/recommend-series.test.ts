import { describe, expect, it } from "vitest";
import {
  groupSeries,
  hasSeriesPattern,
  seriesKey,
  type SeriesRow,
} from "../src/recommend/series";

const BASE = Date.UTC(2026, 10, 7, 15, 0, 0);
const day = (n: number): string =>
  new Date(BASE + n * 86_400_000).toISOString();

function row(overrides: Partial<SeriesRow> & { event_id: string }): SeriesRow {
  return {
    title: "Saturday Storytime",
    starts_at: day(0),
    venue_name: "Main Branch",
    ...overrides,
  };
}

describe("seriesKey", () => {
  it("ignores title case and punctuation", () => {
    expect(seriesKey(row({ event_id: "a" }))).toBe(
      seriesKey(row({ event_id: "b", title: "saturday storytime!" })),
    );
    expect(seriesKey(row({ event_id: "c", venue_name: null }))).toBe(
      seriesKey(row({ event_id: "d", venue_name: null })),
    );
  });

  it("splits on title and venue differences", () => {
    const base = seriesKey(row({ event_id: "a" }));
    expect(seriesKey(row({ event_id: "b", title: "Lego Club" }))).not.toBe(
      base,
    );
    expect(
      seriesKey(row({ event_id: "c", venue_name: "Greenboro Branch" })),
    ).not.toBe(base);
  });
});

describe("hasSeriesPattern", () => {
  it("accepts weekly trios and weekly pairs", () => {
    expect(hasSeriesPattern([day(0), day(7), day(14)])).toBe(true);
    expect(hasSeriesPattern([day(0), day(7)])).toBe(true);
  });

  it("accepts regular non-weekly cadences of three or more", () => {
    expect(hasSeriesPattern([day(0), day(14), day(28)])).toBe(true);
    expect(hasSeriesPattern([day(0), day(1), day(2)])).toBe(true);
  });

  it("rejects pairs that are not weekly", () => {
    expect(hasSeriesPattern([day(0), day(3)])).toBe(false);
    expect(hasSeriesPattern([day(0), day(30)])).toBe(false);
  });

  it("rejects irregular gaps and bad input", () => {
    expect(hasSeriesPattern([day(0), day(7), day(9)])).toBe(false);
    expect(hasSeriesPattern([day(0)])).toBe(false);
    expect(hasSeriesPattern([])).toBe(false);
    expect(hasSeriesPattern([day(0), "not-a-date"])).toBe(false);
    expect(hasSeriesPattern([day(7), day(0)])).toBe(false);
  });

  it("tolerates DST-shifted weekly gaps", () => {
    // Oct 31 14:00Z to Nov 7 15:00Z is 7 days + 1 hour (DST ended).
    expect(
      hasSeriesPattern(["2026-10-31T14:00:00.000Z", "2026-11-07T15:00:00.000Z"]),
    ).toBe(true);
  });
});

describe("groupSeries", () => {
  it("groups a weekly series into one slot showing the next occurrence", () => {
    const slots = groupSeries([
      row({ event_id: "a2", starts_at: day(7) }),
      row({ event_id: "b", title: "Lego Club" }),
      row({ event_id: "a1", starts_at: day(0) }),
      row({ event_id: "a3", starts_at: day(14) }),
    ]);
    // Slot order follows the best-scored member (a2 first seen), but the
    // displayed row is the soonest occurrence.
    expect(slots.map((slot) => slot.row.event_id)).toEqual(["a1", "b"]);
    expect(slots[0]?.more.map((m) => m.event_id)).toEqual(["a2", "a3"]);
    expect(slots[1]?.more).toEqual([]);
  });

  it("returns pattern-less members as singles without inventing rows", () => {
    const input = [
      row({ event_id: "a1", starts_at: day(0) }),
      row({ event_id: "b", title: "Lego Club" }),
      row({ event_id: "a2", starts_at: day(3) }),
    ];
    const slots = groupSeries(input);
    expect(slots.map((slot) => slot.row.event_id)).toEqual(["a1", "a2", "b"]);
    expect(slots.every((slot) => slot.more.length === 0)).toBe(true);
    const outIds = slots.flatMap((slot) => [
      slot.row.event_id,
      ...slot.more.map((m) => m.event_id),
    ]);
    expect([...outIds].sort()).toEqual(["a1", "a2", "b"]);
  });

  it("keeps different venues and titles apart", () => {
    const slots = groupSeries([
      row({ event_id: "a1", starts_at: day(0) }),
      row({ event_id: "a2", starts_at: day(7), venue_name: "Other Branch" }),
      row({ event_id: "a3", starts_at: day(14) }),
    ]);
    // a1+a3 are 14 days apart as a pair: not weekly, no group.
    expect(slots.map((slot) => slot.row.event_id)).toEqual(["a1", "a3", "a2"]);
    expect(slots.every((slot) => slot.more.length === 0)).toBe(true);
  });

  it("handles empty input", () => {
    expect(groupSeries([])).toEqual([]);
  });
});
