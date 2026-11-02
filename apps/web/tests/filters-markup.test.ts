import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the ui(C) filter card and sheet (this repo has no
// DOM test harness): icon sections, hue band chips with add/remove,
// quick picks driving the same state as the custom fields, a switch
// for free-only, the part-hue When grid, and a trapped sheet with a
// pinned apply bar. All labels, ids, and help copy stay byte-identical.
const PANEL = readFileSync(
  new URL("../src/components/household-panel.tsx", import.meta.url),
  "utf8",
);
const SHEET = readFileSync(
  new URL("../src/components/household-sheet.tsx", import.meta.url),
  "utf8",
);

describe("household panel and sheet markup", () => {
  it("sections the card with icon headings", () => {
    for (const [label, icon] of [
      ["Who", "users"],
      ["Where", "pin"],
      ["Budget", "wallet"],
    ]) {
      expect(PANEL).toContain(label);
      expect(PANEL).toContain(`icon="${icon}"`);
    }
    expect(PANEL).toContain("Availability (leave empty for any time)");
    expect(PANEL).toContain('name="clock"');
  });

  it("toggles band membership through hue chips with kept labels", () => {
    expect(PANEL).toContain("hueForBand(band)");
    expect(PANEL).toContain("aria-label={`Add ${BAND_LABELS[band]}`}");
    expect(PANEL).toContain("aria-label={`Remove ${BAND_LABELS[band]}`}");
  });

  it("keeps each selected member one pill with a 44px remove half", () => {
    expect(PANEL).toContain("rounded-l-full px-4");
    expect(PANEL).toContain("rounded-r-full");
    expect(PANEL).toContain("min-h-[44px] min-w-[44px]");
  });

  it("keeps every field id and help string", () => {
    for (const id of ["hh-fsa", "hh-distance", "hh-budget"]) {
      expect(PANEL).toContain(`id="${id}"`);
    }
    expect(PANEL).toContain("3 characters like K2S.");
    expect(PANEL).toContain("Distance needs an area (FSA).");
    expect(PANEL).toContain("Add at least one member to search.");
  });

  it("drives quick picks and custom fields from the same state", () => {
    expect(PANEL).toContain("DISTANCE_QUICK");
    expect(PANEL).toContain("[2, 5, 10, 25]");
    expect(PANEL).toContain("BUDGET_QUICK");
    expect(PANEL).toContain("[10, 25, 50]");
    expect(PANEL).toContain('aria-label="Distance quick picks"');
    expect(PANEL).toContain('aria-label="Budget quick picks"');
    expect(PANEL).toContain("setDistanceKm(prefs, km)");
    expect(PANEL).toContain("setBudgetDollars(prefs, dollars)");
  });

  it("switches free-only and grids the week by part hue", () => {
    expect(PANEL).toContain("<Toggle");
    expect(PANEL).toContain('label="Free only"');
    expect(PANEL).toContain("grid-cols-4");
    expect(PANEL).toContain("hueForDayPart(part)");
    expect(PANEL).toContain('size="sm"');
  });

  it("commits through a full-width primary with a ghost reset", () => {
    expect(PANEL).toContain('className="w-full"');
    expect(PANEL).toContain("Find activities");
    expect(PANEL).toContain('variant="ghost"');
    expect(PANEL).toContain("Reset to sample");
    expect(PANEL).toContain("hideActions");
  });

  it("traps the sheet with a pinned reset/show bar", () => {
    expect(SHEET).toContain('role="dialog"');
    expect(SHEET).toContain('aria-modal="true"');
    expect(SHEET).toContain('aria-label="Edit household and filters"');
    expect(SHEET).toContain('event.key === "Escape"');
    expect(SHEET).toContain("querySelectorAll");
    expect(SHEET).toContain("sticky bottom-0");
    expect(SHEET).toContain("Show 1 pick");
    expect(SHEET).toContain("Show ${resultCount} picks");
    expect(SHEET).toContain("h-[100dvh]");
    expect(SHEET).toContain("lg:hidden");
  });

  it("keeps no raw neutral ramp in the filters", () => {
    expect(PANEL).not.toContain("neutral-");
    expect(SHEET).not.toContain("neutral-");
  });
});
