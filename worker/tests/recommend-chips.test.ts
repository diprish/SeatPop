import { describe, expect, it } from "vitest";
import type { Preferences } from "@seatpop/shared";
import { chipsFor, removeChip } from "../src/recommend/chips";

function prefs(): Preferences {
  return {
    members: [
      { age_band: "kids", include_adjacent: true },
      { age_band: "adults", include_adjacent: true },
    ],
    max_price_cents: 2500,
    free_only: false,
    max_distance_km: 5,
    fsa: "K1S",
    availability: { sat: ["morning"] },
    language: ["English"],
    accessibility: ["wheelchair access"],
    interests: ["music"],
    avoid: ["crowds"],
  };
}

describe("chips", () => {
  it("renders one chip per confirmed fact", () => {
    const labels = chipsFor(prefs()).map((c) => c.label);
    expect(labels).toEqual([
      "kids (6–12)",
      "adults (18–64)",
      "under $25.00",
      "within 5 km of K1S",
      "Sat morning",
      "English",
      "wheelchair access",
      "likes music",
      "avoids crowds",
    ]);
  });

  it("renders free-only and bare-area variants", () => {
    const labels = chipsFor({
      ...prefs(),
      free_only: true,
      max_price_cents: undefined,
      max_distance_km: undefined,
    }).map((c) => c.label);
    expect(labels).toContain("free only");
    expect(labels).toContain("near K1S");
  });

  it("removes facts by key", () => {
    expect(removeChip(prefs(), "member:0").members).toHaveLength(1);
    expect(removeChip(prefs(), "budget").max_price_cents).toBeUndefined();
    // Dropping the area also drops the distance that needs it.
    const noArea = removeChip(prefs(), "fsa");
    expect(noArea.fsa).toBeUndefined();
    expect(noArea.max_distance_km).toBeUndefined();
    expect(removeChip(prefs(), "interests").interests).toEqual([]);
    // Unknown keys leave prefs untouched.
    expect(removeChip(prefs(), "bogus")).toEqual(prefs());
  });
});
