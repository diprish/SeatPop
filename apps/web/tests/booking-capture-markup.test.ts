import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for confirmation capture (no DOM harness): the paste
// box warns that PII is discarded, extraction results render with their
// verbatim quotes plus the listed time, and saving needs a confirm tap.
const SOURCE = readFileSync(
  new URL("../src/components/booking-capture.tsx", import.meta.url),
  "utf8",
);

describe("booking capture markup", () => {
  it("warns that pasted PII is discarded", () => {
    expect(SOURCE).toContain("Paste only the confirmation");
    expect(SOURCE).toContain("discarded after reading and never stored");
  });

  it("reviews quotes and the listed time before a confirm tap", () => {
    expect(SOURCE).toContain("Add confirmation");
    expect(SOURCE).toContain("Check before saving");
    expect(SOURCE).toContain("parsed.booking.confirmation_quote");
    expect(SOURCE).toContain("parsed.booking.datetime_quote");
    expect(SOURCE).toContain("Listed time:");
    expect(SOURCE).toContain("Confirm booking");
    expect(SOURCE).toContain("Delete booking");
  });
});
