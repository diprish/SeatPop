import { describe, expect, it } from "vitest";
import {
  buildEventIcs,
  buildFeedIcs,
  escapeIcsText,
  foldIcsLine,
  resolveIcsTimes,
  toIcsUtc,
} from "../src/ics";

describe("escapeIcsText", () => {
  it("escapes RFC 5545 specials and newlines", () => {
    expect(escapeIcsText("A;B,C\\D\nE")).toBe("A\\;B\\,C\\\\D\\nE");
    expect(escapeIcsText("plain")).toBe("plain");
  });
});

describe("foldIcsLine", () => {
  it("folds past 75 octets with space continuations", () => {
    expect(foldIcsLine("A".repeat(80))).toBe(
      `${"A".repeat(75)}\r\n ${"A".repeat(5)}`,
    );
    expect(foldIcsLine("short")).toBe("short");
  });

  it("never splits multi-byte characters", () => {
    // 40 × é at 2 bytes: 37 chars (74 bytes), then 3 chars.
    expect(foldIcsLine("é".repeat(40))).toBe(
      `${"é".repeat(37)}\r\n ${"é".repeat(3)}`,
    );
  });
});

describe("toIcsUtc", () => {
  it("formats UTC instants and rejects junk", () => {
    expect(toIcsUtc("2031-03-08T15:00:00.000Z")).toBe("20310308T150000Z");
    expect(toIcsUtc("2031-03-08T10:00:00-05:00")).toBe("20310308T150000Z");
    expect(() => toIcsUtc("whenever")).toThrow();
  });
});

describe("buildEventIcs", () => {
  it("renders an exact VEVENT block", () => {
    expect(
      buildEventIcs(
        {
          uid: "b1@seatpop",
          summary: "Storytime, Saturday",
          start: "2031-03-08T15:00:00.000Z",
          end: "2031-03-08T16:00:00.000Z",
          location: "Main Branch",
          description: "Confirmation ABC123",
          url: "https://example.test/e1",
        },
        "2031-01-01T00:00:00.000Z",
      ),
    ).toBe(
      [
        "BEGIN:VEVENT",
        "UID:b1@seatpop",
        "DTSTAMP:20310101T000000Z",
        "DTSTART:20310308T150000Z",
        "DTEND:20310308T160000Z",
        "SUMMARY:Storytime\\, Saturday",
        "LOCATION:Main Branch",
        "DESCRIPTION:Confirmation ABC123",
        "URL:https://example.test/e1",
        "END:VEVENT",
      ].join("\r\n"),
    );
  });

  it("omits empty optional properties", () => {
    const ics = buildEventIcs(
      {
        uid: "b1@seatpop",
        summary: "Storytime",
        start: "2031-03-08T15:00:00.000Z",
        end: null,
        location: null,
        description: null,
        url: null,
      },
      "2031-01-01T00:00:00.000Z",
    );
    expect(ics).not.toContain("DTEND");
    expect(ics).not.toContain("LOCATION");
    expect(ics).not.toContain("DESCRIPTION");
    expect(ics).not.toContain("URL:");
  });
});

describe("buildFeedIcs", () => {
  it("wraps events in a VCALENDAR, empty or not", () => {
    const empty = buildFeedIcs([], "2031-01-01T00:00:00.000Z");
    expect(empty).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//SeatPop//Bookings//EN",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    const full = buildFeedIcs(
      [
        {
          uid: "b1@seatpop",
          summary: "Storytime",
          start: "2031-03-08T15:00:00.000Z",
          end: null,
        },
      ],
      "2031-01-01T00:00:00.000Z",
    );
    expect(full).toContain("BEGIN:VEVENT");
    expect(full).toContain("UID:b1@seatpop");
  });
});

describe("resolveIcsTimes", () => {
  it("keeps the listed end only when the parsed start agrees", () => {
    expect(resolveIcsTimes(null, "2031-03-08T15:00:00.000Z", "2031-03-08T16:00:00.000Z")).toEqual({
      start: "2031-03-08T15:00:00.000Z",
      end: "2031-03-08T16:00:00.000Z",
    });
    // Same instant, different spelling: end still applies.
    expect(
      resolveIcsTimes(
        "2031-03-08T10:00:00-05:00",
        "2031-03-08T15:00:00.000Z",
        "2031-03-08T16:00:00.000Z",
      ),
    ).toEqual({
      start: "2031-03-08T10:00:00-05:00",
      end: "2031-03-08T16:00:00.000Z",
    });
    // A mismatch-saved booking keeps no borrowed end time.
    expect(
      resolveIcsTimes(
        "2031-03-15T15:00:00.000Z",
        "2031-03-08T15:00:00.000Z",
        "2031-03-08T16:00:00.000Z",
      ),
    ).toEqual({ start: "2031-03-15T15:00:00.000Z", end: null });
    // Invalid parsed times fall back to the listed pair.
    expect(
      resolveIcsTimes("whenever", "2031-03-08T15:00:00.000Z", "2031-03-08T16:00:00.000Z"),
    ).toEqual({
      start: "2031-03-08T15:00:00.000Z",
      end: "2031-03-08T16:00:00.000Z",
    });
  });
});
