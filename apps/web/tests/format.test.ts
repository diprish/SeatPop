import { describe, expect, it } from "vitest";
import {
  ageLine,
  formatDistance,
  formatWhen,
  priceTone,
  splitReasonMarks,
} from "../src/lib/format";

describe("formatWhen", () => {
  it("renders event-local time with the weekday", () => {
    // 04:00Z Oct 31 = midnight EDT Saturday.
    expect(formatWhen("2026-10-31T04:00:00.000Z", "America/Toronto")).toBe(
      "Sat, Oct 31, 12:00 AM",
    );
    // 17:30Z Nov 1 = 12:30 EST Sunday (DST ended that morning).
    expect(formatWhen("2026-11-01T17:30:00.000Z", "America/Toronto")).toBe(
      "Sun, Nov 1, 12:30 PM",
    );
  });

  it("converts across timezones", () => {
    // Midnight Monday in Toronto is 9pm Sunday in Vancouver.
    expect(formatWhen("2026-11-02T05:00:00.000Z", "America/Toronto")).toBe(
      "Mon, Nov 2, 12:00 AM",
    );
    expect(formatWhen("2026-11-02T05:00:00.000Z", "America/Vancouver")).toBe(
      "Sun, Nov 1, 9:00 PM",
    );
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
