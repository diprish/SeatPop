import { describe, expect, it } from "vitest";
import {
  bookingCreateError,
  reminderCreateError,
  voteCreateError,
} from "../src/lib/create-errors";

describe("reminderCreateError", () => {
  const cases: Array<[string, number]> = [
    ["invalid_email", 400],
    ["invalid_basis", 400],
    ["invalid_token", 400],
    ["unknown_event", 404],
    ["past_remind_at", 400],
    ["per_email_cap", 429],
    ["global_cap", 429],
    ["duplicate", 409],
  ];
  it.each(cases)("maps %s to HTTP %i with a message", (code, status) => {
    const mapped = reminderCreateError(code);
    expect(mapped.status).toBe(status);
    expect(mapped.message.length).toBeGreaterThan(0);
  });

  it("fails closed on unknown codes", () => {
    expect(reminderCreateError("something_new")).toEqual({
      status: 500,
      message: "reminder failed",
    });
  });
});

describe("bookingCreateError", () => {
  const cases: Array<[string, number]> = [
    ["invalid_token", 400],
    ["invalid_confirmation", 400],
    ["unknown_event", 404],
    ["feed_cap", 400],
    ["duplicate", 409],
  ];
  it.each(cases)("maps %s to HTTP %i with a message", (code, status) => {
    const mapped = bookingCreateError(code);
    expect(mapped.status).toBe(status);
    expect(mapped.message.length).toBeGreaterThan(0);
  });

  it("fails closed on unknown codes", () => {
    expect(bookingCreateError("something_new")).toEqual({
      status: 500,
      message: "booking failed",
    });
  });
});

describe("voteCreateError", () => {
  const cases: Array<[string, number]> = [
    ["invalid_series", 400],
    ["invalid_voter", 400],
    ["invalid_vote", 400],
    ["invalid_tags", 400],
    ["unknown_event", 404],
    ["voter_cap", 429],
    ["global_cap", 429],
  ];
  it.each(cases)("maps %s to HTTP %i with a message", (code, status) => {
    const mapped = voteCreateError(code);
    expect(mapped.status).toBe(status);
    expect(mapped.message.length).toBeGreaterThan(0);
  });

  it("fails closed on unknown codes", () => {
    expect(voteCreateError("something_new")).toEqual({
      status: 500,
      message: "vote failed",
    });
  });
});
