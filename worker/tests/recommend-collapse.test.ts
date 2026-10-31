import { describe, expect, it } from "vitest";
import {
  collapseKey,
  collapseRows,
  findSiblings,
  type SiblingRow,
} from "../src/recommend/collapse";

const START = "2026-11-07T15:00:00.000Z";

function row(overrides: Partial<SiblingRow> = {}): SiblingRow {
  return {
    event_id: "e1",
    title: "Saturday Storytime",
    starts_at: START,
    venue_name: "North Gloucester at Room A",
    ...overrides,
  };
}

describe("collapseKey", () => {
  it("ignores title case, punctuation, and room differences", () => {
    const base = collapseKey(row());
    expect(collapseKey(row({ title: "saturday storytime!" }))).toBe(base);
    expect(
      collapseKey(row({ venue_name: "North Gloucester at Room B" })),
    ).toBe(base);
  });

  it("canonicalises the start instant", () => {
    expect(collapseKey(row({ starts_at: "2026-11-07T15:00:00Z" }))).toBe(
      collapseKey(row()),
    );
  });

  it("splits on time, branch, and title differences", () => {
    const base = collapseKey(row());
    expect(
      collapseKey(row({ starts_at: "2026-11-07T16:00:00.000Z" })),
    ).not.toBe(base);
    expect(
      collapseKey(row({ venue_name: "Greenboro at Room A" })),
    ).not.toBe(base);
    expect(collapseKey(row({ title: "Lego Club" }))).not.toBe(base);
    expect(collapseKey(row({ venue_name: null }))).not.toBe(base);
  });

  it("collapses venue-less rows together", () => {
    expect(collapseKey(row({ venue_name: null }))).toBe(
      collapseKey(row({ event_id: "e2", venue_name: null })),
    );
  });

  it("tolerates invalid timestamps without throwing", () => {
    expect(collapseKey(row({ starts_at: "not-a-date" }))).toContain(
      "not-a-date",
    );
  });
});

describe("collapseRows", () => {
  it("keeps the first row per key in input order", () => {
    const kept = collapseRows([
      row({ event_id: "keep" }),
      row({ event_id: "other", title: "Lego Club" }),
      row({ event_id: "drop", venue_name: "North Gloucester at Room B" }),
    ]);
    expect(kept.map((r) => r.event_id)).toEqual(["keep", "other"]);
  });

  it("leaves unique rows untouched", () => {
    const input = [
      row({ event_id: "a" }),
      row({ event_id: "b", title: "Lego Club" }),
    ];
    expect(collapseRows(input)).toEqual(input);
  });
});

describe("findSiblings", () => {
  it("returns twins minus self, with room names", () => {
    const siblings = findSiblings(
      row({ event_id: "self" }),
      [
        row({ event_id: "self" }),
        row({ event_id: "twin", venue_name: "North Gloucester at Room B" }),
        row({ event_id: "other-branch", venue_name: "Greenboro at Room A" }),
        row({ event_id: "other-time", starts_at: "2026-11-08T15:00:00.000Z" }),
      ],
    );
    expect(siblings).toEqual([
      {
        event_id: "twin",
        venue_name: "North Gloucester at Room B",
        room: "Room B",
      },
    ]);
  });

  it("falls back to the full venue name when there is no room part", () => {
    const siblings = findSiblings(
      row({ event_id: "self", venue_name: "Canadian War Museum" }),
      [row({ event_id: "twin", venue_name: "Canadian War Museum" })],
    );
    expect(siblings).toEqual([
      { event_id: "twin", venue_name: "Canadian War Museum", room: null },
    ]);
  });
});
