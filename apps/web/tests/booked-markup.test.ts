import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the Booked tab (no DOM harness): per-booking
// download + delete, an honest empty state, and a token-built feed URL
// with a keep-it-private note.
const SOURCE = readFileSync(
  new URL("../src/app/booked/page.tsx", import.meta.url),
  "utf8",
);

describe("booked tab markup", () => {
  it("offers download, delete, and an honest empty state", () => {
    expect(SOURCE).toContain("Download calendar file");
    expect(SOURCE).toContain("Delete booking");
    expect(SOURCE).toContain("Nothing booked yet.");
    expect(SOURCE).toContain('href="/saved"');
  });

  it("builds the feed URL from the device token with a privacy note", () => {
    expect(SOURCE).toContain("/api/bookings/feed?token=${token}");
    expect(SOURCE).toContain("aria-label=\"Family calendar feed URL\"");
    expect(SOURCE).toContain("Keep this URL private");
  });
});
