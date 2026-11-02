import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the 2c home page (this repo has no DOM test
// harness): gradient hero with the 3-step strip, the sentence card
// with filter pills, the collapsible desktop filters, the mobile
// sheet opener, the shortcut card, the rainbow results header,
// and pastel skeletons behind the status text.
const HOME = readFileSync(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);
const LIST = readFileSync(
  new URL("../src/components/results-list.tsx", import.meta.url),
  "utf8",
);
const SENTENCE = readFileSync(
  new URL("../src/components/household-sentence.tsx", import.meta.url),
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

  it("toggles the desktop filters from the sentence card", () => {
    expect(HOME).toContain("All filters");
    expect(HOME).toContain("all-filters-panel");
    expect(HOME).toContain("aria-expanded");
    expect(HOME).toContain("<HouseholdPanel");
    expect(HOME).not.toContain("lg:grid-cols-[350px_minmax(0,1fr)]");
  });

  it("states the household as sentence pills with filter openers", () => {
    expect(HOME).toContain("<HouseholdSentence");
    expect(HOME).toContain("Find activities");
    expect(HOME).toContain("Reset to sample");
    expect(HOME).toContain("Edit household and filters");
    expect(HOME).toContain("lg:hidden");
    expect(HOME).toContain("<HouseholdSheet");
    expect(HOME).not.toContain('aria-label="Household summary"');
  });

  it("lands sentence pills on the visible filter control", () => {
    expect(SENTENCE).toContain("getClientRects");
    expect(SENTENCE).toContain("scrollIntoView");
    expect(SENTENCE).toContain("prefers-reduced-motion");
    expect(SENTENCE).toContain("#hh-members");
    expect(SENTENCE).toContain("#hh-availability");
    expect(SENTENCE).toContain("edit ${segment.target}");
  });

  it("badges the untouched sample above the sentence", () => {
    expect(HOME).toContain("isSampleHousehold(prefs)");
    expect(HOME).toContain("Sample household");
    expect(HOME).toContain(
      "This is an example family. Edit it to see picks for yours.",
    );
    expect(HOME).toContain('tone="lavender" icon="sparkle"');
    expect(HOME.match(/<SampleHouseholdNote \/>/g)).toHaveLength(1);
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
