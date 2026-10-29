import { describe, expect, it } from "vitest";
import { PRICE_KINDS } from "../src/verify";
import { priceDisplayLabel } from "../src/pricing";

describe("price display label", () => {
  it("attributes policy-derived free to the policy owner", () => {
    expect(priceDisplayLabel("free", "source_policy")).toBe("free (per OPL)");
  });

  it("shows event-text free as a plain fact", () => {
    expect(priceDisplayLabel("free", "event_text")).toBe("Free");
  });

  it("never shows a policy-derived value as a plain fact", () => {
    for (const kind of PRICE_KINDS) {
      const label = priceDisplayLabel(kind, "source_policy");
      expect(label).not.toBe("Free");
      expect(label).not.toBe(kind);
      expect(label).toContain("(per OPL)");
    }
  });

  it("passes non-free event-text kinds through unchanged", () => {
    for (const kind of PRICE_KINDS) {
      if (kind === "free") continue;
      expect(priceDisplayLabel(kind, "event_text")).toBe(kind);
    }
  });
});
