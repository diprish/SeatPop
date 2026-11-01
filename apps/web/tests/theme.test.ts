import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Static pins for the step-1 design tokens. */

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
      "#faf7f2",
      "#ffffff",
      "#1f2937",
      "#6b7280",
      "#0f766e",
      "#f97316",
      "#e7e2d9",
    ]) {
      expect(css).toContain(hex);
    }
  });

  it("overrides every token for dark mode", () => {
    expect(css).toContain(".dark");
    for (const token of [
      "--sp-bg: #1c1917",
      "--sp-surface: #292524",
      "--sp-ink: #f5f5f4",
      "--sp-muted: #a8a29e",
      "--sp-primary: #2dd4bf",
      "--sp-accent: #fb923c",
      "--sp-line: #44403c",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("defines card radius, shadow, and the touch-target utility", () => {
    expect(css).toContain("--radius-card: 1rem");
    expect(css).toContain("--shadow-card");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("min-width: 44px");
  });

  it("keeps a visible keyboard focus ring", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 2px solid currentColor");
  });

  it("wires the shell to the tokens", () => {
    expect(layout).toContain("bg-background");
    expect(layout).toContain("text-ink");
    expect(layout).toContain('color: "#faf7f2"');
    expect(layout).toContain('color: "#1c1917"');
  });
});
