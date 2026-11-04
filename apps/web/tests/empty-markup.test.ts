import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the ui(E) states (this repo has no DOM test
// harness): friendly empty panels with widening chips, the blush
// error banner, and the 404 — every string and hook kept.
const EMPTY = readFileSync(
  new URL("../src/components/empty-state.tsx", import.meta.url),
  "utf8",
);
const BANNER = readFileSync(
  new URL("../src/components/error-banner.tsx", import.meta.url),
  "utf8",
);
const NOT_FOUND = readFileSync(
  new URL("../src/app/not-found.tsx", import.meta.url),
  "utf8",
);

describe("empty, error, and 404 markup", () => {
  it("softens empty panels with an icon and widening chips", () => {
    expect(EMPTY).toContain("bg-sky-tint");
    expect(EMPTY).toContain('name="search"');
    expect(EMPTY).toContain("No events matched.");
    expect(EMPTY).toContain("We couldn't run that check");
    expect(EMPTY).toContain("Nothing upcoming matches");
    expect(EMPTY).toContain("Back to the sample household");
    expect(EMPTY).toContain('hue="sky"');
  });

  it("keeps the empty-state logic and hooks", () => {
    expect(EMPTY).toContain("relaxationsFor(prefs)");
    expect(EMPTY).toContain("applyRelaxation(prefs, row.id)");
    expect(EMPTY).toContain('role="status"');
    expect(EMPTY).toContain("Checking which filter removed everything…");
  });

  it("alerts errors in blush with a retry action", () => {
    expect(BANNER).toContain('role="alert"');
    expect(BANNER).toContain("border-blush-solid bg-blush-tint");
    expect(BANNER).toContain('name="warning"');
    expect(BANNER).toContain("Something went wrong");
    expect(BANNER).toContain("{message}");
    expect(BANNER).toContain("Try again");
  });

  it("lands 404s on a friendly ticket panel", () => {
    expect(NOT_FOUND).toContain("Page not found");
    expect(NOT_FOUND).toContain("Back to For you");
    expect(NOT_FOUND).toContain('href="/"');
    expect(NOT_FOUND).toContain('name="ticket"');
    expect(NOT_FOUND).toContain("max-w-6xl");
  });

  it("keeps no raw neutral ramp in the states", () => {
    expect(EMPTY).not.toContain("neutral-");
    expect(BANNER).not.toContain("neutral-");
    expect(NOT_FOUND).not.toContain("neutral-");
  });
});
