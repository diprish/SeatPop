import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the Remind-me flow (no DOM harness): explicit
// consent copy, a labelled email input, and one-click delete.
const SOURCE = readFileSync(
  new URL("../src/components/remind-me.tsx", import.meta.url),
  "utf8",
);

describe("remind-me markup", () => {
  it("states the one-email consent line next to the form", () => {
    expect(SOURCE).toContain("One email about this event, nothing else.");
    expect(SOURCE).toContain("stored\n        only for this reminder");
  });

  it("labels the email input and offers one-click delete", () => {
    expect(SOURCE).toContain('htmlFor={`remind-email-${item.event_id}`}');
    expect(SOURCE).toContain('type="email"');
    expect(SOURCE).toContain("Delete reminder");
    expect(SOURCE).toContain("deleteReminderApi(reminder.id, reminder.token)");
  });
});
