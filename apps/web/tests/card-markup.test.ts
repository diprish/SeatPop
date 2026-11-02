import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the step-2 card treatment (this repo has no DOM
// test harness): the For-you card shells through the design tokens —
// warm surface, hairline, radius, calm shadow — with muted metadata,
// and no raw neutral ramps left behind. Semantic greens/ambers for the
// reason marks stay: this pin only bans the neutral ramp.
const CARD = readFileSync(
  new URL("../src/components/event-card.tsx", import.meta.url),
  "utf8",
);
const LIST = readFileSync(
  new URL("../src/components/results-list.tsx", import.meta.url),
  "utf8",
);

describe("event card markup", () => {
  it("shells the card through the surface tokens", () => {
    expect(CARD).toContain(
      '<article className="rounded-card border border-line bg-surface p-4 shadow-card">',
    );
  });

  it("renders metadata and chrome in the muted and line tokens", () => {
    expect(CARD).toContain("text-sm text-muted");
    expect(CARD).toContain("text-xs text-muted");
    expect(CARD).toContain("border border-line px-3 py-1");
    expect(CARD).toContain("rounded-full border border-line px-2 py-1");
  });

  it("keeps no raw neutral ramp in the card", () => {
    expect(CARD).not.toContain("neutral-");
  });

  it("keeps the stated/inferred reason marks semantic", () => {
    expect(CARD).toContain("text-green-700 dark:text-green-300");
    expect(CARD).toContain("text-amber-700 dark:text-amber-300");
  });

  it("spaces shadowed cards one step apart in the list", () => {
    expect(LIST).toContain("space-y-4");
  });
});
