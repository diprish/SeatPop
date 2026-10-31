import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the Explore filter row (this repo has no DOM test
// harness): the distance label stacks above its input, every control is
// labelled, and DOM order keeps Tab moving checkbox -> distance -> Search.
const SOURCE = readFileSync(
  new URL("../src/app/explore/page.tsx", import.meta.url),
  "utf8",
);

describe("explore filter markup", () => {
  it("labels the distance input with the label stacked above it", () => {
    const label = SOURCE.match(/<label[^>]*htmlFor="ex-distance"[^>]*>/);
    expect(label).not.toBeNull();
    expect(label?.[0]).toMatch(/\bblock\b/);
    expect(SOURCE).toContain('id="ex-distance"');
  });

  it("keeps keyboard focus order checkbox, distance, search", () => {
    const checkbox = SOURCE.indexOf('type="checkbox"');
    const distance = SOURCE.indexOf('id="ex-distance"');
    const search = SOURCE.indexOf('"Search"');
    expect(checkbox).toBeGreaterThan(-1);
    expect(distance).toBeGreaterThan(checkbox);
    expect(search).toBeGreaterThan(distance);
  });

  it("announces the area hint through the input", () => {
    expect(SOURCE).toContain('id="ex-distance-hint"');
    expect(SOURCE).toContain(
      'aria-describedby={distanceNeedsArea ? "ex-distance-hint" : undefined}',
    );
  });
});
