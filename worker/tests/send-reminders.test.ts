import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  effectiveLimit,
  maskEmail,
  MAX_SENDS_PER_RUN,
  renderReminderEmail,
  type ReminderEmailFacts,
} from "../src/send-reminders/send";

function facts(overrides: Partial<ReminderEmailFacts> = {}): ReminderEmailFacts {
  return {
    title: "Saturday Storytime",
    starts_at: "2031-03-08T15:00:00.000Z",
    ends_at: "2031-03-08T16:00:00.000Z",
    timezone: "America/Toronto",
    venue_name: "Main Branch",
    source_url: "https://example.test/e1",
    basis: "registration_window",
    window: {
      opens_at: "2031-03-04T19:00:00-05:00",
      opens_date_only: false,
      quote: "Registration opens March 4 at 7 pm.",
      source_url: "https://example.test/registration",
    },
    deleteUrl: "https://app.example.test/api/reminders/unsubscribe?id=r1&token=t1",
    ...overrides,
  };
}

describe("renderReminderEmail", () => {
  it("renders the window opening with quote and both links", () => {
    const email = renderReminderEmail(facts());
    expect(email.subject).toBe("Registration opens soon: Saturday Storytime");
    expect(email.text).toContain("Registration opens Tue Mar 4 · 7:00 PM for:");
    expect(email.text).toContain("Saturday Storytime");
    expect(email.text).toContain("Main Branch");
    expect(email.text).toContain(
      `City's wording: "Registration opens March 4 at 7 pm."`,
    );
    expect(email.text).toContain(
      "City registration page: https://example.test/registration",
    );
    expect(email.text).toContain("Official event page: https://example.test/e1");
    expect(email.text).toContain("You asked for one email about this event.");
  });

  it("renders the event-start fallback without inventing a window", () => {
    const email = renderReminderEmail({
      ...facts(),
      basis: "event_start",
      window: null,
    });
    expect(email.subject).toBe("Reminder: Saturday Storytime");
    expect(email.text).toContain(
      "No registration window was listed for this event",
    );
    expect(email.text).not.toContain("Registration opens");
    expect(email.text).toContain("Official event page: https://example.test/e1");
  });

  it("ends both templates with the one-click delete footer", () => {
    const windowed = renderReminderEmail(facts());
    expect(windowed.text).toContain(
      "Not you? Use the link below to delete this reminder:",
    );
    expect(windowed.text).toContain(
      "https://app.example.test/api/reminders/unsubscribe?id=r1&token=t1",
    );
    const fallback = renderReminderEmail({
      ...facts(),
      basis: "event_start",
      window: null,
    });
    expect(fallback.text).toContain(
      "Not you? Use the link below to delete this reminder:",
    );
    expect(fallback.text).toContain("unsubscribe?id=r1&token=t1");
  });

  it("renders date-only windows without a time", () => {
    const email = renderReminderEmail(
      facts({
        window: {
          opens_at: "2031-03-04T00:00:00-05:00",
          opens_date_only: true,
          quote: "Registration opens March 4.",
          source_url: "https://example.test/registration",
        },
      }),
    );
    expect(email.text).toContain("Registration opens Tue Mar 4 for:");
  });
});

describe("effectiveLimit", () => {
  it("defaults to the 200/run cap and never exceeds it", () => {
    expect(MAX_SENDS_PER_RUN).toBe(200);
    expect(effectiveLimit(undefined)).toBe(200);
    expect(effectiveLimit(50)).toBe(50);
    expect(effectiveLimit(200)).toBe(200);
    expect(effectiveLimit(500)).toBe(200);
  });
});

describe("sender wiring", () => {
  const run = readFileSync(
    new URL("../src/send-reminders/run.ts", import.meta.url),
    "utf8",
  );

  it("requires APP_BASE_URL and selects delete tokens", () => {
    expect(run).toContain("APP_BASE_URL");
    expect(run).toContain("select=id,email,remind_at,basis,event_id,delete_token");
    expect(run).toContain("/api/reminders/unsubscribe?id=");
  });

  it("clamps --limit through effectiveLimit", () => {
    expect(run).toContain("effectiveLimit(requested)");
    expect(run).toContain("clamped to");
  });
});

describe("maskEmail", () => {
  it("masks the local part for logs", () => {
    expect(maskEmail("you@example.com")).toBe("y***@example.com");
    expect(maskEmail("junk")).toBe("***");
  });
});

describe("reminders workflow", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/reminders.yml", import.meta.url),
    "utf8",
  );

  it("runs every 15 minutes and on manual dispatch", () => {
    expect(workflow).toContain("*/15 * * * *");
    expect(workflow).toContain("workflow_dispatch:");
  });

  it("sends through secrets by name, never by value", () => {
    expect(workflow).toContain("npm run send:reminders --workspace @seatpop/worker");
    for (const name of [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "RESEND_API_KEY",
      "RESEND_FROM",
      "APP_BASE_URL",
    ]) {
      expect(workflow).toContain(`secrets.${name}`);
    }
  });
});
