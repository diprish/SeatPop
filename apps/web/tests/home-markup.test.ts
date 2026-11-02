import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the ui(C) home page (this repo has no DOM test
// harness): gradient hero with the 3-step strip, sticky desktop
// filters beside the results column, hue summary chips with the sheet
// opener on mobile, the shortcut card, the rainbow results header,
// and pastel skeletons behind the status text.
const HOME = readFileSync(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);
const LIST = readFileSync(
  new URL("../src/components/results-list.tsx", import.meta.url),
  "utf8",
);

describe("home page markup", () => {
  it("heralds the gradient headline with the 3-step strip", () => {
    expect(HOME).toContain("What&apos;s on for your");
    expect(HOME).toContain("whole family?");
    expect(HOME).toContain("text-rainbow");
    expect(HOME).toContain(
      "Free and paid activities for every age in Ottawa",
    );
    for (const step of [
      "Tell us who's coming",
      "We match every age",
      "Book and get reminded",
    ]) {
      expect(HOME).toContain(step);
    }
    for (const circle of ["bg-blush-solid", "bg-lemon-solid", "bg-mint-solid"]) {
      expect(HOME).toContain(circle);
    }
  });

  it("sticks the filters beside the results on desktop", () => {
    expect(HOME).toContain("lg:grid-cols-[350px_minmax(0,1fr)]");
    expect(HOME).toContain("lg:sticky");
    expect(HOME).toContain("hidden lg:block");
  });

  it("summarizes the household in hues with a sheet opener on mobile", () => {
    expect(HOME).toContain('aria-label="Household summary"');
    expect(HOME).toContain("hueForBand(member.age_band)");
    expect(HOME).toContain("Edit household and filters");
    expect(HOME).toContain("lg:hidden");
    expect(HOME).toContain("<HouseholdSheet");
  });

  it("badges the untouched sample next to the summary and the filters", () => {
    expect(HOME).toContain("isSampleHousehold(prefs)");
    expect(HOME).toContain("Sample household");
    expect(HOME).toContain(
      "This is an example family. Edit it to see picks for yours.",
    );
    expect(HOME).toContain('tone="lavender" icon="sparkle"');
    expect(HOME.match(/<SampleHouseholdNote \/>/g)).toHaveLength(2);
  });

  it("keeps the shortcut card labels and copy", () => {
    expect(HOME).toContain('aria-label="Describe your family"');
    expect(HOME).toContain('htmlFor="hh-text"');
    expect(HOME).toContain('id="hh-text"');
    expect(HOME).toContain("Or describe your family (shortcut)");
    expect(HOME).toContain("Don't include names.");
    expect(HOME).toContain("Parse and search");
  });

  it("headers results with the rainbow and the rank pill", () => {
    expect(LIST).toContain("picks for your household");
    expect(LIST).toContain("bg-rainbow");
    expect(LIST).toContain("AI-ranked");
    expect(LIST).toContain("match order");
  });

  it("shows pastel skeletons behind the searching status", () => {
    expect(HOME).toContain('role="status"');
    expect(HOME).toContain("Searching…");
    expect(HOME).toContain('<Skeleton tone="blush"');
    expect(HOME).toContain('<Skeleton tone="sky"');
    expect(HOME).toContain('<Skeleton tone="lavender"');
  });

  it("keeps no raw neutral ramp on home or the list", () => {
    expect(HOME).not.toContain("neutral-");
    expect(LIST).not.toContain("neutral-");
  });
});
