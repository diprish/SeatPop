import { describe, expect, it } from "vitest";
import {
  candidateAgeTier,
  countExactFits,
  fitLevelForMember,
  fitLevelsForHousehold,
  possessiveBandLabel,
} from "../src/age-fit";

const PRESCHOOLER = { age_band: "preschool" as const, include_adjacent: true };
const KID = { age_band: "kids" as const, include_adjacent: true };
const ADULT = { age_band: "adults" as const, include_adjacent: true };

describe("fitLevelForMember", () => {
  it("is exact when the stated range overlaps the band as stated", () => {
    expect(
      fitLevelForMember({ age_min: 3, age_max: 5 }, PRESCHOOLER),
    ).toBe("exact");
    // Partial overlap still counts: 4-8 covers preschool 3-5.
    expect(
      fitLevelForMember({ age_min: 4, age_max: 8 }, PRESCHOOLER),
    ).toBe("exact");
    expect(fitLevelForMember({ age_min: 6, age_max: 12 }, KID)).toBe("exact");
  });

  it("is adjacent only via include_adjacent expansion", () => {
    // Babytime 0-1 vs preschool 3-5: inside the 0-12 expansion only.
    expect(fitLevelForMember({ age_min: 0, age_max: 1 }, PRESCHOOLER)).toBe(
      "adjacent",
    );
    // A preschool-range event vs the kids band: inside 3-17 only.
    expect(fitLevelForMember({ age_min: 3, age_max: 5 }, KID)).toBe("adjacent");
    // Without expansion the same events fit nothing.
    expect(
      fitLevelForMember(
        { age_min: 0, age_max: 1 },
        { age_band: "preschool", include_adjacent: false },
      ),
    ).toBe("none");
  });

  it("is unknown when both ages are missing", () => {
    expect(
      fitLevelForMember({ age_min: null, age_max: null }, PRESCHOOLER),
    ).toBe("unknown");
  });

  it("is none when the range misses the band entirely", () => {
    // Kids event vs the adult band (expanded 13-130): no overlap.
    expect(fitLevelForMember({ age_min: 6, age_max: 12 }, ADULT)).toBe("none");
  });

  it("treats half-stated ranges with the SQL per-side fallback", () => {
    // Min 6 stated, max open: overlaps every band from kids up.
    expect(
      fitLevelForMember({ age_min: 6, age_max: null }, ADULT),
    ).toBe("exact");
    expect(
      fitLevelForMember({ age_min: 6, age_max: null }, PRESCHOOLER),
    ).toBe("adjacent");
  });
});

describe("household fit", () => {
  // The sample household: one adult, one kid, one preschooler.
  const members = [ADULT, KID, PRESCHOOLER];

  it("reports per-member levels in order", () => {
    // 0-1 reaches only the preschool expansion (0-12): the kid
    // expansion starts at 3, the adult one at 13.
    expect(
      fitLevelsForHousehold({ age_min: 0, age_max: 1 }, members),
    ).toEqual(["none", "none", "adjacent"]);
    expect(
      fitLevelsForHousehold({ age_min: 6, age_max: 12 }, members),
    ).toEqual(["none", "exact", "adjacent"]);
  });

  it("tiers candidates exact, then unknown, then adjacent", () => {
    expect(candidateAgeTier({ age_min: 6, age_max: 12 }, members)).toBe(
      "exact",
    );
    expect(
      candidateAgeTier({ age_min: null, age_max: null }, members),
    ).toBe("unknown");
    expect(candidateAgeTier({ age_min: 0, age_max: 1 }, members)).toBe(
      "adjacent",
    );
  });

  it("counts distinct exact members", () => {
    expect(countExactFits({ age_min: 0, age_max: 1 }, members)).toBe(0);
    expect(countExactFits({ age_min: 6, age_max: 12 }, members)).toBe(1);
    expect(countExactFits({ age_min: 0, age_max: 130 }, members)).toBe(3);
  });

  it("labels possessives for the adjacent reason phrase", () => {
    expect(possessiveBandLabel("preschool")).toBe("preschooler's");
    expect(possessiveBandLabel("baby")).toBe("baby's");
    expect(possessiveBandLabel("kids")).toBe("kids'");
  });
});
