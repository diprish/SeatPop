import { describe, expect, it } from "vitest";
import type { Preferences } from "@seatpop/shared";
import {
  buildSentence,
  sentenceText,
  type SentenceSegment,
} from "../src/lib/sentence";
import { SAMPLE_HOUSEHOLD } from "../src/lib/household";

function prefs(overrides: Partial<Preferences>): Preferences {
  return {
    ...SAMPLE_HOUSEHOLD,
    members: [],
    fsa: undefined,
    max_distance_km: undefined,
    max_price_cents: undefined,
    free_only: false,
    availability: undefined,
    ...overrides,
  } as Preferences;
}

function member(band: "baby" | "preschool" | "kids" | "teens" | "adults" | "seniors") {
  return { age_band: band, include_adjacent: true } as const;
}

function pillsOf(segments: SentenceSegment[]): SentenceSegment[] {
  return segments.filter((segment) => segment.kind === "pill");
}

describe("sentenceText", () => {
  it("states the sample household verbatim", () => {
    expect(sentenceText(SAMPLE_HOUSEHOLD)).toBe(
      "We're an adult, a 6–12 kid and a preschooler, within 20 km of K2S.",
    );
  });

  it("matches the 2c example with every filter set", () => {
    expect(
      sentenceText(
        prefs({
          members: [member("adults"), member("kids"), member("preschool")],
          availability: { sat: ["morning"] },
          max_price_cents: 2500,
          max_distance_km: 5,
          fsa: "K2S",
        }),
      ),
    ).toBe(
      "We're an adult, a 6–12 kid and a preschooler, free on Saturday mornings, spending under $25, within 5 km of K2S.",
    );
  });

  it("joins 1, 2, and 6 members without an Oxford comma", () => {
    expect(sentenceText(prefs({ members: [member("adults")] }))).toBe(
      "We're an adult.",
    );
    expect(
      sentenceText(prefs({ members: [member("adults"), member("teens")] })),
    ).toBe("We're an adult and a teen.");
    expect(
      sentenceText(
        prefs({
          members: [
            member("baby"),
            member("preschool"),
            member("kids"),
            member("teens"),
            member("adults"),
            member("seniors"),
          ],
        }),
      ),
    ).toBe(
      "We're a baby, a preschooler, a 6–12 kid, a teen, an adult and a senior.",
    );
  });

  it("uses an before adult and ranges only for kids", () => {
    const segments = buildSentence(
      prefs({ members: [member("kids"), member("adults")] }),
    );
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "We're a 6–12 kid and an adult.",
    );
  });

  it("omits every unset filter clause", () => {
    expect(
      sentenceText(prefs({ members: [member("kids")] })),
    ).toBe("We're a 6–12 kid.");
  });

  it("falls back to plain text with no members and no filters", () => {
    expect(sentenceText(prefs({}))).toBe(
      "Tell us who's coming to get picks.",
    );
  });

  it("keeps clauses without members", () => {
    expect(
      sentenceText(
        prefs({ availability: { sat: ["morning"] }, fsa: "K2S" }),
      ),
    ).toBe("We're free on Saturday mornings, near K2S.");
  });
});

describe("availability phrases", () => {
  it("names weekend, weekday, and daily spans", () => {
    expect(
      sentenceText(
        prefs({
          members: [member("kids")],
          availability: { sat: ["evening"], sun: ["evening"] },
        }),
      ),
    ).toBe("We're a 6–12 kid, free on weekend evenings.");
    expect(
      sentenceText(
        prefs({
          members: [member("kids")],
          availability: {
            mon: ["morning"],
            tue: ["morning"],
            wed: ["morning"],
            thu: ["morning"],
            fri: ["morning"],
          },
        }),
      ),
    ).toBe("We're a 6–12 kid, free on weekday mornings.");
  });

  it("splits parts into hue pills joined by and", () => {
    const segments = buildSentence(
      prefs({
        members: [member("kids")],
        availability: { sat: ["morning", "evening"] },
      }),
    );
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "We're a 6–12 kid, free on Saturday mornings and Saturday evenings.",
    );
    const pills = pillsOf(segments).filter(
      (pill) => pill.kind === "pill" && pill.target === "availability",
    );
    expect(pills.map((pill) => pill.kind === "pill" && pill.hue)).toEqual([
      "lemon",
      "lavender",
    ]);
  });

  it("splits differing days with semicolons", () => {
    expect(
      sentenceText(
        prefs({
          members: [member("kids")],
          availability: { sat: ["morning"], sun: ["evening"] },
        }),
      ),
    ).toBe(
      "We're a 6–12 kid, free on Saturday mornings; Sunday evenings.",
    );
  });

  it("treats full-week full-day coverage as unset", () => {
    expect(
      sentenceText(
        prefs({
          members: [member("kids")],
          availability: {
            mon: ["morning", "afternoon", "evening", "night"],
            tue: ["morning", "afternoon", "evening", "night"],
            wed: ["morning", "afternoon", "evening", "night"],
            thu: ["morning", "afternoon", "evening", "night"],
            fri: ["morning", "afternoon", "evening", "night"],
            sat: ["morning", "afternoon", "evening", "night"],
            sun: ["morning", "afternoon", "evening", "night"],
          },
        }),
      ),
    ).toBe("We're a 6–12 kid.");
  });
});

describe("budget and distance phrases", () => {
  it("states free-only as spending nothing", () => {
    expect(
      sentenceText(prefs({ members: [member("kids")], free_only: true })),
    ).toBe("We're a 6–12 kid, spending nothing.");
  });

  it("states budget caps under dollars", () => {
    expect(
      sentenceText(
        prefs({ members: [member("kids")], max_price_cents: 2500 }),
      ),
    ).toBe("We're a 6–12 kid, spending under $25.");
  });

  it("states area with and without a distance cap", () => {
    expect(
      sentenceText(prefs({ members: [member("kids")], fsa: "K2S" })),
    ).toBe("We're a 6–12 kid, near K2S.");
    expect(
      sentenceText(
        prefs({ members: [member("kids")], max_distance_km: 5 }),
      ),
    ).toBe("We're a 6–12 kid, within 5 km.");
    expect(
      sentenceText(
        prefs({
          members: [member("kids")],
          fsa: "K2S",
          max_distance_km: 5,
        }),
      ),
    ).toBe("We're a 6–12 kid, within 5 km of K2S.");
  });

  it("paints budget mint and distance sky", () => {
    const segments = buildSentence(
      prefs({
        members: [member("kids")],
        max_price_cents: 2500,
        fsa: "K2S",
        max_distance_km: 5,
      }),
    );
    const pills = pillsOf(segments).filter((pill) => pill.kind === "pill");
    expect(
      pills.map(
        (pill) => pill.kind === "pill" && `${pill.target}:${pill.hue}`,
      ),
    ).toEqual(["members:lemon", "budget:mint", "distance:sky"]);
  });
});
