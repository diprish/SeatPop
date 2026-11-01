import { describe, expect, it } from "vitest";
import { PreferencesSchema } from "@seatpop/shared";
import type { EventDetailView, RecommendItemView } from "../src/lib/api";
import { computeWhy } from "../src/lib/why";

function testItem(overrides: Partial<RecommendItemView> = {}): RecommendItemView {
  return {
    event_id: "e1",
    title: "Storytime",
    description: null,
    starts_at: "2026-11-07T15:00:00.000Z",
    ends_at: null,
    timezone: "America/Toronto",
    venue_name: "Main Branch",
    venue_lat: 45.42,
    venue_lng: -75.69,
    distance_km: 2.3,
    category: "library",
    status: "scheduled",
    source_url: "https://example.test/e1",
    age_min: 3,
    age_max: 5,
    age_fallback: false,
    age_flag: null,
    price_kind: "free",
    price_label: "Free",
    amount_min_cents: null,
    amount_max_cents: null,
    currency: null,
    accessibility: [],
    language: "English",
    tags: ["music", "crafts"],
    summary_short: null,
    score: 1,
    reason: "Fine (stated)",
    reasonFromModel: true,
    more_dates: [],
    registration_window: null,
    ...overrides,
  };
}

function testDetail(
  overrides: Partial<EventDetailView> = {},
): EventDetailView {
  return {
    id: "e1",
    title: "Storytime",
    description: null,
    starts_at: "2026-11-07T15:00:00.000Z",
    ends_at: null,
    timezone: "America/Toronto",
    venue: null,
    category: "library",
    status: "scheduled",
    source_url: "https://example.test/e1",
    age_min: 3,
    age_max: 5,
    needs_adult: null,
    setting: null,
    energy: null,
    crowd: null,
    duration_min: null,
    language: "English",
    accessibility: [],
    registration_hint: null,
    registration_opens_at: null,
    summary_short: null,
    tags: [],
    price_kind: "free",
    amount_min_cents: null,
    amount_max_cents: null,
    currency: null,
    price_text: null,
    fee_notes: null,
    price_basis: "event_text",
    evidence: {
      age_min: { value: 3, quote: "ages 3 to 5" },
      age_max: { value: 5, quote: "ages 3 to 5" },
      language: { value: "English", quote: "in English" },
    },
    price_evidence_quote: "Free admission",
    siblings: [],
    registration_window: null,
    ...overrides,
  };
}

const PREFS = PreferencesSchema.parse({
  members: [{ age_band: "kids" }],
  max_distance_km: 10,
  fsa: "K2S",
  availability: { sat: ["morning"] },
  language: ["English"],
  interests: ["music"],
});

describe("computeWhy", () => {
  it("matches every field with quotes when the detail is loaded", () => {
    // 15:00Z Nov 7 = 10:00 EST Saturday morning.
    const rows = computeWhy(testItem(), PREFS, testDetail());
    const byField = new Map(rows.map((row) => [row.field, row]));
    expect(byField.get("Age")).toMatchObject({
      detail: "Fits kids",
      quote: "ages 3 to 5",
    });
    expect(byField.get("Price")).toMatchObject({
      detail: "Free",
      quote: "Free admission",
    });
    expect(byField.get("Distance")?.detail).toBe(
      "2.3 km away (limit 10 km from K2S)",
    );
    expect(byField.get("Time")?.detail).toBe("Sat morning — in your windows");
    expect(byField.get("Language")).toMatchObject({
      detail: "English — matches",
      quote: "in English",
    });
    expect(byField.get("Interests")?.detail).toBe("Matches: music");
  });

  it("stays honest without a detail payload or stated ages", () => {
    const item = testItem({
      age_min: null,
      age_max: null,
      age_flag: "check the age group",
      distance_km: null,
      language: null,
      tags: ["chess"],
    });
    const rows = computeWhy(item, PREFS, null);
    const byField = new Map(rows.map((row) => [row.field, row]));
    expect(byField.get("Age")).toMatchObject({
      detail: "No stated ages (check the age group)",
      quote: null,
    });
    expect(byField.has("Distance")).toBe(false);
    expect(byField.get("Language")?.detail).toBe("Unstated — never excludes");
    expect(byField.get("Interests")?.detail).toBe(
      "No tag overlap (ranked lower, not excluded)",
    );
    expect(byField.get("Price")).toMatchObject({ detail: "Free", quote: null });
  });

  it("marks source-policy prices as policy, not listing text", () => {
    const rows = computeWhy(
      testItem({ price_label: "free (per OPL)" }),
      PREFS,
      testDetail({ price_basis: "source_policy", price_evidence_quote: null }),
    );
    expect(rows.find((row) => row.field === "Price")?.detail).toBe(
      "Free · per OPL policy — from the venue's stated policy, not the listing",
    );
  });

  it("explains policy prices from the label when quotes failed to load", () => {
    const rows = computeWhy(
      testItem({ price_label: "free (per OPL)" }),
      PREFS,
      null,
    );
    expect(rows.find((row) => row.field === "Price")).toMatchObject({
      detail:
        "Free · per OPL policy — from the venue's stated policy, not the listing",
      quote: null,
    });
  });

  it("keeps event-text free plain with no policy note", () => {
    const rows = computeWhy(testItem({ price_label: "Free" }), PREFS, null);
    expect(rows.find((row) => row.field === "Price")).toMatchObject({
      detail: "Free",
      quote: null,
    });
  });
});
