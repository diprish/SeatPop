import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the ui(E) sheet and detail page (this repo has no
// DOM test harness): tinted sheet rows with quote cards, the category
// banner, sticky actions, and the registration timeline — every fact,
// quote, link, and hook kept.
const SHEET = readFileSync(
  new URL("../src/components/why-sheet.tsx", import.meta.url),
  "utf8",
);
const DETAIL = readFileSync(
  new URL("../src/app/events/[id]/page.tsx", import.meta.url),
  "utf8",
);

describe("why sheet and detail markup", () => {
  it("tints sheet rows with checks and quote cards", () => {
    expect(SHEET).toContain("rounded-xl bg-mist p-3");
    expect(SHEET).toContain('name="check"');
    expect(SHEET).toContain("text-mint-ink");
    expect(SHEET).toContain("rounded-lg border border-line bg-surface p-2");
    expect(SHEET).toContain("Why this pick?");
  });

  it("softens the missing-quotes notice to lemon", () => {
    expect(SHEET).toContain("bg-lemon-tint");
    expect(SHEET).toContain("text-lemon-ink");
    expect(SHEET).toContain("Quotes unavailable — showing matched fields only.");
  });

  it("keeps the sheet dialog contract", () => {
    expect(SHEET).toContain('role="dialog"');
    expect(SHEET).toContain('aria-modal="true"');
    expect(SHEET).toContain("rounded-t-xl bg-surface p-4 sm:rounded-xl");
    expect(SHEET).toContain('aria-label="Close why sheet"');
    expect(SHEET).toContain("Official page for ${item.title}");
  });

  it("banners the detail page in the category tint with badges", () => {
    expect(DETAIL).toContain("HUE_TINT_BG[bannerHue]");
    expect(DETAIL).toContain("hueForCategory(detail.category)");
    expect(DETAIL).toContain('tone="mint" solid');
    expect(DETAIL).toContain('icon="shield"');
    expect(DETAIL).toContain('tone="navy"');
    expect(DETAIL).toContain('<Badge tone="neutral">{ages}</Badge>');
    expect(DETAIL).toContain("POLICY_BADGE_LABEL");
  });

  it("sticks the actions beside the facts on desktop", () => {
    expect(DETAIL).toContain("lg:grid-cols-[minmax(0,1fr)_280px]");
    expect(DETAIL).toContain("lg:sticky");
    expect(DETAIL).toContain("aria-pressed={savedNow}");
    expect(DETAIL).toContain('name="heart"');
    expect(DETAIL).toContain("Official page for ${detail.title}");
    expect(DETAIL).toContain("<RemindMe item={{ event_id: detail.id }} />");
    expect(DETAIL).toContain("<WorthIt eventId={detail.id}");
  });

  it("builds saves from stored fields only", () => {
    expect(DETAIL).toContain("toSaveItem(detail)");
    expect(DETAIL).toContain("distance_km: null");
    expect(DETAIL).toContain("(stated)");
    expect(DETAIL).toContain("reasonFromModel: false");
    expect(DETAIL).toContain("check the age group");
  });

  it("timelines registration in three pastel steps", () => {
    expect(DETAIL).toContain("bg-peach-solid");
    expect(DETAIL).toContain("bg-sky-solid");
    expect(DETAIL).toContain("bg-mint-solid");
    expect(DETAIL).toContain("Registration opens {windowOpens}");
    expect(DETAIL).toContain("City registration page for ${detail.title}");
    expect(DETAIL).toContain("Reminder set");
    expect(DETAIL).toContain("No reminder set");
    expect(DETAIL).toContain('aria-label="Registration"');
  });

  it("keeps every fact section, label, and fallback", () => {
    for (const label of [
      "Verified facts",
      "Price: {priceBasis}",
      "About",
      "Listing text",
      "Also at this branch",
    ]) {
      expect(DETAIL).toContain(label);
    }
    expect(DETAIL).toContain("Unstated — check the age group");
    expect(DETAIL).toContain("Adult supervisor");
    expect(DETAIL).toContain("Event not found");
    expect(DETAIL).toContain("Back to For you");
  });

  it("keeps no raw neutral ramp in the sheet or detail page", () => {
    expect(SHEET).not.toContain("neutral-");
    expect(DETAIL).not.toContain("neutral-");
  });
});
