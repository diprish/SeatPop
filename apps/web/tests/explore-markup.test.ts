import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the ui(E) Explore bar (this repo has no DOM test
// harness): hue band chips, the free-only switch, the distance field
// with its area hint, and the grid below — same recommend path,
// same copy, same hooks.
const SOURCE = readFileSync(
  new URL("../src/app/explore/page.tsx", import.meta.url),
  "utf8",
);

describe("explore filter markup", () => {
  it("chips the bands with an any-age reset", () => {
    expect(SOURCE).toContain('aria-label="Age band"');
    expect(SOURCE).toContain("hueForBand(option)");
    expect(SOURCE).toContain("Any age");
    expect(SOURCE).toContain("BAND_LABELS[option]");
  });

  it("switches free-only ahead of the distance field", () => {
    expect(SOURCE).toContain("<Toggle");
    expect(SOURCE).toContain('label="Free only"');
    expect(SOURCE).toContain("checked={freeOnly}");
  });

  it("keeps the distance field id, label, and area hint", () => {
    expect(SOURCE).toContain('id="ex-distance"');
    expect(SOURCE).toContain(
      "Distance needs a household area — set one in For you.",
    );
    expect(SOURCE).toContain("distanceNeedsArea");
  });

  it("keeps keyboard focus order switch, distance, search", () => {
    const toggle = SOURCE.indexOf("<Toggle");
    const distance = SOURCE.indexOf('id="ex-distance"');
    const search = SOURCE.indexOf('"Search"');
    expect(toggle).toBeGreaterThan(-1);
    expect(distance).toBeGreaterThan(toggle);
    expect(search).toBeGreaterThan(distance);
  });

  it("grids the cards and keeps the empty line", () => {
    expect(SOURCE).toContain('layout="grid"');
    expect(SOURCE).toContain(
      "No events match these filters. Loosen a filter and try again.",
    );
  });

  it("keeps no raw neutral ramp in explore", () => {
    expect(SOURCE).not.toContain("neutral-");
  });
});
