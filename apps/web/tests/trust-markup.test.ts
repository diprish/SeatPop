import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the step-6 trust treatment (this repo has no DOM
// test harness): eval result panels shell as warm cards, pending and
// metadata lines sit muted, and the amber ambiguity notice keeps its
// semantic warning colors on both themes.
const TRUST = readFileSync(
  new URL("../src/app/trust/page.tsx", import.meta.url),
  "utf8",
);
const EMPTY = readFileSync(
  new URL("../src/components/empty-state.tsx", import.meta.url),
  "utf8",
);

describe("trust and empty-state markup", () => {
  it("shells eval result panels as warm cards", () => {
    expect(TRUST).toContain(
      "mt-3 rounded-card border border-line bg-surface p-4 shadow-card",
    );
    expect(TRUST).toContain(
      "mt-3 rounded-card border border-line bg-surface p-4 text-sm shadow-card",
    );
  });

  it("shells empty states as warm cards with token buttons", () => {
    expect(EMPTY).toContain(
      "rounded-card border border-line bg-surface p-4 shadow-card",
    );
    expect(EMPTY).toContain('"rounded border border-line px-3 py-1 text-sm"');
  });

  it("keeps the amber ambiguity notice semantic on both themes", () => {
    expect(TRUST).toContain("border-amber-300 bg-amber-50");
    expect(TRUST).toContain("dark:border-amber-700 dark:bg-amber-950");
  });

  it("keeps no raw neutral ramp in trust or empty states", () => {
    expect(TRUST).not.toContain("neutral-");
    expect(EMPTY).not.toContain("neutral-");
  });
});
