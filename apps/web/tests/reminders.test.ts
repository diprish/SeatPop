import { describe, expect, it } from "vitest";
import {
  ReminderApiError,
  deleteReminderLocal,
  friendlyReminderError,
  loadReminders,
  saveReminderLocal,
} from "../src/lib/reminders";

describe("reminder device state", () => {
  it("saves, loads, and deletes per-event tokens", () => {
    expect(loadReminders()).toEqual({});
    const reminder = {
      id: "r1",
      token: "tok",
      remind_at: "2031-03-04T23:00:00.000Z",
      basis: "registration_window",
    };
    const saved = saveReminderLocal({}, "e1", reminder);
    expect(saved["e1"]).toEqual(reminder);
    const removed = deleteReminderLocal(saved, "e1");
    expect(removed).toEqual({});
    expect(deleteReminderLocal(removed, "missing")).toEqual({});
  });
});

describe("friendlyReminderError", () => {
  it("explains a too-soon reminder without the generic fallback", () => {
    expect(
      friendlyReminderError(
        new ReminderApiError(400, "that reminder time has already passed"),
      ),
    ).toBe(
      "This one starts too soon for a reminder. Reminders go out a day before, so pick an activity that's more than a day away.",
    );
  });

  it("maps the per-email cap and the duplicate to their friendly lines", () => {
    expect(
      friendlyReminderError(
        new ReminderApiError(
          429,
          "too many pending reminders for this email (max 3 unsent)",
        ),
      ),
    ).toBe("You already have 3 reminders waiting for this email");
    expect(
      friendlyReminderError(
        new ReminderApiError(
          409,
          "a reminder is already set for this event and email",
        ),
      ),
    ).toBe("A reminder is already set for this one");
  });

  it("surfaces other 4xx server messages verbatim", () => {
    expect(
      friendlyReminderError(
        new ReminderApiError(429, "reminder service is busy, try again later"),
      ),
    ).toBe("reminder service is busy, try again later");
    expect(
      friendlyReminderError(
        new ReminderApiError(400, "that email address does not look valid"),
      ),
    ).toBe("that email address does not look valid");
  });

  it("falls back to generic only without a usable 4xx message", () => {
    expect(friendlyReminderError(new ReminderApiError(500, "reminder failed"))).toBe(
      "Couldn't set that reminder. Try again.",
    );
    expect(friendlyReminderError(new TypeError("Failed to fetch"))).toBe(
      "Couldn't set that reminder. Try again.",
    );
    expect(friendlyReminderError(null)).toBe(
      "Couldn't set that reminder. Try again.",
    );
  });
});
