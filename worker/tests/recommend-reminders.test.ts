import { describe, expect, it } from "vitest";
import { computeRemindAt, normalizeEmail } from "../src/recommend/reminders";
import type { RegistrationWindow } from "../src/recommend/windows";

function window(overrides: Partial<RegistrationWindow> = {}): RegistrationWindow {
  return {
    scope: "Testville Aquatics",
    kind: "swimming",
    opens_at: "2031-03-04T19:00:00-05:00",
    opens_date_only: false,
    quote: "Registration opens March 4 at 7 pm.",
    source_url: "https://example.test/registration",
    label: null,
    ...overrides,
  };
}

describe("computeRemindAt", () => {
  it("fires 1 hour before the registration opening", () => {
    expect(computeRemindAt(window(), "2031-03-10T15:00:00.000Z")).toEqual({
      remind_at: "2031-03-04T23:00:00.000Z",
      basis: "registration_window",
    });
  });

  it("fires 1 day before the start when no window matches", () => {
    expect(computeRemindAt(null, "2031-03-10T15:00:00.000Z")).toEqual({
      remind_at: "2031-03-09T15:00:00.000Z",
      basis: "event_start",
    });
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases valid addresses", () => {
    expect(normalizeEmail("  You@Example.COM ")).toBe("you@example.com");
  });

  it("rejects blanks, junk, and oversized input", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("a @b.com")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@b.com`)).toBeNull();
  });
});
