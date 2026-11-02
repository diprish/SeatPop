import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the step-6 shell migration (this repo has no DOM
// test harness): the sticky nav tints to the surface token, the For-you
// chrome and the legacy recommend page sit on the line/muted tokens,
// and the legacy commit buttons join the primary pattern — which also
// gives that light-only page dark-theme text for the first time.
const NAV = readFileSync(
  new URL("../src/components/site-nav.tsx", import.meta.url),
  "utf8",
);
const HOME = readFileSync(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);
const LEGACY = readFileSync(
  new URL("../src/app/recommend/page.tsx", import.meta.url),
  "utf8",
);

describe("nav and remaining shell markup", () => {
  it("tints the sticky nav to the surface and line tokens", () => {
    expect(NAV).toContain("border-b border-line bg-surface");
    expect(NAV).toContain("text-muted hover:underline");
  });

  it("sits home chrome and hidden rows on the surface tokens", () => {
    expect(HOME).toContain("border border-line bg-surface p-2 text-sm");
    expect(HOME).toContain("rounded border border-line px-2 py-0.5 text-xs");
  });

  it("fills the legacy commit buttons primary with dark-theme text", () => {
    expect(LEGACY).toContain("bg-primary");
    expect(LEGACY).toContain("dark:text-background");
    expect(LEGACY).not.toContain("bg-black");
  });

  it("keeps no raw neutral ramp in the shell", () => {
    expect(NAV).not.toContain("neutral-");
    expect(HOME).not.toContain("neutral-");
    expect(LEGACY).not.toContain("neutral-");
  });
});
