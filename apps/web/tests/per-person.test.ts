import { describe, expect, it } from "vitest";
import type { Preferences } from "@seatpop/shared";
import { groupPerPerson } from "../src/lib/per-person";
import { SAMPLE_HOUSEHOLD } from "../src/lib/household";

interface Row {
  event_id: string;
  age_min: number | null;
  age_max: number | null;
}

function row(
  event_id: string,
  age_min: number | null,
  age_max: number | null,
): Row {
  return { event_id, age_min, age_max };
}

const MEMBERS = SAMPLE_HOUSEHOLD.members;

function ids(rows: Row[]): string[] {
  return rows.map((row) => row.event_id);
}

describe("groupPerPerson", () => {
  it("fills Everyone together only with exact-or-adjacent for all", () => {
    // 0-130 hits every band exactly; 0-5 is preschool-exact but
    // adjacent-or-worse for the kid and the adult.
    const { together, columns } = groupPerPerson(
      [row("all", 0, 130), row("pre", 0, 5)],
      MEMBERS,
    );
    expect(ids(together)).toEqual(["all"]);
    expect(columns.map((column) => column.band)).toEqual([
      "adults",
      "kids",
      "preschool",
    ]);
  });

  it("shows together picks nowhere else", () => {
    const { together, columns } = groupPerPerson(
      [row("all", 0, 130), row("kid", 6, 12)],
      MEMBERS,
    );
    expect(ids(together)).toEqual(["all"]);
    for (const column of columns) {
      expect(ids(column.picks)).not.toContain("all");
    }
    expect(
      ids(columns.find((column) => column.band === "kids")?.picks ?? []),
    ).toEqual(["kid"]);
  });

  it("orders exact before adjacent and keeps served order otherwise", () => {
    const { columns } = groupPerPerson(
      [
        row("adj1", 0, 5), // preschool-exact, kids-adjacent
        row("ex1", 6, 12), // kids-exact
        row("adj2", 13, 17), // kids-adjacent (teens range touches)
        row("ex2", 5, 12), // kids-exact
      ],
      MEMBERS,
    );
    const kids = columns.find((column) => column.band === "kids");
    expect(ids(kids?.picks ?? [])).toEqual(["ex1", "ex2", "adj1", "adj2"]);
  });

  it("shows ageless picks in every column, never in together", () => {
    const { together, columns } = groupPerPerson(
      [row("mystery", null, null)],
      MEMBERS,
    );
    expect(together).toEqual([]);
    for (const column of columns) {
      expect(ids(column.picks)).toEqual(["mystery"]);
    }
  });

  it("leaves one column per band with empty picks allowed", () => {
    const doubled: Preferences["members"] = [
      ...MEMBERS,
      { age_band: "kids", include_adjacent: true },
    ];
    const { columns } = groupPerPerson([row("adult", 18, 64)], doubled);
    expect(columns.map((column) => column.band)).toEqual([
      "adults",
      "kids",
      "preschool",
    ]);
    expect(
      ids(columns.find((column) => column.band === "kids")?.picks ?? []),
    ).toEqual([]);
    expect(
      ids(columns.find((column) => column.band === "adults")?.picks ?? []),
    ).toEqual(["adult"]);
  });

  it("is empty with no members", () => {
    expect(groupPerPerson([row("x", 0, 130)], [])).toEqual({
      together: [],
      columns: [],
    });
  });
});
