import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  maskEmail,
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
    ]) {
      expect(workflow).toContain(`secrets.${name}`);
    }
  });
});
