import { describe, expect, it } from "vitest";
import { ENRICHED_FIELDS, type EnrichedField } from "@seatpop/llm";
import type { VerifiedValue } from "../src/enrich/vote";
import {
  applyFacetAges,
  applyPricingPolicy,
  type SourcePolicy,
} from "../src/enrich/policy";

function values(
  overrides: Partial<Record<EnrichedField, VerifiedValue>> = {},
): Record<EnrichedField, VerifiedValue> {
  const out = {} as Record<EnrichedField, VerifiedValue>;
  for (const field of ENRICHED_FIELDS) {
    out[field] = field === "price_kind" ? "unknown" : null;
  }
  return { ...out, ...overrides };
}

const FREE_POLICY: SourcePolicy = {
  kind: "free",
  quote: "These programs are free.",
  url: "https://example.test/policy",
  scope: null,
};

const SCOPED_POLICY: SourcePolicy = {
  ...FREE_POLICY,
  scope: ["Baby", "Child"],
};

describe("pricing policy", () => {
  it("keeps event values without a policy", () => {
    const out = applyPricingPolicy(values(), null, null, []);
    expect(out).toEqual({
      priceKind: "unknown",
      evidenceQuote: null,
      basis: "event_text",
      applied: false,
    });
  });

  it("applies an unscoped policy to signal-free events", () => {
    const out = applyPricingPolicy(values(), null, FREE_POLICY, ["Adult"]);
    expect(out).toEqual({
      priceKind: "free",
      evidenceQuote: "These programs are free.",
      basis: "source_policy",
      applied: true,
    });
  });

  it("lets any event fee signal override the policy", () => {
    const paid = applyPricingPolicy(
      values({ price_kind: "paid" }),
      "$15",
      FREE_POLICY,
      [],
    );
    expect(paid.basis).toBe("event_text");
    expect(paid.priceKind).toBe("paid");
    const amounts = applyPricingPolicy(
      values({ amount_min_cents: 1500 }),
      null,
      FREE_POLICY,
      [],
    );
    expect(amounts.applied).toBe(false);
    expect(amounts.priceKind).toBe("unknown");
    const text = applyPricingPolicy(
      values({ price_text: "$15" }),
      null,
      FREE_POLICY,
      [],
    );
    expect(text.applied).toBe(false);
  });

  it("scopes policies to overlapping facet labels", () => {
    expect(
      applyPricingPolicy(values(), null, SCOPED_POLICY, ["Child"]).applied,
    ).toBe(true);
    expect(
      applyPricingPolicy(values(), null, SCOPED_POLICY, ["Adult"]).applied,
    ).toBe(false);
    expect(applyPricingPolicy(values(), null, SCOPED_POLICY, []).applied).toBe(
      false,
    );
    expect(
      applyPricingPolicy(
        values(),
        null,
        { ...FREE_POLICY, scope: [] },
        [],
      ).applied,
    ).toBe(true);
  });
});

describe("facet ages", () => {
  it("prefers text-verified ages over facets", () => {
    expect(applyFacetAges(3, 5, ["Adults 50-plus"])).toEqual({
      ageMin: 3,
      ageMax: 5,
      labels: ["Adults 50-plus"],
    });
  });

  it("sets ages from unanimous digit-bearing facets", () => {
    expect(applyFacetAges(null, null, ["Adults 50-plus"])).toEqual({
      ageMin: 50,
      ageMax: null,
      labels: ["Adults 50-plus"],
    });
  });

  it("stores digitless labels without setting ages", () => {
    expect(applyFacetAges(null, null, ["Teen", "Adult"])).toEqual({
      ageMin: null,
      ageMax: null,
      labels: ["Teen", "Adult"],
    });
  });

  it("constrains nothing on conflicting digit facets", () => {
    expect(
      applyFacetAges(null, null, ["Adults 50-plus", "Ages 3 to 5"]),
    ).toEqual({
      ageMin: null,
      ageMax: null,
      labels: ["Adults 50-plus", "Ages 3 to 5"],
    });
  });
});
