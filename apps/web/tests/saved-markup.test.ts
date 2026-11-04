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

  it("fills the reminder commit primary with readable text both themes", () => {
    expect(REMIND).toContain("bg-primary");
    expect(REMIND).toContain("text-white");
    expect(REMIND).toContain("dark:text-background");
    expect(REMIND).not.toContain("bg-black");
  });

  it("commits bookings through the primary Button", () => {
    expect(CHECKLIST).toContain("<Button");
    expect(CAPTURE).toContain("<Button");
    expect(CAPTURE).toContain('variant="ghost"');
    expect(CHECKLIST).not.toContain("bg-black");
    expect(CAPTURE).not.toContain("bg-black");
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

describe("saved and booked pages", () => {
  it("badges the headers with counts", () => {
    expect(SAVED).toContain('<Badge tone="navy">{saved.length + apiOnly.length}</Badge>');
    expect(BOOKED).toContain('<Badge tone="navy">{entries.length}</Badge>');
  });

  it("softens the empty panels with icons and kept links", () => {
    expect(SAVED).toContain("bg-blush-tint");
    expect(SAVED).toContain('name="heart"');
    expect(SAVED).toContain("Nothing saved yet.");
    expect(SAVED).toContain("Tap Save on an activity you like.");
    expect(BOOKED).toContain("bg-sky-tint");
    expect(BOOKED).toContain('name="ticket"');
    expect(BOOKED).toContain("Nothing booked yet.");
    expect(BOOKED).toContain("mark it booked once");
  });

  it("lifts booking cards with icon actions and confirmation badges", () => {
    expect(BOOKED).toContain("hover:-translate-y-0.5");
    expect(BOOKED).toContain("<Badge tone=\"mint\" solid>");
    expect(BOOKED).toContain("Confirmation {entry.confirmation_id}");
    expect(BOOKED).toContain("No confirmation id");
    expect(BOOKED).toContain("Download calendar file");
    expect(BOOKED).toContain("Delete booking");
  });

  it("keeps the feed hook under a prominent button", () => {
    expect(BOOKED).toContain('aria-label="Family calendar feed URL"');
    expect(BOOKED).toContain('aria-label="Family calendar feed"');
    expect(BOOKED).toContain("{copied ? \"Copied\" : \"Copy\"}");
  });

  it("steps the checklist through pastel circles with kept hooks", () => {
    expect(CHECKLIST).toContain("peer sr-only");
    expect(CHECKLIST).toContain("HUE_TINT_BG[hue]");
    expect(CHECKLIST).toContain("bg-mint-solid text-navy");
    expect(CHECKLIST).toContain("book-${item.event_id}-${step.id}");
    expect(CHECKLIST).toContain("(opens in a new tab)");
    expect(CHECKLIST).toContain("Registration checklist");
    expect(CHECKLIST).not.toContain("Book for us");
  });

  it("pastes confirmations into a dashed panel with kept hooks", () => {
    expect(CAPTURE).toContain("border-dashed");
    expect(CAPTURE).toContain("Paste the confirmation text or email body");
    expect(CAPTURE).toContain("booking-paste-${item.event_id}");
    expect(CAPTURE).toContain("Confirmation #ABC123");
    expect(CAPTURE).toContain("Read confirmation");
    expect(CAPTURE).toContain("Check before saving");
    expect(CAPTURE).toContain("Confirm booking");
  });
});

describe("remind-me consent markup", () => {
  it("states the one-email consent line next to the form", () => {
    expect(REMIND).toContain("One email about this event, nothing else.");
    expect(REMIND).toContain("stored\n        only for this reminder");
  });

  it("labels the email input and offers one-click delete", () => {
    expect(REMIND).toContain('htmlFor={`remind-email-${item.event_id}`}');
    expect(REMIND).toContain('type="email"');
    expect(REMIND).toContain("Delete reminder");
    expect(REMIND).toContain("deleteReminderApi(reminder.id, reminder.token)");
  });
});
