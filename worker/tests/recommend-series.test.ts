import { describe, expect, it } from "vitest";
import {
  groupSeries,
  hasSeriesPattern,
  limitConsecutiveRuns,
  seriesKey,
  titleFamily,
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

describe("titleFamily", () => {
  it("merges suffix and infix variants into one family", () => {
    expect(titleFamily("Babytime")).toBe(
      titleFamily("Babytime & Stay and Play | Bébés à la biblio"),
    );
    // Live shape: same program, no separator to strip.
    expect(titleFamily("Babytime")).toBe(
      titleFamily("Babytime followed by a Play and Stay"),
    );
    expect(titleFamily("Babytime - Fall Session 2 (10:15 am)")).toBe(
      "babytime",
    );
    expect(titleFamily("Morning Social / Matinée conviviale")).toBe("morning");
    expect(titleFamily("Storytime (Ages 3-5)")).toBe("storytime");
  });

  it("groups by lead word, apart otherwise", () => {
    // Same lead word: one family on purpose (a varied top 10 spreads
    // Lego Club and Lego Robotics apart rather than stacking them).
    expect(titleFamily("Lego Club")).toBe(titleFamily("Lego Robotics"));
    expect(titleFamily("Babytime")).not.toBe(titleFamily("Toddler Mornings"));
    expect(titleFamily("Babytime")).not.toBe(
      titleFamily("Bilingual Babytime + Stay & Play"),
    );
  });
});

describe("limitConsecutiveRuns", () => {
  const byTitle = (title: string): string => titleFamily(title);

  function runsOf(titles: string[]): number[] {
    const runs: number[] = [];
    let run = 0;
    let prev = "";
    for (const title of titles) {
      const key = byTitle(title);
      if (key === prev) run++;
      else {
        if (run > 0) runs.push(run);
        run = 1;
        prev = key;
      }
    }
    if (run > 0) runs.push(run);
    return runs;
  }

  it("breaks runs of three without dropping or reordering needlessly", () => {
    const input = [
      "Babytime",
      "Babytime & Stay and Play",
      "Babytime | Bébés",
      "Babytime followed by a Play and Stay",
      "Lego Club",
      "Chess Night",
    ];
    const out = limitConsecutiveRuns(input, byTitle);
    expect([...out].sort()).toEqual([...input].sort());
    expect(Math.max(...runsOf(out))).toBeLessThanOrEqual(2);
    // The first two keep their lead; only the overruns move.
    expect(out.slice(0, 2)).toEqual([
      "Babytime",
      "Babytime & Stay and Play",
    ]);
  });

  it("is idempotent on an already-diverse list", () => {
    const input = ["Babytime", "Lego Club", "Babytime & Play", "Chess Night"];
    expect(limitConsecutiveRuns(input, byTitle)).toEqual(input);
  });

  it("degrades gracefully when one family owns the list", () => {
    const input = ["Babytime", "Babytime & Play", "Babytime | Bébés"];
    expect(limitConsecutiveRuns(input, byTitle)).toEqual(input);
  });
});
