import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the step-3 sheet/detail treatment (this repo has
// no DOM test harness): the Why sheet panels in the warm surface with
// token chrome, and both the sheet and the detail page set evidence
// quotes as indented muted quotations on the line token. The scrim
// stays black-translucent on both themes; the sheet keeps its
// bottom-sheet-on-mobile radii.
const SHEET = readFileSync(
  new URL("../src/components/why-sheet.tsx", import.meta.url),
  "utf8",
);
const DETAIL = readFileSync(
  new URL("../src/app/events/[id]/page.tsx", import.meta.url),
  "utf8",
);

describe("why sheet and detail markup", () => {
  it("panels the sheet in the surface token with its sheet radii", () => {
    expect(SHEET).toContain("rounded-t-xl bg-surface p-4 sm:rounded-xl");
    expect(SHEET).toContain("bg-black/50");
  });

  it("sets evidence quotes on the line and muted tokens", () => {
    for (const source of [SHEET, DETAIL]) {
      expect(source).toContain("border-l-2 border-line");
      expect(source).toContain("italic text-muted");
    }
  });

  it("keeps no raw neutral ramp in the sheet or detail page", () => {
    expect(SHEET).not.toContain("neutral-");
    expect(DETAIL).not.toContain("neutral-");
  });
});
