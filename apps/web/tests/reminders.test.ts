import { describe, expect, it } from "vitest";
import {
  deleteReminderLocal,
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
