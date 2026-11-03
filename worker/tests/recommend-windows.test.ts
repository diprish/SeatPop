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

/** A session-labeled opening like the City's winter registration. */
function winterWindow(): RegistrationWindow {
  return window({
    opens_at: "2031-02-01T21:00:00-05:00",
    quote: "All winter activities February 1 at 9 pm.",
    label: "All winter activities",
  });
}

describe("matchWindow", () => {
  // A course starting after every fixture opening; sessionless windows
  // ask only timing, so no season word is needed.
  const course = {
    title: "Testville Pottery Basics",
    category: "arts",
    starts_at: "2031-04-10T10:00:00-05:00",
    description: null,
  };

  it("matches scope against source names, case-insensitively", () => {
    expect(matchWindow([window()], ["testville aquatics"], NOW, course)).toEqual(
      window(),
    );
    expect(
      matchWindow([window()], ["  Testville Aquatics "], NOW, course),
    ).toEqual(window());
    expect(matchWindow([window()], ["Other Source"], NOW, course)).toBeNull();
    expect(matchWindow([window()], [], NOW, course)).toBeNull();
  });

  it("picks the soonest upcoming opening among matches", () => {
    const early = window({ opens_at: "2031-02-01T09:00:00-05:00" });
    const late = window({ opens_at: "2031-03-04T19:00:00-05:00" });
    expect(matchWindow([late, early], SOURCES, NOW, course)).toEqual(early);
  });

  it("hides past and invalid windows", () => {
    const past = window({ opens_at: "2030-03-04T19:00:00-05:00" });
    expect(matchWindow([past], SOURCES, NOW, course)).toBeNull();
    const invalid = window({ opens_at: "not a date" });
    expect(matchWindow([invalid], SOURCES, NOW, course)).toBeNull();
  });

  it("returns only registration openings, never viewing notices", () => {
    const notice = window({
      kind: "listings_visible",
      opens_at: "2031-02-01T09:00:00-05:00",
      quote: "View online February 1.",
    });
    const opening = window({ opens_at: "2031-03-04T19:00:00-05:00" });
    expect(matchWindow([notice, opening], SOURCES, NOW, course)).toEqual(
      opening,
    );
    expect(matchWindow([notice], SOURCES, NOW, course)).toBeNull();
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
    // Both labels name the winter session, so both events claim it
    // and start after the later opening; routing still decides.
    const swimEvent = {
      title: "Winter Preschool Swim Lessons",
      category: "sports",
      starts_at: "2031-04-10T10:00:00-05:00",
      description: null,
    };
    expect(matchWindow([general, swim], SOURCES, NOW, swimEvent)).toEqual(swim);
    const artEvent = {
      title: "Winter Pottery Night",
      category: "arts",
      starts_at: "2031-04-10T10:00:00-05:00",
      description: null,
    };
    expect(matchWindow([general, swim], SOURCES, NOW, artEvent)).toEqual(general);
  });

  it("reads swim from the category too, and falls back to general", () => {
    const swim = window({ label: "Swim registration" });
    const general = window({
      opens_at: "2031-04-01T09:00:00-05:00",
      label: "All activities",
    });
    const laps = {
      title: "Morning Laps",
      category: "swim",
      starts_at: "2031-05-01T07:00:00-05:00",
      description: null,
    };
    expect(matchWindow([general, swim], SOURCES, NOW, laps)).toEqual(swim);
    // A swim event with no swim window still gets the general one.
    expect(
      matchWindow([general], SOURCES, NOW, { ...laps, category: "sports" }),
    ).toEqual(general);
    // Without event info nothing can prove timing, so no badge at all.
    expect(matchWindow([general, swim], SOURCES, NOW)).toBeNull();
    expect(matchWindow([swim], SOURCES, NOW)).toBeNull();
  });

  it("shows the badge with its quote and link for a course starting after the opening", () => {
    const opening = window();
    const course = {
      title: "Testville Pottery Basics",
      category: "arts",
      starts_at: "2031-04-10T10:00:00-05:00",
      description: null,
    };
    const matched = matchWindow([opening], SOURCES, NOW, course);
    expect(matched).toEqual(opening);
    expect(matched?.quote).toBe("Registration opens March 4 at 7 pm.");
    expect(matched?.source_url).toBe("https://example.test/registration");
  });

  it("hides the badge for an in-progress course even when its session date falls after the opening", () => {
    // A session-date row of a fall course: February 5 is after the
    // February 1 winter opening, but the row never claims the winter
    // session, so the winter badge must not show.
    const fallCourse = {
      title: "Testville Skating Level 1",
      category: "sports",
      starts_at: "2031-02-05T15:30:00-05:00",
      description: "Fall session, weekly since October.",
    };
    expect(matchWindow([winterWindow()], SOURCES, NOW, fallCourse)).toBeNull();
    // A different season word does not qualify either.
    const swimCourse = {
      title: "Fall Swim Basics",
      category: "sports",
      starts_at: "2031-03-10T10:00:00-05:00",
      description: null,
    };
    expect(matchWindow([winterWindow()], SOURCES, NOW, swimCourse)).toBeNull();
  });

  it("shows a session-labeled window when the event names the session", () => {
    const winterCourse = {
      title: "Winter Swim Basics",
      category: "sports",
      starts_at: "2031-03-10T10:00:00-05:00",
      description: null,
    };
    expect(matchWindow([winterWindow()], SOURCES, NOW, winterCourse)).toEqual(
      winterWindow(),
    );
    // The session word may live in the description instead.
    const described = {
      title: "Swim Basics",
      category: "sports",
      starts_at: "2031-03-10T10:00:00-05:00",
      description: "Winter session: ten weekly lessons.",
    };
    expect(matchWindow([winterWindow()], SOURCES, NOW, described)).toEqual(
      winterWindow(),
    );
  });

  it("shows no badge when event timing is unknown or already past", () => {
    const opening = window();
    // No event info: cannot tell.
    expect(matchWindow([opening], SOURCES, NOW)).toBeNull();
    // No usable start: cannot tell.
    expect(
      matchWindow([opening], SOURCES, NOW, {
        title: "Testville Pottery Basics",
        category: "arts",
        starts_at: "not a date",
        description: null,
      }),
    ).toBeNull();
    // Already begun before the opening: no badge.
    expect(
      matchWindow([opening], SOURCES, NOW, {
        title: "Testville Pottery Basics",
        category: "arts",
        starts_at: "2031-02-01T10:00:00-05:00",
        description: null,
      }),
    ).toBeNull();
  });
});
