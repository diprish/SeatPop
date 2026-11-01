import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceHashFor } from "../src/enrich/vote";
import { rest, type Deps } from "../src/seed-owner-events/run";
import {
  buildOwnerEnrichment,
  buildOwnerPricing,
  currencyForQuote,
  isOwnerRow,
  loadOwnerSeed,
  OWNER_MODEL,
  validateOwnerEvent,
} from "../src/seed-owner-events/seed";

const swimRow = {
  title: "Preschool Swim Lessons",
  venue_name: "Nepean Sportsplex",
  starts_at: "2026-12-05T10:00:00-05:00",
  ends_at: "2026-12-05T10:30:00-05:00",
  price_kind: "paid",
  amount_min_cents: 5000,
  amount_max_cents: 5000,
  price_quote: "Fee: $50.00 per session.",
  ages_quote: "Ages 3 to 5.",
  age_min: 3,
  age_max: 5,
  source_url: "https://ottawa.ca/en/recreation-and-parks/swim-lessons",
  category: "sports",
};

function errorOf(row: unknown): string {
  const checked = validateOwnerEvent(row, 2);
  expect(checked.ok).toBe(false);
  if (checked.ok) throw new Error("expected rejection");
  return checked.error;
}

describe("validateOwnerEvent", () => {
  it("accepts a fully transcribed paid row", () => {
    const checked = validateOwnerEvent(swimRow, 0);
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.event.starts_at).toBe("2026-12-05T15:00:00.000Z");
    expect(checked.event.currency).toBe("CAD");
    expect(checked.event.rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a free row on its free signal", () => {
    const checked = validateOwnerEvent(
      {
        title: "Winter Fun Day",
        venue_name: "City Hall",
        starts_at: "2026-12-01T12:00:00-05:00",
        price_kind: "free",
        price_quote: "Admission is free.",
        source_url: "https://ottawa.ca/en/recreation-and-parks/fun-day",
        category: "community",
      },
      0,
    );
    expect(checked.ok).toBe(true);
  });

  it("accepts month-span ages through the shared months rule", () => {
    const checked = validateOwnerEvent(
      {
        ...swimRow,
        ages_quote: "For babies 0-18 months.",
        age_min: 0,
        age_max: 1,
      },
      0,
    );
    expect(checked.ok).toBe(true);
  });

  it("rejects rows missing the official link", () => {
    expect(errorOf({ ...swimRow, source_url: "" })).toContain("official link");
    expect(errorOf({ ...swimRow, source_url: "   " })).toContain("official link");
  });

  it("rejects non-https links, unzoned times, and bad ranges", () => {
    expect(errorOf({ ...swimRow, source_url: "http://ottawa.ca/x" })).toContain("https");
    expect(errorOf({ ...swimRow, starts_at: "2026-12-05 10:00" })).toContain("timezone");
    expect(
      errorOf({ ...swimRow, ends_at: "2026-12-05T09:00:00-05:00" }),
    ).toContain("after starts_at");
    expect(errorOf({ ...swimRow, category: "swimming" })).toContain("row 2");
    expect(
      errorOf({ ...swimRow, amount_min_cents: 6000, amount_max_cents: 5000 }),
    ).toContain("exceeds");
    expect(errorOf({ ...swimRow, age_min: 6, age_max: 5 })).toContain("exceeds");
  });

  it("rejects ages without a grounding quote", () => {
    const { ages_quote: _dropped, ...noQuote } = swimRow;
    expect(errorOf(noQuote)).toContain("ages_quote");
  });

  it("rejects amounts whose quote lacks digits or currency", () => {
    expect(
      errorOf({ ...swimRow, price_quote: "Pay at the door, cash only." }),
    ).toContain("digits and a currency");
    expect(errorOf({ ...swimRow, price_quote: "Session 3 of 8." })).toContain(
      "digits and a currency",
    );
  });

  it("rejects free without a free signal and ages without digits", () => {
    expect(
      errorOf({
        ...swimRow,
        price_kind: "free",
        amount_min_cents: undefined,
        amount_max_cents: undefined,
        price_quote: "Pay $5 at the door.",
      }),
    ).toContain('does not support price_kind "free"');
    expect(
      errorOf({ ...swimRow, ages_quote: "For school-age children." }),
    ).toContain("ages_quote must contain the age digits");
    expect(
      errorOf({
        ...swimRow,
        ages_quote: "For babies 0-18 months.",
        age_min: 6,
        age_max: 6,
      }),
    ).toContain("ages_quote must contain the age digits");
  });
});

describe("currencyForQuote", () => {
  it("reads explicit tokens, defaults City $ to CAD, null without amounts", () => {
    expect(currencyForQuote("Fee: $50.", true)).toBe("CAD");
    expect(currencyForQuote("Fee: 50 USD.", true)).toBe("USD");
    expect(currencyForQuote("Fee: €50.", true)).toBe("EUR");
    expect(currencyForQuote("Fee: £50.", true)).toBe("GBP");
    expect(currencyForQuote("Admission is free.", false)).toBeNull();
  });
});

describe("owner upsert builders", () => {
  it("marks enrichment owner-transcribed with age evidence", () => {
    const checked = validateOwnerEvent(swimRow, 0);
    if (!checked.ok) throw new Error(checked.error);
    const row = buildOwnerEnrichment(checked.event);
    expect(row.model).toBe(OWNER_MODEL);
    expect(row.confidence).toBe(1);
    expect(row.evidence["age_min"]).toEqual({ value: 3, quote: "Ages 3 to 5." });
    expect(row.evidence["age_max"]).toEqual({ value: 5, quote: "Ages 3 to 5." });
    expect(row.source_hash).toBe(
      sourceHashFor({
        title: swimRow.title,
        description: null,
        venueName: swimRow.venue_name,
        policy: "",
        facets: "",
      }),
    );
  });

  it("stores pricing as event text with the verbatim quote", () => {
    const checked = validateOwnerEvent(swimRow, 0);
    if (!checked.ok) throw new Error(checked.error);
    expect(buildOwnerPricing(checked.event)).toEqual({
      price_kind: "paid",
      amount_min_cents: 5000,
      amount_max_cents: 5000,
      currency: "CAD",
      price_text: "Fee: $50.00 per session.",
      evidence_quote: "Fee: $50.00 per session.",
      fee_notes: null,
      price_basis: "event_text",
    });
  });
});

describe("isOwnerRow", () => {
  it("matches the owner marker only", () => {
    expect(isOwnerRow({ model: OWNER_MODEL })).toBe(true);
    expect(isOwnerRow({ model: null })).toBe(false);
    expect(isOwnerRow({ model: "muse-spark-1.3" })).toBe(false);
  });
});

describe("loadOwnerSeed", () => {
  it("loads the (currently empty) committed seed file", () => {
    expect(loadOwnerSeed()).toEqual([]);
  });
});

describe("rest", () => {
  const deps: Deps = { url: "https://example.test", serviceKey: "k" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves undefined on empty bodies with a compound minimal prefer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(
      rest(deps, "event_sources", "?on_conflict=x", {
        method: "POST",
        body: {},
        prefer: "return=minimal,resolution=merge-duplicates",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("step-1 wiring", () => {
  it("migration 0019 adds the source provenance note", () => {
    const migration = readFileSync(
      new URL("../../supabase/migrations/0019_source_notes.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("alter table public.sources");
    expect(migration).toContain("add column notes text");
  });

  it("enrich selection excludes owner rows in both branches", () => {
    const run = readFileSync(
      new URL("../src/enrich/run.ts", import.meta.url),
      "utf8",
    );
    expect(run.match(/!isOwnerRow\(c\)/g) ?? []).toHaveLength(2);
  });
});
