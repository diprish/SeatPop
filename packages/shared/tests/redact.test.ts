import { describe, expect, it } from "vitest";
import {
  redactAddresses,
  redactBookingPii,
  redactEmails,
  redactPhones,
  redactPii,
  redactPostalCodes,
} from "../src/redact";

describe("pii redaction", () => {
  it("redacts email addresses", () => {
    expect(redactEmails("mail me at alice@example.com please")).toBe(
      "mail me at [email] please",
    );
    expect(redactEmails("no address here")).toBe("no address here");
  });

  it("redacts phone numbers but keeps short digit runs", () => {
    expect(redactPhones("call 613-555-0123 today")).toBe("call [phone] today");
    expect(redactPhones("call (613) 555-0123 today")).toBe(
      "call [phone] today",
    );
    expect(redactPhones("kids aged 6 to 12, budget $25")).toBe(
      "kids aged 6 to 12, budget $25",
    );
  });

  it("redacts full postal codes but keeps FSAs", () => {
    expect(redactPostalCodes("we live at K1S 0A1")).toBe(
      "we live at [postal code]",
    );
    expect(redactPostalCodes("we live at K1S0A1")).toBe(
      "we live at [postal code]",
    );
    expect(redactPostalCodes("near K1S")).toBe("near K1S");
  });

  it("applies all redactors together", () => {
    expect(
      redactPii("Alice alice@example.com 613-555-0123 K1S 0A1, two kids"),
    ).toBe("Alice [email] [phone] [postal code], two kids");
  });

  it("redacts street addresses but keeps non-address text", () => {
    expect(redactAddresses("Visit us at 123 Main St, Ottawa")).toBe(
      "Visit us at [address], Ottawa",
    );
    expect(redactAddresses("456 oak ave, suite 9")).toBe(
      "[address], suite 9",
    );
    expect(redactAddresses("Section 5, Row 12, Seat 3")).toBe(
      "Section 5, Row 12, Seat 3",
    );
    expect(redactAddresses("Confirmation ABC123 for March 8")).toBe(
      "Confirmation ABC123 for March 8",
    );
  });

  it("redacts everything for confirmation pastes", () => {
    expect(
      redactBookingPii(
        "Hi alice@example.com, call 613-555-0123, 123 Main St K1S 0A1",
      ),
    ).toBe("Hi [email], call [phone], [address] [postal code]");
  });
});
