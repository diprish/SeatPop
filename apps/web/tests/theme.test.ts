import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Static pins for the candy-pastel design tokens. */

const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const layout = readFileSync(
  new URL("../src/app/layout.tsx", import.meta.url),
  "utf8",
);

describe("design tokens", () => {
  it("defines the light palette verbatim", () => {
    for (const hex of [
      "#fbf8f3",
      "#ffffff",
      "#2b2f4a",
      "#565b78",
      "#646a86",
      "#e6e3ee",
      "#e4e1ed",
      "#f3f1f8",
      "#f4a9b8",
      "#fde8ed",
      "#7d2a3d",
      "#f8c08e",
      "#fdeedd",
      "#7a4a14",
      "#f2dc7a",
      "#fbf3cc",
      "#66560f",
      "#a9deb9",
      "#e6f6ec",
      "#2a5b3a",
      "#9ccbea",
      "#e4f1fa",
      "#1f5272",
      "#c6b8ea",
      "#efeafa",
      "#4a3e7a",
    ]) {
      expect(css).toContain(hex);
    }
  });

  it("overrides every token for dark mode", () => {
    expect(css).toContain(".dark");
    for (const token of [
      "--sp-bg: #161828",
      "--sp-surface: #1d2033",
      "--sp-ink: #eceef8",
      "--sp-muted: #b6bad2",
      "--sp-faint: #9aa0bb",
      "--sp-primary: #c6b8ea",
      "--sp-line: #343850",
      "--sp-mist: #262a3d",
      "--sp-blush-tint: #44394b",
      "--sp-blush-ink: #fecdd3",
      "--sp-peach-tint: #443d43",
      "--sp-peach-ink: #fed7aa",
      "--sp-lemon-tint: #434240",
      "--sp-lemon-ink: #fef08a",
      "--sp-mint-tint: #36424b",
      "--sp-mint-ink: #bbf7d0",
      "--sp-sky-tint: #343f54",
      "--sp-sky-ink: #bae6fd",
      "--sp-lavender-tint: #3b3b54",
      "--sp-lavender-ink: #ddd6fe",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("keeps pastel solids identical in both themes", () => {
    const darkBlock = css.slice(css.indexOf(".dark"));
    for (const hex of [
      "#f4a9b8",
      "#f8c08e",
      "#f2dc7a",
      "#a9deb9",
      "#9ccbea",
      "#c6b8ea",
    ]) {
      expect(darkBlock).toContain(hex);
    }
  });

  it("defines card radius, shadow, rainbow, and the touch-target utility", () => {
    expect(css).toContain("--radius-card: 1rem");
    expect(css).toContain("--shadow-card");
    expect(css).toContain("bg-rainbow");
    expect(css).toContain("text-rainbow");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("min-width: 44px");
  });

  it("keeps a visible keyboard focus ring", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 2px solid currentColor");
  });

  it("wires the shell to the tokens with the brand font", () => {
    expect(layout).toContain("bg-background");
    expect(layout).toContain("text-ink");
    expect(layout).toContain('color: "#fbf8f3"');
    expect(layout).toContain('color: "#161828"');
    expect(layout).toContain("Plus_Jakarta_Sans");
    expect(layout).toContain('weight: ["500", "700", "800"]');
    expect(layout).toContain("pointer-events-none fixed inset-0");
  });
});
