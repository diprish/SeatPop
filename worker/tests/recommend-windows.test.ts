import { describe, expect, it } from "vitest";
import {
  matchWindow,
  type RegistrationWindow,
} from "../src/recommend/windows";

// Synthetic fixtures only (Testville, 2031): never real City dates.
function window(overrides: Partial<RegistrationWindow> = {}): RegistrationWindow {
  return {
    scope: "Testville Aquatics",
    kind: "swimming",
    opens_at: "2031-03-04T19:00:00-05:00",
    opens_date_only: false,
    quote: "Registration opens March 4 at 7 pm.",
    source_url: "https://example.test/registration",
    ...overrides,
  };
}

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
    expect(matchWindow([late, early], ["Testville Aquatics"], NOW)).toEqual(
      early,
    );
  });

  it("hides past and invalid windows", () => {
    const past = window({ opens_at: "2030-03-04T19:00:00-05:00" });
    expect(matchWindow([past], ["Testville Aquatics"], NOW)).toBeNull();
    const invalid = window({ opens_at: "not a date" });
    expect(matchWindow([invalid], ["Testville Aquatics"], NOW)).toBeNull();
  });

  it("ignores kind when matching (kind is display-only)", () => {
    const other = window({ kind: "camps" });
    expect(matchWindow([other], ["Testville Aquatics"], NOW)).toEqual(other);
  });
});
