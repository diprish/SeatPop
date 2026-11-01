import { describe, expect, it } from "vitest";
import {
  matchWindow,
  type RegistrationWindow,
} from "../src/recommend/windows";

// Synthetic fixtures only (Testville, 2031): never real City dates.
function window(overrides: Partial<RegistrationWindow> = {}): RegistrationWindow {
  return {
    scope: "Testville Aquatics",
    kind: "registration_opens",
    opens_at: "2031-03-04T19:00:00-05:00",
    opens_date_only: false,
    quote: "Registration opens March 4 at 7 pm.",
    source_url: "https://example.test/registration",
    label: null,
    ...overrides,
  };
}

const SOURCES = ["Testville Aquatics"];
const NOW = Date.parse("2031-01-15T12:00:00Z");

describe("matchWindow", () => {
  it("matches scope against source names, case-insensitively", () => {
    expect(matchWindow([window()], ["testville aquatics"], NOW)).toEqual(
      window(),
    );
    expect(matchWindow([window()], ["  Testville Aquatics "], NOW)).toEqual(
      window(),
    );
    expect(matchWindow([window()], ["Other Source"], NOW)).toBeNull();
    expect(matchWindow([window()], [], NOW)).toBeNull();
  });

  it("picks the soonest upcoming opening among matches", () => {
    const early = window({ opens_at: "2031-02-01T09:00:00-05:00" });
    const late = window({ opens_at: "2031-03-04T19:00:00-05:00" });
    expect(matchWindow([late, early], SOURCES, NOW)).toEqual(early);
  });

  it("hides past and invalid windows", () => {
    const past = window({ opens_at: "2030-03-04T19:00:00-05:00" });
    expect(matchWindow([past], SOURCES, NOW)).toBeNull();
    const invalid = window({ opens_at: "not a date" });
    expect(matchWindow([invalid], SOURCES, NOW)).toBeNull();
  });

  it("returns only registration openings, never viewing notices", () => {
    const notice = window({
      kind: "listings_visible",
      opens_at: "2031-02-01T09:00:00-05:00",
      quote: "View online February 1.",
    });
    const opening = window({ opens_at: "2031-03-04T19:00:00-05:00" });
    expect(matchWindow([notice, opening], SOURCES, NOW)).toEqual(opening);
    expect(matchWindow([notice], SOURCES, NOW)).toBeNull();
  });

  it("matches swim-labeled windows to swim events only", () => {
    const swim = window({
      opens_at: "2031-02-01T09:00:00-05:00",
      label: "All winter swimming activities",
    });
    const general = window({
      opens_at: "2031-03-04T19:00:00-05:00",
      label: "All winter activities",
    });
    const swimEvent = { title: "Preschool Swim Lessons", category: "sports" };
    expect(matchWindow([general, swim], SOURCES, NOW, swimEvent)).toEqual(swim);
    const artEvent = { title: "Pottery Night", category: "arts" };
    expect(matchWindow([general, swim], SOURCES, NOW, artEvent)).toEqual(general);
  });

  it("reads swim from the category too, and falls back to general", () => {
    const swim = window({ label: "Swim registration" });
    const general = window({
      opens_at: "2031-04-01T09:00:00-05:00",
      label: "All activities",
    });
    expect(
      matchWindow([general, swim], SOURCES, NOW, {
        title: "Morning Laps",
        category: "swim",
      }),
    ).toEqual(swim);
    // A swim event with no swim window still gets the general one.
    expect(
      matchWindow([general], SOURCES, NOW, {
        title: "Morning Laps",
        category: "sports",
      }),
    ).toEqual(general);
    // Without event info a swim window cannot prove its audience.
    expect(matchWindow([general, swim], SOURCES, NOW)).toEqual(general);
    expect(matchWindow([swim], SOURCES, NOW)).toBeNull();
  });
});
