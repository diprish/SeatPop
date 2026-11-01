import { describe, expect, it } from "vitest";
import {
  findMonthsRanges,
  monthsToYears,
  planMonthsRepair,
  type MonthsRepairRow,
} from "../src/repair-months/plan";
import { OWNER_MODEL } from "../src/seed-owner-events/seed";

function row(overrides: Partial<MonthsRepairRow> = {}): MonthsRepairRow {
  return {
    eventId: "e1",
    title: "Toddlertime",
    description: "Songs and play for ages 19-35 months. Drop-in.",
    ageMin: 19,
    ageMax: 35,
    model: "muse-spark-1.3",
    ...overrides,
  };
}

describe("findMonthsRanges", () => {
  it("matches dash, to, and French ranges", () => {
    expect(findMonthsRanges("ages 19-35 months")).toMatchObject([
      { minMonths: 19, maxMonths: 35, quote: "19-35 months" },
    ]);
    expect(findMonthsRanges("0–18 months")).toMatchObject([
      { minMonths: 0, maxMonths: 18 },
    ]);
    expect(findMonthsRanges("6 to 24 months")).toMatchObject([
      { minMonths: 6, maxMonths: 24 },
    ]);
    expect(findMonthsRanges("0 à 18 mois")).toMatchObject([
      { minMonths: 0, maxMonths: 18, quote: "0 à 18 mois" },
    ]);
    expect(findMonthsRanges("babies 0 -18 months")).toMatchObject([
      { minMonths: 0, maxMonths: 18 },
    ]);
  });

  it("ignores singles, frequencies, and year ranges", () => {
    expect(findMonthsRanges("6 months and up")).toEqual([]);
    expect(findMonthsRanges("every month")).toEqual([]);
    expect(findMonthsRanges("meets monthly")).toEqual([]);
    expect(findMonthsRanges("ages 0-12 monthly")).toEqual([]);
    expect(findMonthsRanges("first Wednesday of every month")).toEqual([]);
    expect(findMonthsRanges("ages 3 to 5")).toEqual([]);
    expect(findMonthsRanges("ages 0-12. Drop-in.")).toEqual([]);
    expect(findMonthsRanges("35-19 months")).toEqual([]);
  });

  it("tolerates glued uppercase continuations from tag strips", () => {
    // Live Tuesday Babytime text: the space after "months" was eaten.
    expect(
      findMonthsRanges("0-18 monthsPlease note: October 27 – no program"),
    ).toMatchObject([{ minMonths: 0, maxMonths: 18, quote: "0-18 months" }]);
    expect(findMonthsRanges("Ages 0-18 Months.")).toMatchObject([
      { minMonths: 0, maxMonths: 18 },
    ]);
  });
});

describe("monthsToYears", () => {
  it("floors the min and ceils the max", () => {
    expect(monthsToYears(19, 35)).toEqual({ min: 1, max: 3 });
    expect(monthsToYears(0, 18)).toEqual({ min: 0, max: 2 });
    expect(monthsToYears(6, 24)).toEqual({ min: 0, max: 2 });
    expect(monthsToYears(0, 5)).toEqual({ min: 0, max: 1 });
  });
});

describe("planMonthsRepair", () => {
  it("converts months magnitudes to years with the verbatim quote", () => {
    const plans = planMonthsRepair([row()]);
    expect(plans).toEqual([
      {
        eventId: "e1",
        title: "Toddlertime",
        quote: "19-35 months",
        beforeMin: 19,
        beforeMax: 35,
        afterMin: 1,
        afterMax: 3,
      },
    ]);
  });

  it("fills null sides and converts mixed rows per side", () => {
    const plans = planMonthsRepair([
      row({
        eventId: "nulls",
        description: "Play for 0-18 months.",
        ageMin: null,
        ageMax: null,
      }),
      row({
        eventId: "mixed",
        description: "Play for 0-18 months.",
        ageMin: 0,
        ageMax: 18,
      }),
    ]);
    expect(plans).toMatchObject([
      { eventId: "nulls", afterMin: 0, afterMax: 2 },
      { eventId: "mixed", beforeMin: 0, beforeMax: 18, afterMin: 0, afterMax: 2 },
    ]);
  });

  it("leaves v4-correct and years-scale rows alone", () => {
    const plans = planMonthsRepair([
      row({
        eventId: "v4",
        description: "Play for 0-18 months.",
        ageMin: 0,
        ageMax: 1,
      }),
      row({
        eventId: "years",
        description: "Play for 0-18 months.",
        ageMin: 0,
        ageMax: 2,
      }),
    ]);
    expect(plans).toEqual([]);
  });

  it("accepts bilingual repeats of one range, skips distinct ones", () => {
    const bilingual = planMonthsRepair([
      row({
        description: "babies 0 -18 months. Bébés de 0 à 18 mois.",
        ageMin: 0,
        ageMax: 18,
      }),
    ]);
    expect(bilingual).toHaveLength(1);
    expect(bilingual[0]?.afterMax).toBe(2);

    const ambiguous = planMonthsRepair([
      row({ description: "0-6 months at 10am, 6-12 months at 11am." }),
    ]);
    expect(ambiguous).toEqual([]);
  });

  it("touches only rows whose listing text has a months range", () => {
    const plans = planMonthsRepair([
      row({ eventId: "years-text", description: "Ages 19-35. No months here." }),
      row({ eventId: "null-text", description: null, title: "Crafts" }),
    ]);
    expect(plans).toEqual([]);
  });

  it("never touches owner-transcribed rows", () => {
    const plans = planMonthsRepair([row({ model: OWNER_MODEL })]);
    expect(plans).toEqual([]);
  });

  it("skips repairs that would invert the range", () => {
    // Stored min 4 (years-scale, kept) with a max converting to 1:
    // contradictory — leave for review, never write min > max.
    const plans = planMonthsRepair([
      row({
        description: "Play for 0-6 months.",
        ageMin: 4,
        ageMax: 6,
      }),
    ]);
    expect(plans).toEqual([]);
  });

  it("is idempotent: repaired rows plan nothing on re-run", () => {
    const input = row();
    const plans = planMonthsRepair([input]);
    expect(plans).toHaveLength(1);
    const repaired = planMonthsRepair([
      {
        ...input,
        ageMin: plans[0]?.afterMin ?? null,
        ageMax: plans[0]?.afterMax ?? null,
        model: "repair-months",
      },
    ]);
    expect(repaired).toEqual([]);
  });
});
