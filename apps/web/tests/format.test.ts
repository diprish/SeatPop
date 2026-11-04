import { describe, expect, it } from "vitest";
import {
  ageLine,
  formatDate,
  formatDistance,
  formatReasonDates,
  formatReasonMarks,
  formatRegistrationBadge,
  formatWhenRange,
  formatWindowOpens,
  isPolicyPrice,
  priceBadgeClass,
  priceBadgeLabel,
  priceTone,
  truncateQuote,
} from "../src/lib/format";

describe("formatWhenRange", () => {
  it("renders a same-day range in event-local time", () => {
    // 14:00–15:00Z Oct 31 = 10:00–11:00 AM EDT Saturday.
    expect(
      formatWhenRange(
        "2026-10-31T14:00:00.000Z",
        "2026-10-31T15:00:00.000Z",
        "America/Toronto",
      ),
    ).toBe("Sat Oct 31 · 10:00 AM–11:00 AM");
  });

  it("renders a start-only time without a range", () => {
    expect(
      formatWhenRange("2026-10-31T14:00:00.000Z", null, "America/Toronto"),
    ).toBe("Sat Oct 31 · 10:00 AM");
  });

  it("uses the local date when UTC crosses the date boundary", () => {
    // 02:00Z Nov 1 is still Oct 31 in Toronto (EDT).
    expect(
      formatWhenRange("2026-11-01T02:00:00.000Z", null, "America/Toronto"),
    ).toBe("Sat Oct 31 · 10:00 PM");
  });

  it("names both ends of a multi-day event", () => {
    // Ends 18:00Z Nov 1 = 1:00 PM EST Sunday (DST ended that morning).
    expect(
      formatWhenRange(
        "2026-10-31T14:00:00.000Z",
        "2026-11-01T18:00:00.000Z",
        "America/Toronto",
      ),
    ).toBe("Sat Oct 31 · 10:00 AM – Sun Nov 1 · 1:00 PM");
  });
});

describe("priceTone", () => {
  it("separates free, unknown, and paid", () => {
    expect(priceTone("free")).toBe("free");
    expect(priceTone("unknown")).toBe("muted");
    expect(priceTone("paid")).toBe("paid");
    expect(priceTone("donation")).toBe("paid");
  });
});

describe("formatWindowOpens", () => {
  it("renders Toronto date and time, or the date alone", () => {
    // Mar 4 2026 is a Wednesday; 19:00 EST stays the same day.
    expect(formatWindowOpens("2026-03-04T19:00:00-05:00", false)).toBe(
      "Wed Mar 4 · 7:00 PM",
    );
    expect(formatWindowOpens("2026-03-04T00:00:00-05:00", true)).toBe(
      "Wed Mar 4",
    );
  });

  it("uses the Toronto date across the DST boundary", () => {
    // Nov 1 2026 00:30 EDT is still Nov 1 in Toronto (EST switch at 2am).
    expect(formatWindowOpens("2026-11-01T00:30:00-04:00", false)).toBe(
      "Sun Nov 1 · 12:30 AM",
    );
  });

  it("returns null for invalid instants instead of inventing a date", () => {
    expect(formatWindowOpens("not a date", false)).toBeNull();
    expect(formatWindowOpens("not a date", true)).toBeNull();
  });
});

describe("formatRegistrationBadge", () => {
  it("renders the badge in Toronto time", () => {
    expect(
      formatRegistrationBadge("2026-11-17T21:00:00-05:00", false),
    ).toBe("Registration opens Nov 17, 9:00 PM");
  });

  it("renders date-only badges without inventing a time", () => {
    expect(formatRegistrationBadge("2026-11-03T00:00:00-05:00", true)).toBe(
      "Registration opens Nov 3",
    );
  });

  it("uses the Toronto date across midnight UTC", () => {
    // Nov 18 02:00Z is still Nov 17 in Toronto.
    expect(formatRegistrationBadge("2026-11-18T02:00:00.000Z", false)).toBe(
      "Registration opens Nov 17, 9:00 PM",
    );
  });

  it("returns null for invalid instants instead of inventing a date", () => {
    expect(formatRegistrationBadge("not a date", false)).toBeNull();
    expect(formatRegistrationBadge("not a date", true)).toBeNull();
  });
});

describe("truncateQuote", () => {
  it("passes short quotes through and trims long ones", () => {
    expect(truncateQuote("Registration opens March 4.")).toBe(
      "Registration opens March 4.",
    );
    expect(truncateQuote("  spaced   out  ")).toBe("spaced out");
    const long = `Reg${"istration".repeat(20)}.`;
    const truncated = truncateQuote(long, 120);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(121);
  });
});

describe("priceBadgeLabel", () => {
  it("renames source-policy free, passes the rest through", () => {
    expect(isPolicyPrice("free (per OPL)")).toBe(true);
    expect(isPolicyPrice("Free")).toBe(false);
    expect(isPolicyPrice("free (per OPL) tomorrow")).toBe(false);
    expect(priceBadgeLabel("free (per OPL)")).toBe("Free · per OPL policy");
    expect(priceBadgeLabel("Free")).toBe("Free");
    expect(priceBadgeLabel("$12.00")).toBe("$12.00");
    expect(priceBadgeLabel("Price not stated")).toBe("Price not listed");
    expect(priceBadgeLabel("price not stated")).toBe("Price not listed");
  });
});

describe("ageLine", () => {
  it("renders ranges, floors, ceilings, and unknowns", () => {
    expect(ageLine({ age_min: 6, age_max: 12 })).toBe("Ages 6–12");
    expect(ageLine({ age_min: 5, age_max: 5 })).toBe("Age 5");
    expect(ageLine({ age_min: 13, age_max: null })).toBe("Ages 13+");
    expect(ageLine({ age_min: null, age_max: 2 })).toBe("Ages up to 2");
    expect(ageLine({ age_min: null, age_max: null })).toBeNull();
  });

  it("labels months magnitudes as months when the text says months", () => {
    expect(
      ageLine({
        age_min: 19,
        age_max: 35,
        description: "Play for ages 19-35 months.",
      }),
    ).toBe("Ages 19–35 months");
    expect(
      ageLine({
        age_min: 19,
        age_max: 36,
        description: "Play for ages 19-36 months.",
      }),
    ).toBe("Ages 19–36 months");
    expect(
      ageLine({
        age_min: 0,
        age_max: 18,
        description: "Songs for babies 0-18 months.",
      }),
    ).toBe("Ages 0–18 months");
    expect(
      ageLine({
        age_min: 6,
        age_max: null,
        description: "6 months and up.",
      }),
    ).toBe("Ages 6+ months");
    expect(
      ageLine({
        age_min: 0,
        age_max: 18,
        description: "Bébés de 0 à 18 mois.",
      }),
    ).toBe("Ages 0–18 months");
    // Glued continuation from a tag strip (live Tuesday Babytime text).
    expect(
      ageLine({
        age_min: 0,
        age_max: 18,
        description: "0-18 monthsPlease note: October 27 – no program",
      }),
    ).toBe("Ages 0–18 months");
  });

  it("keeps converted years and plain years unmarked", () => {
    // Repaired rows say months in the text but store years (< 5).
    expect(
      ageLine({
        age_min: 0,
        age_max: 2,
        description: "Songs for babies 0-18 months.",
      }),
    ).toBe("Ages 0–2");
    expect(
      ageLine({ age_min: 6, age_max: 12, description: "Ages 6-12." }),
    ).toBe("Ages 6–12");
    // "monthly" is a frequency, not a months age.
    expect(
      ageLine({ age_min: 6, age_max: 12, description: "Meets monthly." }),
    ).toBe("Ages 6–12");
    // Without listing text there is nothing to second-guess.
    expect(ageLine({ age_min: 19, age_max: 35 })).toBe("Ages 19–35");
  });
});

describe("formatDistance", () => {
  it("uses metres under a kilometre and rejects bad input", () => {
    expect(formatDistance(2.34)).toBe("2.3 km");
    expect(formatDistance(0.4)).toBe("400 m");
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(-1)).toBeNull();
    expect(formatDistance(Number.NaN)).toBeNull();
  });
});

describe("formatReasonMarks", () => {
  it("rewrites literal (stated)/(inferred) marks as plain words", () => {
    expect(
      formatReasonMarks("Free crafts (stated), kids love it (inferred)"),
    ).toBe("Free crafts (per the listing), kids love it (our guess)");
  });

  it("passes unmarked reasons through untouched", () => {
    expect(formatReasonMarks("Just a reason")).toBe("Just a reason");
    expect(formatReasonMarks("")).toBe("");
  });

  it("reads the raw unstated-price label as not listed", () => {
    expect(formatReasonMarks("Storytime, Price not stated (stated)")).toBe(
      "Storytime, Price not listed (per the listing)",
    );
  });
});

describe("formatDate", () => {
  it("renders a short event-local date", () => {
    // 04:00Z Nov 1 = Nov 1 in Toronto (EDT→EST overnight, still Nov 1).
    expect(formatDate("2026-11-01T04:00:00.000Z", "America/Toronto")).toBe(
      "Nov 1, 2026",
    );
  });
});

describe("formatReasonDates", () => {
  it("renders embedded UTC instants event-local", () => {
    expect(
      formatReasonDates(
        "price Free (stated), starts 2026-10-31T14:00 (stated)",
        "America/Toronto",
      ),
    ).toBe("price Free (stated), starts Sat Oct 31, 10:00 AM (stated)");
  });

  it("passes through non-instants and invalid dates", () => {
    expect(formatReasonDates("just words", "America/Toronto")).toBe("just words");
    expect(
      formatReasonDates("at 2026-13-45T99:99", "America/Toronto"),
    ).toBe("at 2026-13-45T99:99");
  });
});

describe("priceBadgeClass", () => {
  it("returns one class string per tone", () => {
    for (const tone of ["free", "muted", "paid"] as const) {
      expect(priceBadgeClass(tone).length).toBeGreaterThan(0);
    }
    expect(priceBadgeClass("free")).toContain("green");
    expect(priceBadgeClass("paid")).toContain("amber");
  });

  it("renders the muted tone through the design tokens", () => {
    const muted = priceBadgeClass("muted");
    expect(muted).toContain("bg-background");
    expect(muted).toContain("text-muted");
    expect(muted).not.toContain("neutral-");
    expect(muted).not.toContain("dark:");
  });
});
