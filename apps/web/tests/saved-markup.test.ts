import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the step-5 saved/booked treatment (this repo has
// no DOM test harness): booked entries shell as warm cards beside the
// saved cards, every commit button (set reminder, book for us, read
// and confirm) fills primary with theme-correct text, and the review
// panel sits flat on the surface token — never a shadowed card inside
// the flow.
const SAVED = readFileSync(
  new URL("../src/app/saved/page.tsx", import.meta.url),
  "utf8",
);
const BOOKED = readFileSync(
  new URL("../src/app/booked/page.tsx", import.meta.url),
  "utf8",
);
const REMIND = readFileSync(
  new URL("../src/components/remind-me.tsx", import.meta.url),
  "utf8",
);
const CHECKLIST = readFileSync(
  new URL("../src/components/booking-checklist.tsx", import.meta.url),
  "utf8",
);
const CAPTURE = readFileSync(
  new URL("../src/components/booking-capture.tsx", import.meta.url),
  "utf8",
);

describe("saved and booked markup", () => {
  it("shells booked entries as warm cards with card list rhythm", () => {
    expect(BOOKED).toContain(
      "rounded-card border border-line bg-surface p-4 shadow-card",
    );
    expect(BOOKED).toContain("space-y-4");
    expect(SAVED).toContain("space-y-4");
  });

  it("fills every commit button primary with readable text both themes", () => {
    for (const source of [REMIND, CHECKLIST, CAPTURE]) {
      expect(source).toContain("bg-primary");
      expect(source).toContain("text-white");
      expect(source).toContain("dark:text-background");
      expect(source).not.toContain("bg-black");
    }
  });

  it("keeps the confirmation review panel flat on the surface", () => {
    expect(CAPTURE).toContain("rounded border border-line bg-surface p-3");
    expect(CAPTURE).not.toContain("shadow-card");
  });

  it("keeps no raw neutral ramp in any saved/booked surface", () => {
    for (const source of [SAVED, BOOKED, REMIND, CHECKLIST, CAPTURE]) {
      expect(source).not.toContain("neutral-");
    }
  });
});
