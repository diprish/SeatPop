import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG AA guard for the 2c palette: every text/background pair the UI
// actually renders must clear 4.5:1. Token values come from globals.css
// (single source of truth); Tailwind amber/green ramps are pinned here
// to the v4 defaults the classes resolve to.

const CSS = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

function token(name: string, dark: boolean): string {
  // First definition lives in :root (light), the second in .dark.
  // Theme-independent tokens (solids) are defined once.
  const matches = [
    ...CSS.matchAll(new RegExp(`--sp-${name}:\\s*(#[0-9a-fA-F]{6})`, "g")),
  ];
  const pick = dark ? (matches[1] ?? matches[0]) : matches[0];
  if (!pick) throw new Error(`missing token --sp-${name}`);
  return pick[1]!;
}

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}

const HUES = ["blush", "peach", "lemon", "mint", "sky", "lavender"] as const;

describe("2c contrast", () => {
  it("clears 4.5:1 for ink on tint in both themes", () => {
    for (const dark of [false, true]) {
      for (const hue of HUES) {
        const r = ratio(token(`${hue}-ink`, dark), token(`${hue}-tint`, dark));
        expect(r, `${hue} ink/tint ${dark ? "dark" : "light"}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it("clears 4.5:1 for navy on every pastel solid", () => {
    for (const hue of HUES) {
      // Solids are theme-independent by design.
      expect(ratio("#2b2f4a", token(`${hue}-solid`, false))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("clears 4.5:1 for the stated/inferred reason marks", () => {
    for (const bg of [token("lavender-tint", false), token("mist", false)]) {
      expect(ratio("#92400e", bg)).toBeGreaterThanOrEqual(4.5); // amber-800
      expect(ratio("#166534", bg)).toBeGreaterThanOrEqual(4.5); // green-800
    }
    for (const bg of [token("lavender-tint", true), token("mist", true)]) {
      expect(ratio("#fcd34d", bg)).toBeGreaterThanOrEqual(4.5); // amber-300
      expect(ratio("#86efac", bg)).toBeGreaterThanOrEqual(4.5); // green-300
    }
  });

  it("clears 4.5:1 for muted text on surfaces and tints", () => {
    for (const bg of [
      token("surface", false),
      token("lavender-tint", false),
      token("mist", false),
    ]) {
      expect(ratio(token("muted", false), bg)).toBeGreaterThanOrEqual(4.5);
    }
    for (const bg of [
      token("surface", true),
      token("lavender-tint", true),
      token("mist", true),
    ]) {
      expect(ratio(token("muted", true), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("clears 4.5:1 for amber alerts on the page surface", () => {
    expect(ratio("#92400e", token("surface", false))).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#fcd34d", token("surface", true))).toBeGreaterThanOrEqual(4.5);
  });
});
