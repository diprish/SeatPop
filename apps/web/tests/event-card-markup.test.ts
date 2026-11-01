import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Static pins for the registration badge on event cards. */

const card = readFileSync(
  new URL("../src/components/event-card.tsx", import.meta.url),
  "utf8",
);

describe("event card registration badge", () => {
  it("renders the badge from the attached window, hidden when absent", () => {
    expect(card).toContain("formatRegistrationBadge(");
    expect(card).toContain("item.registration_window && badge");
  });

  it("links the verbatim quote to the City page, never truncated", () => {
    expect(card).toContain("href={item.registration_window.source_url}");
    expect(card).toContain("{item.registration_window.quote}");
    expect(card).not.toContain("truncateQuote");
    expect(card).not.toContain("City page");
  });
});
