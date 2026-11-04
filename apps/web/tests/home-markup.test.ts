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
const GROUPED = readFileSync(
  new URL("../src/components/per-person-results.tsx", import.meta.url),
  "utf8",
);
const FORM = readFileSync(
  new URL("../src/components/household-form.tsx", import.meta.url),
  "utf8",
);
const FORM_LOGIC = readFileSync(
  new URL("../src/lib/household-form.ts", import.meta.url),
  "utf8",
);
const GROUPING = readFileSync(
  new URL("../src/lib/per-person.ts", import.meta.url),
  "utf8",
);
const CARD = readFileSync(
  new URL("../src/components/event-card.tsx", import.meta.url),
  "utf8",
);
const RECOMMEND = readFileSync(
  new URL("../src/app/recommend/page.tsx", import.meta.url),
  "utf8",
);
const CSS = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const SAVED = readFileSync(
  new URL("../src/app/saved/page.tsx", import.meta.url),
  "utf8",
);
const BOOKING = readFileSync(
  new URL("../src/components/booking-capture.tsx", import.meta.url),
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
      "See what fits each person",
      "Register on the official page, and we'll remind you",
    ]) {
      expect(HOME).toContain(step);
    }
    for (const circle of ["bg-blush-solid", "bg-lemon-solid", "bg-mint-solid"]) {
      expect(HOME).toContain(circle);
    }
  });

  it("renders one plain form with no filter panel or sheet", () => {
    expect(HOME).toContain("<HouseholdForm");
    expect(HOME).toContain("onShowPicks={showPicks}");
    expect(HOME).toContain('id="results"');
    expect(HOME).toContain("aria-busy");
    expect(HOME).not.toContain("all-filters-panel");
    expect(HOME).not.toContain("<HouseholdPanel");
    expect(HOME).not.toContain("<HouseholdSheet");
    expect(HOME).not.toContain("<HouseholdSentence");
    expect(HOME).not.toContain("All filters");
    expect(HOME).not.toContain("Edit household and filters");
    expect(HOME).not.toContain("lg:grid-cols-[350px_minmax(0,1fr)]");
  });

  it("commits the form through Find activities with a start-over reset", () => {
    expect(FORM).toContain("<form");
    expect(FORM).toContain("Find activities");
    expect(FORM).toContain("Finding activities…");
    expect(FORM).toContain("Start over");
    expect(FORM).toContain('type="submit"');
  });

  it("toggles fixed-order age chips with state in the name", () => {
    expect(FORM).toContain("AGE_BANDS.map");
    expect(FORM).toContain("BAND_LABELS[band]");
    expect(FORM).toContain(", ${selected ? \"selected\" : \"not selected\"}");
    expect(FORM).toContain("toggleBand(prefs, band)");
    expect(FORM).toContain('aria-live="polite"');
    expect(FORM).toContain("LAST_BAND_NOTICE");
  });

  it("labels postal, within, and budget fields", () => {
    expect(FORM).toContain('id="hf-postal"');
    expect(FORM).toContain('htmlFor="hf-within"');
    expect(FORM).toContain('htmlFor="hf-budget"');
    expect(FORM).toContain("<select");
    expect(FORM).toContain("WITHIN_KM.map");
    expect(FORM).toContain("BUDGET_DOLLARS.map");
    expect(FORM).toContain("{km} km");
    expect(FORM).toContain("up to $");
    expect(FORM).toContain("fsaFieldError(prefs.fsa)");
    expect(FORM).toContain("distanceAreaError(prefs)");
    expect(FORM).toContain("normaliseFsaInput(e.target.value)");
    expect(FORM).toContain("serverPostalError");
    expect(FORM_LOGIC).toContain("Enter 3 characters like K2S.");
    expect(FORM_LOGIC).toContain("Add a postal code to use How far.");
    expect(FORM_LOGIC).toContain("OTTAWA_FSA_MESSAGE");
    expect(HOME).toContain("isUnknownAreaError(message)");
    expect(HOME).toContain("setAreaError(OTTAWA_FSA_MESSAGE)");
  });

  it("discloses the time grid behind an Any-time summary", () => {
    expect(FORM).toContain("<details");
    expect(FORM).toContain("<summary");
    expect(FORM).toContain("timeSlotsSummary(prefs.availability)");
    expect(FORM).toContain("<AvailabilityGrid");
    expect(FORM).toContain("Clear");
  });

  it("submits the form to exactly one search call", () => {
    expect(FORM).toContain("onSubmit={handleSubmit}");
    expect(FORM).toContain("onShowPicks();");
    expect(FORM.match(/onShowPicks\(\);/g)).toHaveLength(1);
    expect(HOME).toContain("onShowPicks={showPicks}");
    expect(HOME.match(/void search\(prefs\);/g)).toHaveLength(1);
  });

  it("reveals results with scroll and focus after Find activities", () => {
    expect(HOME).toContain("resultsRef");
    expect(HOME).toContain("scrollIntoView");
    expect(HOME).toContain("prefers-reduced-motion");
    expect(HOME).toContain("scroll-mt-20");
    expect(HOME).toContain('tabIndex={-1}');
  });

  it("keeps no sentence or sheet remnants on home", () => {
    for (const source of [HOME, FORM]) {
      expect(source).not.toContain("HouseholdSentence");
      expect(source).not.toContain("HouseholdSheet");
      expect(source).not.toContain("HouseholdPanel");
      expect(source).not.toContain("focusFilterTarget");
      expect(source).not.toContain("filter-anchor");
    }
  });

  it("notes the untouched sample near the form heading", () => {
    expect(HOME).toContain("isSampleHousehold(prefs)");
    expect(FORM).toContain(
      "Showing a sample family. Change it to see yours.",
    );
    expect(FORM).toContain("Who&apos;s coming?");
  });

  it("keeps the shortcut card labels and copy", () => {
    expect(HOME).toContain('aria-label="Describe your family"');
    expect(HOME).toContain('htmlFor="hh-text"');
    expect(HOME).toContain('id="hh-text"');
    expect(HOME).toContain("Or just tell us about your family");
    expect(HOME).toContain("No names needed.");
    expect(HOME).toContain("Find activities");
  });

  it("headers results with the rainbow and the rank pill", () => {
    expect(LIST).toContain("picks for your household");
    expect(LIST).toContain("bg-rainbow");
    expect(LIST).toContain("Picked for your family");
    expect(LIST).toContain("Best matches");
  });

  it("groups For-you picks per person with a together row", () => {
    expect(HOME).toContain("<PerPersonResults");
    expect(GROUPED).toContain("Everyone together");
    expect(GROUPED).toContain("Picked for your family");
    expect(GROUPED).toContain("Best matches");
    expect(GROUPED).toContain("groupPerPerson");
    expect(GROUPED).toContain("No single pick fits everyone");
    expect(GROUPED).toContain("Nothing for ");
    expect(GROUPED).toContain("in this window.");
    expect(GROUPED).toContain("relaxationsFor");
    expect(GROUPED).toContain("Show less");
    expect(GROUPED).toContain("auto-fit,minmax(260px,1fr)");
  });

  it("tabs one member list at a time on mobile with a11y wiring", () => {
    expect(GROUPED).toContain('role="tablist"');
    expect(GROUPED).toContain('role="tab"');
    expect(GROUPED).toContain('role="tabpanel"');
    expect(GROUPED).toContain("aria-selected");
    expect(GROUPED).toContain("aria-controls");
    expect(GROUPED).toContain("aria-labelledby");
    expect(GROUPED).toContain("ArrowRight");
    expect(GROUPED).toContain("ArrowLeft");
    expect(GROUPED).toContain("Home");
    expect(GROUPED).toContain("End");
    expect(GROUPED).toContain("top-[65px]");
    expect(GROUPED).toContain("min-h-[44px]");
    expect(GROUPED).toContain('aria-label="Results by member"');
    expect(GROUPED).toContain("(min-width: 1024px)");
  });

  it("opens mobile on the first tab with picks, then stays put", () => {
    expect(GROUPED).toContain("picksOn(tab.id)");
    expect(GROUPED).toContain("tabs.find");
    expect(GROUPED).toContain("setManual(true)");
    expect(GROUPED).toContain("manual && tabs.some");
  });

  it("states partial age ranges in column reasons", () => {
    expect(GROUPED).toContain("columnReason(item.reason, item, band)");
  });

  it("qualifies together by band overlap and names every band", () => {
    expect(GROUPING).toContain("overlapsStatedBand(item, band)");
    expect(GROUPING).toContain("isCaregiverOnly(item.title)");
    expect(GROUPED).toContain("togetherReason(item.reason, item, bands)");
    expect(GROUPED).toContain("bands={columns.map((column) => column.band)}");
  });

  it("skips the together row when a single band owns every pick", () => {
    expect(GROUPED).toContain("columns.length === 1");
    expect(GROUPED).toContain("columns.length !== 1");
  });

  it("dims old results while reloading instead of blanking", () => {
    expect(HOME).toContain("aria-busy={busy");
    expect(HOME).toContain("opacity-60");
    expect(HOME).toContain("Finding activities…");
    expect(HOME).toContain("Your previous results are unchanged.");
  });

  it("shows pastel skeletons behind the finding status", () => {
    expect(HOME).toContain('role="status"');
    expect(HOME).toContain("Finding activities…");
    expect(HOME).toContain('<Skeleton tone="blush"');
    expect(HOME).toContain('<Skeleton tone="sky"');
    expect(HOME).toContain('<Skeleton tone="lavender"');
  });

  it("keeps no raw neutral ramp on home or the list", () => {
    expect(HOME).not.toContain("neutral-");
    expect(LIST).not.toContain("neutral-");
    expect(GROUPED).not.toContain("neutral-");
  });

  it("pairs every amber-800 text with a dark variant", () => {
    for (const [name, source] of [
      ["home", HOME],
      ["list", LIST],
      ["grouped", GROUPED],
      ["card", CARD],
      ["recommend", RECOMMEND],
      ["saved", SAVED],
      ["booking", BOOKING],
    ] as const) {
      const light = source.match(/text-amber-800(?!.*dark:)/g) ?? [];
      expect(`${name}: ${light.join()}`).toBe(`${name}: `);
    }
  });

  it("orders headings h1, h2 sections, h3 cards", () => {
    expect(HOME).toContain("<h1");
    expect(GROUPED).toContain("<h2");
    expect(GROUPED).not.toContain("<h1");
    expect(CARD).toContain("<h3");
    expect(CARD).not.toContain("<h1");
    expect(CARD).not.toContain("<h2");
  });

  it("hard-codes no light colours in the 2c sources", () => {
    for (const source of [HOME, GROUPED, FORM]) {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source).not.toMatch(/text-(white|black)\b/);
      expect(source).not.toMatch(/bg-(white|black)\b/);
      expect(source).not.toContain("outline-none");
    }
  });

  it("rings keyboard focus at 2px in both themes", () => {
    expect(CSS).toContain(":focus-visible");
    expect(CSS).toContain("outline: 2px solid #2b2f4a");
    expect(CSS).toContain(".dark :focus-visible");
  });
});
