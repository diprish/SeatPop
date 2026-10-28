import { describe, expect, it } from "vitest";
import { isValidTimeZone, zonedLocalToUtc } from "../src/ingest/tz";

describe("timezone", () => {
  it("converts winter wall time at EST", () => {
    expect(
      zonedLocalToUtc(
        { year: 2026, month: 1, day: 15, hour: 19, minute: 0 },
        "America/Toronto",
      ),
    ).toBe("2026-01-16T00:00:00.000Z");
  });

  it("converts summer wall time at EDT", () => {
    expect(
      zonedLocalToUtc(
        { year: 2026, month: 7, day: 15, hour: 19, minute: 0 },
        "America/Toronto",
      ),
    ).toBe("2026-07-15T23:00:00.000Z");
  });

  it("rejects invalid zones", () => {
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("Customized Time Zone")).toBe(false);
    expect(() =>
      zonedLocalToUtc(
        { year: 2026, month: 1, day: 1, hour: 0, minute: 0 },
        "Nope/Nowhere",
      ),
    ).toThrow();
  });
});
