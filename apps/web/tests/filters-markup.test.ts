import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the step-4 form treatment (this repo has no DOM
// test harness): the household panel and the Explore filters shell as
// warm cards, selected chips follow the Worth-it pressed pattern
// (primary ring + tint, never an inverted black pill), and the search
// buttons fill primary with theme-correct text (white on teal-700,
// warm-black on teal-300).
const PANEL = readFileSync(
  new URL("../src/components/household-panel.tsx", import.meta.url),
  "utf8",
);
const EXPLORE = readFileSync(
  new URL("../src/app/explore/page.tsx", import.meta.url),
  "utf8",
);

describe("household panel and explore markup", () => {
  it("shells both form sections as warm cards", () => {
    for (const source of [PANEL, EXPLORE]) {
      expect(source).toContain(
        "rounded-card border border-line bg-surface p-4 shadow-card",
      );
    }
  });

  it("marks selected chips with the primary pressed pattern", () => {
    for (const source of [PANEL, EXPLORE]) {
      expect(source).toContain("border-primary bg-primary/10");
      expect(source).not.toContain("bg-black");
    }
  });

  it("fills the search buttons primary with readable text both themes", () => {
    for (const source of [PANEL, EXPLORE]) {
      expect(source).toContain("bg-primary");
      expect(source).toContain("text-white");
      expect(source).toContain("dark:text-background");
    }
  });

  it("sets inputs and member pills on the surface tokens", () => {
    expect(PANEL).toContain("border border-line bg-surface p-2");
    expect(PANEL).toContain("rounded-full bg-background px-3 py-1");
    expect(EXPLORE).toContain("border border-line bg-surface p-2");
  });

  it("keeps no raw neutral ramp in either form", () => {
    expect(PANEL).not.toContain("neutral-");
    expect(EXPLORE).not.toContain("neutral-");
  });
});
