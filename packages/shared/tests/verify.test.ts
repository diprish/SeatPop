import { describe, expect, it } from "vitest";
import {
  groundingQuote,
  normalizeEvidence,
  parseDurationMinutes,
  parseFacetAges,
  verifyAmount,
  verifyBool,
  verifyCrowd,
  verifyDuration,
  verifyEnergy,
  verifyInt,
  verifyPriceKind,
  verifyRegDate,
  verifySetting,
  verifyText,
  verifyTextList,
} from "../src/verify";

const norm = (text: string): string => normalizeEvidence(text);

const TODDLER = norm(
  "Toddler Time. Songs and rhymes for little ones. Main Branch.",
);

describe("evidence verifier", () => {
  it("normalises whitespace, case and quotes", () => {
    expect(normalizeEvidence("  Winter\n\t“Concert”  ")).toBe(
      'winter "concert"',
    );
    expect(normalizeEvidence("It’s")).toBe("it's");
  });

  it("grounds quotes that occur in the source", () => {
    expect(groundingQuote("Songs and rhymes", TODDLER)).toBe(
      "songs and rhymes",
    );
    expect(groundingQuote("  SONGS   and rhymes ", TODDLER)).toBe(
      "songs and rhymes",
    );
  });

  it("rejects quotes absent from the source", () => {
    expect(groundingQuote("ages 3 to 5", TODDLER)).toBeNull();
    expect(groundingQuote("", TODDLER)).toBeNull();
    expect(groundingQuote(null, TODDLER)).toBeNull();
  });

  it("drops an invented price (adversarial: quote not in text)", () => {
    const source = norm("Winter Concert. An evening of music. Grand Hall.");
    expect(verifyAmount(1500, "$15 per person", source)).toBeNull();
    expect(verifyPriceKind("paid", "$15 per person", source)).toBeNull();
  });

  it("rejects free-about-parking but accepts free admission (adversarial)", () => {
    const parking = norm("Evening lecture. Free parking behind the hall.");
    expect(verifyPriceKind("free", "Free parking behind the hall.", parking)).toBeNull();
    const admission = norm("Evening lecture. Admission is free.");
    expect(verifyPriceKind("free", "Admission is free.", admission)).toBe("free");
    const noCharge = norm("Workshop. No charge for materials.");
    expect(verifyPriceKind("free", "No charge for materials.", noCharge)).toBe("free");
  });

  it("drops a price belonging to a different event (adversarial)", () => {
    // Enrichment verifies against ONE event's text, never the whole page.
    const eventA = norm("Storytime. Stories for kids. Sunnyside Branch.");
    expect(verifyAmount(2500, "$25 pottery workshop", eventA)).toBeNull();
    expect(verifyPriceKind("paid", "$25 pottery workshop", eventA)).toBeNull();
  });

  it("drops ages invented from a title (adversarial)", () => {
    // "Toddler Time" grounds as a quote but carries no digits.
    expect(verifyInt(3, "Toddler Time", TODDLER, { min: 0, max: 130 })).toBeNull();
    expect(verifyInt(5, "ages 3 to 5", TODDLER, { min: 0, max: 130 })).toBeNull();
    const stated = norm("Playgroup. Ages 3 to 5 with a caregiver.");
    expect(verifyInt(3, "Ages 3 to 5", stated, { min: 0, max: 130 })).toBe(3);
  });

  it("drops a paraphrased quote (adversarial)", () => {
    const source = norm("Concert in the main auditorium at 7pm.");
    expect(
      verifyText("main hall", "show held in the main hall", source),
    ).toBeNull();
    expect(
      verifyText("main auditorium", "Concert in the main auditorium", source),
    ).toBe("main auditorium");
  });

  it("requires copied values inside their own quote", () => {
    const source = norm("Yoga. A calm morning session. Studio A.");
    expect(verifyText("energetic", "A calm morning session", source)).toBeNull();
    expect(verifyText("calm", "A calm morning session", source)).toBe("calm");
  });

  it("bounds integers and checks ranges", () => {
    const source = norm("Camp. 90 minutes of games for ages 200 to 300.");
    expect(verifyInt(90, "90 minutes of games", source, { min: 1, max: 10080 })).toBe(90);
    expect(verifyInt(200, "ages 200 to 300", source, { min: 0, max: 130 })).toBeNull();
  });

  it("verifies booleans and lists", () => {
    const source = norm("Kids craft. Caregivers must stay. Wheelchair access, ASL on request.");
    expect(verifyBool(true, "Caregivers must stay", source)).toBe(true);
    expect(verifyBool("yes" as unknown as boolean, "Caregivers must stay", source)).toBeNull();
    expect(
      verifyTextList(
        ["Wheelchair access", "ASL on request"],
        "Wheelchair access, ASL on request.",
        source,
      ),
    ).toEqual(["wheelchair access", "asl on request"]);
    expect(verifyTextList(["braille"], "Wheelchair access", source)).toBeNull();
  });

  it("stores amounts only with digits and currency in the quote", () => {
    const dollars = norm("Concert. Tickets $15 at the door.");
    expect(verifyAmount(1500, "Tickets $15 at the door.", dollars)).toBe(1500);
    const words = norm("Concert. Fifteen dollars at the door.");
    expect(verifyAmount(1500, "Fifteen dollars at the door.", words)).toBeNull();
    const noCurrency = norm("Concert. Fifteen people max.");
    expect(verifyAmount(1500, "Fifteen people max.", noCurrency)).toBeNull();
  });

  it("passes unknown pricing through without a quote", () => {
    expect(verifyPriceKind("unknown", null, TODDLER)).toBe("unknown");
    expect(verifyPriceKind(null, null, TODDLER)).toBe("unknown");
    expect(verifyPriceKind("bogus", "text", TODDLER)).toBeNull();
  });

  it("grounds registration dates in month-or-digit spans", () => {
    const source = norm("Course. Registration opens November 1.");
    expect(
      verifyRegDate("2026-11-01", "Registration opens November 1.", source),
    ).toBe("2026-11-01");
    expect(verifyRegDate("2026-02-30", "Registration opens November 1.", source)).toBeNull();
    const vague = norm("Course. Register soon, spots fill fast.");
    expect(verifyRegDate("2026-11-01", "Register soon", vague)).toBeNull();
  });

  it("accepts vocab values only on cue words in the quote", () => {
    const hall = norm("Concert in the main hall at 7pm.");
    expect(verifySetting("indoors", "Concert in the main hall", hall)).toBe("indoors");
    expect(verifySetting("outdoors", "Concert in the main hall", hall)).toBeNull();
    expect(verifySetting("ballroom", "Concert in the main hall", hall)).toBeNull();
    const calm = norm("Yoga. A quiet morning session.");
    expect(verifyEnergy("calm", "A quiet morning session", calm)).toBe("calm");
    expect(verifyEnergy("high-energy", "A quiet morning session", calm)).toBeNull();
    const capped = norm("Workshop. Limited to 12 spots.");
    expect(verifyCrowd("small-group", "Limited to 12 spots", capped)).toBe("small-group");
    expect(verifyCrowd("large-group", "Limited to 12 spots", capped)).toBeNull();
  });

  it("matches whole cue words, so mushroom never means room", () => {
    const forage = norm("Mushroom foraging walk in the forest.");
    expect(verifySetting("indoors", "Mushroom foraging walk", forage)).toBeNull();
    expect(verifySetting("outdoors", "walk in the forest", forage)).toBe("outdoors");
    const parking = norm("Festival. Free parking behind the park.");
    expect(verifySetting("outdoors", "behind the park", parking)).toBe("outdoors");
  });

  it("ignores negated cues and structural hybrids", () => {
    const dropin = norm("Crafts. Drop-in, no registration required.");
    expect(verifyCrowd("small-group", "no registration required", dropin)).toBeNull();
    const both = norm("Talk in the hall, livestream online.");
    expect(verifySetting("hybrid", "in the hall, livestream online", both)).toBe("hybrid");
    expect(verifySetting("hybrid", "in the main hall", norm("Talk in the main hall."))).toBeNull();
  });

  it("parses durations from digits and number words", () => {
    expect(parseDurationMinutes("one-hour workshop")).toBe(60);
    expect(parseDurationMinutes("a two hour session")).toBe(120);
    expect(parseDurationMinutes("90 minutes of games")).toBe(90);
    expect(parseDurationMinutes("1.5 hours long")).toBe(90);
    expect(parseDurationMinutes("an hour of music")).toBe(60);
    expect(parseDurationMinutes("half an hour")).toBe(30);
    expect(parseDurationMinutes("quarter of an hour")).toBe(15);
    expect(parseDurationMinutes("forty-five minutes")).toBeNull();
    expect(parseDurationMinutes("all morning")).toBeNull();
  });

  it("verifies durations against digits or parsed words", () => {
    const source = norm("Club. A one-hour workshop every week.");
    expect(verifyDuration(60, "A one-hour workshop", source)).toBe(60);
    expect(verifyDuration(90, "A one-hour workshop", source)).toBeNull();
    const digits = norm("Camp. 90 minutes of games.");
    expect(verifyDuration(90, "90 minutes of games", digits)).toBe(90);
  });

  it("reads facet ages only from digits the label states", () => {
    expect(parseFacetAges("Adults 50-plus")).toEqual({ min: 50 });
    expect(parseFacetAges("Ages 3 to 5")).toEqual({ min: 3, max: 5 });
    expect(parseFacetAges("Teen")).toBeNull();
    expect(parseFacetAges("Adult")).toBeNull();
    expect(parseFacetAges("Baby")).toBeNull();
  });
});
