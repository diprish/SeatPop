import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the ui(B) shell (this repo has no DOM test
// harness): translucent bars with the rainbow rule, navy active pills,
// icon bottom tabs with safe-area padding, and the credited footer.
const NAV = readFileSync(
  new URL("../src/components/site-nav.tsx", import.meta.url),
  "utf8",
);
const FOOTER = readFileSync(
  new URL("../src/components/site-footer.tsx", import.meta.url),
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

function page(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const PAGES = [
  "../src/app/page.tsx",
  "../src/app/explore/page.tsx",
  "../src/app/saved/page.tsx",
  "../src/app/booked/page.tsx",
  "../src/app/trust/page.tsx",
  "../src/app/events/[id]/page.tsx",
  "../src/app/recommend/page.tsx",
];

describe("nav and remaining shell markup", () => {
  it("floats translucent bars with the rainbow rule", () => {
    expect(NAV).toContain("bg-surface/80 backdrop-blur");
    expect(NAV).toContain("h-1 bg-rainbow");
    expect(NAV).toContain("max-w-6xl");
  });

  it("marks the wordmark with a navy ticket and pills active navy", () => {
    expect(NAV).toContain("bg-navy text-white dark:bg-lavender-solid dark:text-navy");
    expect(NAV).toContain('name="ticket"');
    expect(NAV).toContain("bg-primary px-4 font-bold text-white dark:text-navy");
    expect(NAV).toContain("hover:bg-lavender-tint");
    expect(NAV).toContain('aria-current={active ? "page" : undefined}');
  });

  it("tabs the small screens with icons, labels, and safe-area padding", () => {
    expect(NAV).toContain("fixed inset-x-0 bottom-0");
    expect(NAV).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(NAV).toContain("grid-cols-5");
    expect(NAV).toContain("bg-primary px-4 py-1 text-white dark:text-navy");
    for (const label of ["For you", "Explore", "Saved", "Booked", "Trust"]) {
      expect(NAV).toContain(label);
    }
  });

  it("keeps the theme toggle behavior and labels", () => {
    expect(NAV).toContain("THEME_STORAGE_KEY");
    expect(NAV).toContain("Switch to light theme");
    expect(NAV).toContain("Switch to dark theme");
    expect(NAV).toContain("aria-pressed={dark}");
  });

  it("credits data, the hackathon, trust, and the repo in the footer", () => {
    expect(FOOTER).toContain("GeoNames");
    expect(FOOTER).toContain("CC BY 4.0");
    expect(FOOTER).toContain("Meta Global AI Developer Hackathon");
    expect(FOOTER).toContain('href="/trust"');
    expect(FOOTER).toContain("https://github.com/diprish/SeatPop");
    expect(FOOTER).toContain("pb-28 lg:pb-8");
  });

  it("widens every page container without narrowing anything back", () => {
    for (const path of PAGES) {
      const src = page(path);
      expect(src).toContain("max-w-6xl");
      expect(src).not.toContain("max-w-2xl");
    }
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
    expect(FOOTER).not.toContain("neutral-");
    expect(HOME).not.toContain("neutral-");
    expect(LEGACY).not.toContain("neutral-");
  });
});
