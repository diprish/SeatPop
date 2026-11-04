import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the ui(E) trust page (this repo has no DOM test
// harness): honest stat tiles, zebra tables with CSS meters, the large
// gate badge, and the lemon ambiguity notice — every number shown,
// every pending state kept.
const TRUST = readFileSync(
  new URL("../src/app/trust/page.tsx", import.meta.url),
  "utf8",
);
const EMPTY = readFileSync(
  new URL("../src/components/empty-state.tsx", import.meta.url),
  "utf8",
);

describe("trust and empty-state markup", () => {
  it("titles How we check with a plain summary and three tiles", () => {
    expect(TRUST).toContain("How we check");
    expect(TRUST).toContain("These numbers come from our own test runs");
    expect(TRUST).toContain("hand-labeled real");
    expect(TRUST).toContain("never called a paid activity free and never got a price wrong");
    for (const label of ["wrong prices", "'free' mistakes", "results outside your limits"]) {
      expect(TRUST).toContain(label);
    }
    expect(TRUST).toContain("bg-mint-tint");
    expect(TRUST).toContain("bg-blush-tint");
    expect(TRUST).toContain("bg-lemon-tint");
  });

  it("collapses the technical tables under one details", () => {
    expect(TRUST).toContain("<details");
    expect(TRUST).toContain("Technical details");
    expect(TRUST).toContain("</details>");
  });

  it("badges the gate large without hiding the counts", () => {
    expect(TRUST).toContain("Gate: PASS");
    expect(TRUST).toContain("Gate: FAIL");
    expect(TRUST).toContain("False-free {model.falseFree}");
    expect(TRUST).toContain("wrong-price {model.wrongPrice}");
  });

  it("meters accuracy with CSS and zebras the rows", () => {
    expect(TRUST).toContain("bg-mint-solid");
    expect(TRUST).toContain("field.accuracy * 100");
    expect(TRUST).toContain("bg-mist/60");
  });

  it("flags ambiguity in lemon and fallback results in badges", () => {
    expect(TRUST).toContain("border-lemon-solid bg-lemon-tint");
    expect(TRUST).toContain("Excluded from scoring as ambiguous");
    expect(TRUST).toContain("<Badge tone=\"mint\" solid>yes</Badge>");
    expect(TRUST).toContain("<Badge tone=\"blush\" solid>NO</Badge>");
  });

  it("keeps every section label and pending line", () => {
    for (const label of ["Enrichment eval", "Recommend eval", "Fallback proof"]) {
      expect(TRUST).toContain(`aria-label="${label}"`);
    }
    expect(TRUST).toContain("Enrichment eval pending");
    expect(TRUST).toContain("Recommend eval pending");
    expect(TRUST).toContain("Fallback proof pending");
    expect(TRUST).toContain("Policy probe");
    expect(TRUST).toContain("(must be 0)");
  });

  it("shells empty states as warm cards", () => {
    expect(EMPTY).toContain(
      "rounded-card border border-line bg-surface",
    );
  });

  it("keeps no raw neutral ramp in trust or empty states", () => {
    expect(TRUST).not.toContain("neutral-");
    expect(EMPTY).not.toContain("neutral-");
  });
});
