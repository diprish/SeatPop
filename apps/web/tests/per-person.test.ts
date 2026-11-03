import { describe, expect, it } from "vitest";
import type { Preferences } from "@seatpop/shared";
import {
  columnReason,
  groupPerPerson,
  isCaregiverOnly,
  togetherReason,
} from "../src/lib/per-person";
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
  it("keeps adjacent-without-overlap out of Everyone together", () => {
    // Reported: storytime 0-5 sat in together for a
    // Preschool+Kids household with a preschool-only reason. 0-5
    // never overlaps the 6-12 band, so it cannot serve everyone.
    const members: Preferences["members"] = [
      { age_band: "preschool", include_adjacent: true },
      { age_band: "kids", include_adjacent: true },
    ];
    const { together, columns } = groupPerPerson([row("story", 0, 5)], members);
    expect(together).toEqual([]);
    expect(
      ids(columns.find((column) => column.band === "preschool")?.picks ?? []),
    ).toEqual(["story"]);
    expect(
      ids(columns.find((column) => column.band === "kids")?.picks ?? []),
    ).toEqual([]);
  });

  it("admits single-year overlap to Everyone together", () => {
    // 1-3 touches preschool only at age 3: not exact, but a
    // genuine overlap, so a Baby+Preschool household may share it.
    const members: Preferences["members"] = [
      { age_band: "baby", include_adjacent: true },
      { age_band: "preschool", include_adjacent: true },
    ];
    const { together } = groupPerPerson([row("toddler", 1, 3)], members);
    expect(ids(together)).toEqual(["toddler"]);
  });

  it("keeps all-ages and spanning ranges in Everyone together", () => {
    const members: Preferences["members"] = [
      { age_band: "preschool", include_adjacent: true },
      { age_band: "kids", include_adjacent: true },
    ];
    const { together } = groupPerPerson(
      [row("all", 0, 130), row("span", 3, 12)],
      members,
    );
    expect(ids(together)).toEqual(["all", "span"]);
  });

  it("keeps caregiver-only picks out of together without an adult", () => {
    // Reported: "Parenting in Ottawa" sat in together for a
    // Preschool+Kids household. Caregiver-only picks need a
    // grown-up member; otherwise they show nowhere.
    const kidsOnly: Preferences["members"] = [
      { age_band: "preschool", include_adjacent: true },
      { age_band: "kids", include_adjacent: true },
    ];
    const parenting = {
      ...row("parenting", null, null),
      title: "Parenting in Ottawa",
    };
    const alone = groupPerPerson([parenting], kidsOnly);
    expect(alone.together).toEqual([]);
    for (const column of alone.columns) {
      expect(ids(column.picks)).toEqual([]);
    }
    const withAdult = groupPerPerson(
      [parenting],
      [...kidsOnly, { age_band: "adults", include_adjacent: true }],
    );
    expect(ids(withAdult.together)).toEqual(["parenting"]);
  });

  it("keeps the check-age flag on ageless together picks", () => {
    const { together } = groupPerPerson(
      [{ ...row("mystery", null, null), age_flag: "check the age group" }],
      MEMBERS,
    );
    expect(ids(together)).toEqual(["mystery"]);
    expect(together[0]?.age_flag).toBe("check the age group");
  });

  it("fills Everyone together only with overlap for all", () => {
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
        row("ex1", 6, 12), // kids-exact
        row("adj2", 13, 17), // kids-adjacent (teens range touches)
        row("ex2", 5, 12), // kids-exact
      ],
      MEMBERS,
    );
    const kids = columns.find((column) => column.band === "kids");
    expect(ids(kids?.picks ?? [])).toEqual(["ex1", "ex2", "adj2"]);
  });

  it("keeps an adjacent pick out of a column when exact for another member", () => {
    // Reported: Storytime 0-5 (reason "Good for your 3-5
    // preschooler") led the Kids 6-12 column. A pick exact for one
    // member belongs to that member's column only.
    const { columns } = groupPerPerson([row("story", 0, 5)], MEMBERS);
    expect(
      ids(columns.find((column) => column.band === "kids")?.picks ?? []),
    ).toEqual([]);
    expect(
      ids(
        columns.find((column) => column.band === "preschool")?.picks ?? [],
      ),
    ).toEqual(["story"]);
    expect(
      ids(columns.find((column) => column.band === "adults")?.picks ?? []),
    ).toEqual([]);
  });

  it("keeps adjacent picks exact nowhere in every fitting column", () => {
    // 5-6 touches preschool and kids without an exact fit
    // anywhere, so both columns may show it.
    const { together, columns } = groupPerPerson([row("bridge", 5, 6)], MEMBERS);
    expect(together).toEqual([]);
    expect(
      ids(columns.find((column) => column.band === "kids")?.picks ?? []),
    ).toEqual(["bridge"]);
    expect(
      ids(
        columns.find((column) => column.band === "preschool")?.picks ?? [],
      ),
    ).toEqual(["bridge"]);
  });

  it("shows ageless picks in together, never in a member column", () => {
    // Reported: Family Storytime sat in all three member columns
    // while together claimed no fit. Null ages fit no band
    // verifiably and every band possibly, so together (flagged
    // "check the age group") is their only home.
    const { together, columns } = groupPerPerson(
      [row("mystery", null, null)],
      MEMBERS,
    );
    expect(ids(together)).toEqual(["mystery"]);
    for (const column of columns) {
      expect(ids(column.picks)).toEqual([]);
    }
  });

  it("skips together with a single band and shelves all in the column", () => {
    const solo: Preferences["members"] = [
      { age_band: "kids", include_adjacent: true },
    ];
    const { together, columns } = groupPerPerson(
      [
        row("mystery", null, null),
        row("adj", 0, 5),
        row("ex", 6, 12),
      ],
      solo,
    );
    expect(together).toEqual([]);
    expect(columns.map((column) => column.band)).toEqual(["kids"]);
    expect(ids(columns[0]?.picks ?? [])).toEqual(["ex", "adj", "mystery"]);
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

  it("ranks broader age coverage first within the exact tier", () => {
    // Served oldest-first; the Adults column must still lead with
    // the 18+ event ahead of the 50+ one.
    const { columns } = groupPerPerson(
      [row("fifty", 50, null), row("eighteen", 18, null)],
      MEMBERS,
    );
    expect(
      ids(columns.find((column) => column.band === "adults")?.picks ?? []),
    ).toEqual(["eighteen", "fifty"]);
  });

  it("ranks broader coverage first for other bands too", () => {
    const { columns } = groupPerPerson(
      [row("narrow", 10, 12), row("mid", 8, 12), row("full", 6, 12)],
      MEMBERS,
    );
    expect(
      ids(columns.find((column) => column.band === "kids")?.picks ?? []),
    ).toEqual(["full", "mid", "narrow"]);
  });

  it("still shows a partial-coverage pick when it is the only option", () => {
    const { columns } = groupPerPerson([row("fifty", 50, null)], MEMBERS);
    expect(
      ids(columns.find((column) => column.band === "adults")?.picks ?? []),
    ).toEqual(["fifty"]);
  });

  it("keeps exact before adjacent regardless of coverage", () => {
    const { columns } = groupPerPerson(
      [row("adj", 13, 17), row("exact", 10, 12)],
      MEMBERS,
    );
    expect(
      ids(columns.find((column) => column.band === "kids")?.picks ?? []),
    ).toEqual(["exact", "adj"]);
  });
});

describe("columnReason", () => {
  it("names the stated range for a partial-coverage exact pick", () => {
    expect(
      columnReason("Good for your 18-64 adult (inferred)", row("e", 50, null), "adults"),
    ).toBe("Open to adults 50+ (inferred)");
    expect(
      columnReason(
        "good for your 18-64 adult (inferred), free entry (stated)",
        row("e", 50, null),
        "adults",
      ),
    ).toBe("open to adults 50+ (inferred), free entry (stated)");
  });

  it("tolerates an en-dash band label and states kids ranges", () => {
    expect(
      columnReason("Good for your 18–64 adult", row("e", 50, null), "adults"),
    ).toBe("Open to adults 50+");
    expect(
      columnReason("Good for your 6-12 kid (inferred)", row("e", 10, 12), "kids"),
    ).toBe("Open to kids 10–12 (inferred)");
  });

  it("leaves full-coverage and multi-band clauses alone", () => {
    const full = "Good for your 18-64 adult (inferred)";
    expect(columnReason(full, row("e", 18, null), "adults")).toBe(full);
    const multi = "good for your 18-64 adult and 6-12 kid (inferred)";
    expect(columnReason(multi, row("e", 6, 30), "adults")).toBe(multi);
    const plain = "Free drop-in, close to home (stated)";
    expect(columnReason(plain, row("e", 50, null), "adults")).toBe(plain);
  });
});

describe("isCaregiverOnly", () => {
  it("matches caregiver-audience titles, any case", () => {
    for (const title of [
      "Parenting in Ottawa",
      "New parent meetup",
      "Parents' night out",
      "Caregiver coffee morning",
      "Prenatal yoga",
      "Infant feeding support",
      "Infant-feeding clinic",
      "Grandparents Day tea",
    ]) {
      expect(isCaregiverOnly(title)).toBe(true);
    }
  });

  it("leaves ordinary and lookalike titles alone", () => {
    for (const title of [
      "Family storytime",
      "The Apparent Heir",
      "Saturday swim",
      "",
    ]) {
      expect(isCaregiverOnly(title)).toBe(false);
    }
    expect(isCaregiverOnly(undefined)).toBe(false);
  });

  it("counts a senior member as a grown-up for together", () => {
    const members: Preferences["members"] = [
      { age_band: "kids", include_adjacent: true },
      { age_band: "seniors", include_adjacent: true },
    ];
    const { together } = groupPerPerson(
      [{ ...row("parenting", null, null), title: "Parenting in Ottawa" }],
      members,
    );
    expect(ids(together)).toEqual(["parenting"]);
  });
});

describe("togetherReason", () => {
  it("expands a single-band clause to every served band", () => {
    expect(
      togetherReason(
        "Good for your 3-5 preschooler (inferred)",
        row("e", 3, 12),
        ["preschool", "kids"],
      ),
    ).toBe("Good for your 3-5 preschooler and 6-12 kid (inferred)");
  });

  it("leaves complete, neutral, and ageless reasons alone", () => {
    const complete = "good for your 3-5 preschooler and 6-12 kid (inferred)";
    expect(togetherReason(complete, row("e", 3, 12), ["preschool", "kids"])).toBe(
      complete,
    );
    const plain = "Free drop-in, close to home (stated)";
    expect(togetherReason(plain, row("e", 3, 12), ["preschool", "kids"])).toBe(
      plain,
    );
    const ageless = "Good for your 3-5 preschooler (inferred)";
    expect(
      togetherReason(ageless, row("e", null, null), ["preschool", "kids"]),
    ).toBe(ageless);
  });

  it("drops a wrong-band mention while naming the served bands", () => {
    expect(
      togetherReason(
        "Good for your 18-64 adult (inferred)",
        row("e", 3, 12),
        ["preschool", "kids"],
      ),
    ).toBe("Good for your 3-5 preschooler and 6-12 kid (inferred)");
  });

  it("strips close-to-age claims, keeping the neutral facts", () => {
    expect(
      togetherReason(
        "Storytime on 2026-11-07, Free (stated), close to your baby's and preschooler's ages (inferred)",
        row("e", 1, 3),
        ["baby", "preschool"],
      ),
    ).toBe("Storytime on 2026-11-07, Free (stated)");
    expect(
      togetherReason(
        "Family storytime with stay-and-play (stated), close to preschool age (inferred)",
        row("e", 0, 5),
        ["baby", "preschool"],
      ),
    ).toBe("Family storytime with stay-and-play (stated)");
  });

  it("strips close-to-age even for ageless picks, keeps proximity", () => {
    expect(
      togetherReason(
        "Free play (stated), close to preschool age (inferred)",
        row("e", null, null),
        ["preschool", "kids"],
      ),
    ).toBe("Free play (stated)");
    const near = "Two blocks away, close to the library (stated)";
    expect(togetherReason(near, row("e", 0, 5), ["baby", "preschool"])).toBe(
      near,
    );
  });

  it("strips close-to and expands naming in one pass", () => {
    expect(
      togetherReason(
        "Good for your 3-5 preschooler (inferred), close to kids age",
        row("e", 3, 12),
        ["preschool", "kids"],
      ),
    ).toBe("Good for your 3-5 preschooler and 6-12 kid (inferred)");
  });
});
