import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static guarantees on migrations 0008-0011: RLS + owner-only user data,
// no PII columns, public home areas, and a recommend_candidates() carrying
// every hard constraint. Tables/seeds live in 0008; the function was fixed
// in 0009 (explicit SRF column aliases) and 0010 (facet regex), so function
// tests read 0010, the live definition. 0011 is a data-only fee-noise
// repair. Behavioral proof comes from the live recommend eval (TS mirror
// re-checks returned rows).
const SQL8 = readFileSync(
  new URL("../../supabase/migrations/0008_households.sql", import.meta.url),
  "utf8",
);
const SQL10 = readFileSync(
  new URL(
    "../../supabase/migrations/0010_recommend_facet_pattern.sql",
    import.meta.url,
  ),
  "utf8",
);
const SQL11 = readFileSync(
  new URL(
    "../../supabase/migrations/0011_clear_bogus_fee_notes.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("migration 0008 tables", () => {
  it("enables RLS on all five tables with owner-only user policies", () => {
    const rls = SQL8.match(/enable row level security/g) ?? [];
    expect(rls).toHaveLength(5);
    const policies = SQL8.match(/create policy /g) ?? [];
    expect(policies).toHaveLength(11);
    for (const table of [
      "households",
      "members",
      "preferences",
      "feedback",
      "home_area",
    ]) {
      expect(SQL8).toContain(`alter table public.${table} enable row level security`);
    }
    // User tables gate on auth.uid(); the reference table reads publicly.
    expect(SQL8).toContain("auth.uid() = user_id");
    expect(SQL8).toContain("h.user_id = auth.uid()");
    expect(SQL8).toContain("home_area_public_read");
    expect(SQL8).toContain("grant select on public.home_area to anon, authenticated");
  });

  it("stores bands and coarse areas only — no PII columns", () => {
    expect(SQL8).toContain("age_band in (");
    for (const band of ["baby", "preschool", "kids", "teens", "adults", "seniors"]) {
      expect(SQL8).toContain(`'${band}'`);
    }
    expect(SQL8).toContain("include_adjacent boolean not null default true");
    expect(SQL8).toContain("home_fsa text references public.home_area (fsa)");
    // No column may hold a name, birth date, full postal code, address,
    // phone, or email. (Matched at line starts so comments mentioning
    // "street addresses" do not trip the check.)
    const forbidden =
      /^\s*(first_name|last_name|full_name|birth_date|date_of_birth|postal_code|phone|email|street|address)\b/mi;
    expect(SQL8).not.toMatch(forbidden);
  });

  it("constrains feedback to the three verdicts with a reason", () => {
    expect(SQL8).toContain("value in ('saved', 'dismissed', 'not_for_us')");
    expect(SQL8).toContain("reason text");
    expect(SQL8).toContain("unique (user_id, event_id)");
  });

  it("seeds Ottawa-area K FSAs with centroids in bounds", () => {
    const seeds = [
      ...SQL8.matchAll(
        /insert into public\.home_area[^;]*values \('([A-Z0-9]+)',\s*([0-9.-]+),\s*([0-9.-]+)/g,
      ),
    ];
    // At least one verified GeoNames seed row (lands with the extract).
    expect(seeds.length).toBeGreaterThan(0);
    for (const [, fsa, lat, lng] of seeds) {
      expect(fsa).toMatch(/^K[0-9][A-Z]$/);
      // Generous Ottawa-area bbox (city + surrounding K countryside).
      expect(Number(lat)).toBeGreaterThanOrEqual(44.5);
      expect(Number(lat)).toBeLessThanOrEqual(46.0);
      expect(Number(lng)).toBeGreaterThanOrEqual(-77.0);
      expect(Number(lng)).toBeLessThanOrEqual(-74.5);
    }
  });
});

describe("recommend_candidates()", () => {
  const fn = SQL10.slice(
    SQL10.indexOf("create or replace function public.recommend_candidates"),
  );

  it("is a locked-down invoker-safe function open to guests", () => {
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public");
    expect(SQL10).toContain(
      "grant execute on function public.recommend_candidates(jsonb, int)",
    );
    expect(SQL10).toContain("to anon, authenticated");
  });

  it("extracts facets with single backslashes", () => {
    // The regex value must be `\(([^)]+)\)$` (literal parens). Double
    // backslashes match a literal backslash under conforming strings,
    // so the facet never extracts and scoped policies silently die.
    expect(fn).toContain("substring(s.name from '\\(([^)]+)\\)$')");
    expect(fn).not.toContain("\\\\(");
  });

  it("gives every set-returning function an explicit column alias", () => {
    // A bare `as part` does NOT name the output column: the unqualified
    // name then resolves to an outer column of the same name (or a
    // whole-row record), silently breaking the predicate. This exact bug
    // passed weekday-only time filtering in 0008 (14 live violations).
    for (const alias of [
      "as m(member)",
      "as part(listed)",
      "as req(needed)",
      "as want(wanted)",
      "as x(stated)",
    ]) {
      expect(fn).toContain(alias);
    }
    expect(fn).not.toMatch(/\) as (m|part|req|want|x)\s*[^ (]/);
  });

  it("filters age fit per member with adjacent expansion", () => {
    for (const fragment of [
      "member_ranges",
      "include_adjacent",
      "eff_min <= r.bhi",
      "eff_max >= r.blo",
    ]) {
      expect(fn).toContain(fragment);
    }
  });

  it("falls back to category ages and flags the guess", () => {
    expect(fn).toContain("when 'camps' then 5");
    expect(fn).toContain("when 'camps' then 17");
    expect(fn).toContain("age_fallback");
    expect(fn).toContain("'check the age group'");
  });

  it("filters haversine distance with null-safe endpoints", () => {
    for (const fragment of ["6371", "asin", "radians", "max_distance_km", "home.lat is null"]) {
      expect(fn).toContain(fragment);
    }
  });

  it("filters locale-proof weekday and part-of-day windows", () => {
    for (const fragment of [
      "isodow",
      "'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'",
      "'morning'",
      "'afternoon'",
      "'evening'",
      "'night'",
      "availability",
    ]) {
      expect(fn).toContain(fragment);
    }
  });

  it("filters budget with policy-free, unknown, and amount rules", () => {
    for (const fragment of [
      "free_only",
      "max_price_cents",
      "amount_min_cents <=",
      "pricing_policy_scope",
      "(per OPL)",
      "'Free'",
      "'price not stated'",
    ]) {
      expect(fn).toContain(fragment);
    }
  });

  it("filters accessibility, language, status, and future start", () => {
    for (const fragment of [
      "p.accessibility",
      "p.language is null",
      "not in ('cancelled', 'full')",
      "starts_at > now()",
    ]) {
      expect(fn).toContain(fragment);
    }
  });

  it("returns soonest-first with a clamped limit", () => {
    expect(fn).toContain("order by p.starts_at asc");
    expect(fn).toContain("least(coalesce(p_limit, 200), 500)");
  });

  it("closes its dollar-quoted body exactly once", () => {
    // An unclosed body fails db push with "unterminated dollar-quoted
    // string" and rolls the whole migration back.
    expect(SQL10.match(/\$\$/g)).toHaveLength(2);
    expect(fn).toContain("500));\n$$;");
  });
});

describe("migration 0011 fee-noise repair", () => {
  it("clears only the exact bogus supplies sentence", () => {
    expect(SQL11).toContain("set fee_notes = null");
    expect(SQL11).toContain(
      "we have all the supplies you need to satisfy your creativity!",
    );
    // A single targeted UPDATE: no schema change, no other column.
    expect(SQL11.match(/update /g)).toHaveLength(1);
    expect(SQL11).not.toMatch(/alter table|create table|drop /i);
  });
});
