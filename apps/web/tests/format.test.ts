import { describe, expect, it } from "vitest";
import {
  ageLine,
  formatDistance,
  formatWhenRange,
  priceTone,
  splitReasonMarks,
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

describe("ageLine", () => {
  it("renders ranges, floors, ceilings, and unknowns", () => {
    expect(ageLine({ age_min: 6, age_max: 12 })).toBe("Ages 6–12");
    expect(ageLine({ age_min: 5, age_max: 5 })).toBe("Age 5");
    expect(ageLine({ age_min: 13, age_max: null })).toBe("Ages 13+");
    expect(ageLine({ age_min: null, age_max: 2 })).toBe("Ages up to 2");
    expect(ageLine({ age_min: null, age_max: null })).toBeNull();
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

describe("splitReasonMarks", () => {
  it("splits literal (stated)/(inferred) marks for styling", () => {
    expect(splitReasonMarks("Free crafts (stated), kids love it (inferred)")).toEqual([
      { text: "Free crafts ", mark: null },
      { text: "(stated)", mark: "stated" },
      { text: ", kids love it ", mark: null },
      { text: "(inferred)", mark: "inferred" },
    ]);
  });

  it("passes unmarked reasons through untouched", () => {
    expect(splitReasonMarks("Just a reason")).toEqual([
      { text: "Just a reason", mark: null },
    ]);
    expect(splitReasonMarks("")).toEqual([]);
  });
});
