import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the ui(D) ticket card (this repo has no DOM test
// harness): rainbow strip plus category accent, icon meta rows, rule
// badges, the reason callout, vote pills, and icon actions above a
// notched divider — with every label, link hook, and count string kept.
const CARD = readFileSync(
  new URL("../src/components/event-card.tsx", import.meta.url),
  "utf8",
);

describe("event card markup", () => {
  it("stubs the ticket with the strip, accent, and notched divider", () => {
    expect(CARD).toContain("bg-rainbow");
    expect(CARD).toContain("w-[6px]");
    expect(CARD).toContain("HUE_SOLID_BG[accentHue]");
    expect(CARD).toContain("hueForCategory(item.category)");
    expect(CARD).toContain("<TicketDivider />");
  });

  it("lifts on hover only when motion is safe", () => {
    expect(CARD).toContain("hover:-translate-y-0.5");
    expect(CARD).toContain("motion-reduce:transition-none");
    expect(CARD).toContain("motion-reduce:hover:translate-y-0");
  });

  it("rows time, venue, and distance with icons", () => {
    for (const icon of ["calendar", "pin", "route"]) {
      expect(CARD).toContain(`name="${icon}"`);
    }
    expect(CARD).toContain("text-lg font-bold");
    expect(CARD).toContain("hover:underline");
  });

  it("badges price, age, registration, and the age flag by rule", () => {
    expect(CARD).toContain('tone="mint" solid');
    expect(CARD).toContain('icon="shield"');
    expect(CARD).toContain('tone="navy"');
    expect(CARD).toContain('tone="neutral"');
    expect(CARD).toContain("fitLevelsForHousehold");
    expect(CARD).toContain("hueForBand(band)");
    expect(CARD).toContain('<Badge tone="peach">{badge}</Badge>');
    expect(CARD).toContain('<Badge tone="lemon" icon="warning">');
    expect(CARD).toContain("priceBadgeLabel(item.price_label)");
  });

  it("keeps the registration quote an accessible link", () => {
    expect(CARD).toContain("border-peach-solid");
    expect(CARD).toContain("Registration source for ${item.title}");
    expect(CARD).toContain("item.registration_window.quote");
  });

  it("expands extra dates through a disclosure chip", () => {
    expect(CARD).toContain("disclosure");
    expect(CARD).toContain("aria-expanded={datesOpen}");
    expect(CARD).toContain("more date");
    expect(CARD).toContain("…and {item.more_dates.length - 5} more");
  });

  it("callouts the reason in plain parenthetical words, no suffix", () => {
    expect(CARD).toContain("bg-lavender-tint");
    expect(CARD).toContain("bg-mist");
    expect(CARD).toContain('name="sparkle"');
    expect(CARD).toContain("formatReasonMarks(");
    expect(CARD).not.toContain("(AI reason)");
    expect(CARD).not.toContain("(match)");
    expect(CARD).not.toContain("(stated)");
    expect(CARD).not.toContain("(inferred)");
  });

  it("fills saved navy and pills every action with an icon", () => {
    expect(CARD).toContain("bg-navy");
    expect(CARD).toContain("dark:bg-lavender-solid dark:text-navy");
    expect(CARD).toContain("aria-pressed={saved}");
    expect(CARD).toContain("Official page for ${item.title}");
    for (const label of ["Saved", "Save", "Not for us", "Why this pick?", "Official page"]) {
      expect(CARD).toContain(label);
    }
  });

  it("chips the not-for-us reasons under their group label", () => {
    expect(CARD).toContain('aria-label="Reason"');
    expect(CARD).toContain("NOT_FOR_US_REASONS.map");
    expect(CARD).toContain('hue="blush"');
  });

  it("keeps the votes and why mounts with no raw neutrals", () => {
    expect(CARD).toContain("<WorthIt eventId={item.event_id}");
    expect(CARD).toContain("<WhySheet item={item} prefs={prefs}");
    expect(CARD).not.toContain("neutral-");
  });

  it("mounts the reminder entry under the actions", () => {
    expect(CARD).toContain("<RemindMe item={item} />");
  });
});
