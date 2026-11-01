import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static guarantees on migrations 0008-0017: RLS + owner-only user data,
// no PII columns, public home areas, and a recommend_candidates() carrying
// every hard constraint. Tables/seeds live in 0008; the function was fixed
// in 0009 (explicit SRF column aliases) and 0010 (facet regex), so function
// tests read 0010, the live definition. 0011 is a data-only fee-noise
// repair; 0012 widens the public view with evidence quotes; 0013 defaults
// owner ids. Behavioral proof comes from the live recommend eval (TS
// mirror re-checks returned rows).
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
const SQL12 = readFileSync(
  new URL("../../supabase/migrations/0012_public_evidence.sql", import.meta.url),
  "utf8",
);
const SQL13 = readFileSync(
  new URL(
    "../../supabase/migrations/0013_user_id_defaults.sql",
    import.meta.url,
  ),
  "utf8",
);
const SQL14 = readFileSync(
  new URL(
    "../../supabase/migrations/0014_registration_windows.sql",
    import.meta.url,
  ),
  "utf8",
);
const SQL15 = readFileSync(
  new URL("../../supabase/migrations/0015_reminders.sql", import.meta.url),
  "utf8",
);
const SQL16 = readFileSync(
  new URL("../../supabase/migrations/0016_bookings.sql", import.meta.url),
  "utf8",
);
const SQL17 = readFileSync(
  new URL("../../supabase/migrations/0017_feed_end_times.sql", import.meta.url),
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

describe("migration 0012 public evidence", () => {
  it("adds the two quote columns and keeps the rest internal", () => {
    expect(SQL12).toContain("create or replace view public.public_events");
    expect(SQL12).toContain("en.evidence");
    expect(SQL12).toContain("pr.evidence_quote");
    expect(SQL12).toContain("pr.price_basis");
    expect(SQL12).not.toMatch(/en\.(embedding|model|prompt_version|source_hash|confidence)/);
  });
});

describe("migration 0013 user id defaults", () => {
  it("defaults owner ids to auth.uid() on both tables", () => {
    expect(SQL13).toContain(
      "alter table public.households alter column user_id set default auth.uid()",
    );
    expect(SQL13).toContain(
      "alter table public.feedback alter column user_id set default auth.uid()",
    );
  });
});

describe("migration 0014 registration windows", () => {
  it("stores transcribed windows with quote, link, and exact instant", () => {
    expect(SQL14).toContain("create table public.registration_windows");
    for (const column of [
      "scope text not null",
      "kind text not null",
      "opens_at timestamptz not null",
      "opens_date_only boolean not null",
      "quote text not null",
      "source_url text not null",
    ]) {
      expect(SQL14).toContain(column);
    }
    expect(SQL14).toContain("source_url like 'https://%'");
    expect(SQL14).toContain("unique (scope, kind, opens_at, opens_date_only)");
  });

  it("is public-read, service-role-write like home_area", () => {
    expect(SQL14).toContain(
      "alter table public.registration_windows enable row level security",
    );
    expect(SQL14).toContain(
      "create policy registration_windows_public_read on public.registration_windows",
    );
    expect(SQL14).toContain(
      "grant select on public.registration_windows to anon, authenticated",
    );
    expect(SQL14).not.toMatch(/for (insert|update|delete) to /);
  });

  it("maps events to source names without exposing event_sources", () => {
    expect(SQL14).toContain("create view public.public_event_sources");
    expect(SQL14).toContain("es.event_id as event_id, s.name as source_name");
    expect(SQL14).toContain(
      "grant select on public.public_event_sources to anon, authenticated",
    );
    expect(SQL14).not.toMatch(/grant .* on public\.event_sources /);
  });
});

describe("migration 0015 reminders", () => {
  it("stores one reminder per event and email with a delete token", () => {
    expect(SQL15).toContain("create table public.reminders");
    for (const column of [
      "event_id uuid not null",
      "email text not null",
      "remind_at timestamptz not null",
      "basis text not null",
      "delete_token text not null",
      "sent_at timestamptz",
    ]) {
      expect(SQL15).toContain(column);
    }
    expect(SQL15).toContain("unique (event_id, email)");
    expect(SQL15).toContain("basis in ('registration_window', 'event_start')");
    expect(SQL15).toContain("alter column user_id set default auth.uid()");
  });

  it("is insert-only for app roles: reads stay service-role-only", () => {
    expect(SQL15).toContain(
      "alter table public.reminders enable row level security",
    );
    expect(SQL15).toContain(
      "create policy reminders_insert on public.reminders",
    );
    expect(SQL15).toContain("for insert to anon, authenticated");
    expect(SQL15).not.toMatch(/for (select|update|delete) to /);
    expect(SQL15).not.toMatch(/grant select on public\.reminders/);
  });

  it("deletes only through the token-checked definer function", () => {
    expect(SQL15).toContain(
      "create or replace function public.delete_reminder(p_id uuid, p_token text)",
    );
    expect(SQL15).toContain("security definer");
    expect(SQL15).toContain("set search_path = public");
    expect(SQL15).toContain("where id = p_id and delete_token = p_token");
    expect(SQL15).toContain(
      "grant execute on function public.delete_reminder(uuid, text)",
    );
  });
});

describe("migration 0016 bookings", () => {
  it("stores one booking per event per family feed", () => {
    expect(SQL16).toContain("create table public.bookings");
    for (const column of [
      "event_id uuid not null",
      "confirmation_id text",
      "starts_at timestamptz",
      "evidence jsonb",
      "feed_token text not null",
      "delete_token text not null",
    ]) {
      expect(SQL16).toContain(column);
    }
    expect(SQL16).toContain("unique (event_id, feed_token)");
    expect(SQL16).toContain("alter column user_id set default auth.uid()");
  });

  it("is insert-only for app roles like reminders", () => {
    expect(SQL16).toContain(
      "alter table public.bookings enable row level security",
    );
    expect(SQL16).toContain(
      "create policy bookings_insert on public.bookings",
    );
    expect(SQL16).not.toMatch(/for (select|update|delete) to /);
    expect(SQL16).not.toMatch(/grant select on public\.bookings/);
  });

  it("deletes and feeds only through token-checked definer functions", () => {
    expect(SQL16).toContain(
      "create or replace function public.delete_booking(p_id uuid, p_token text)",
    );
    expect(SQL16).toContain("where id = p_id and delete_token = p_token");
    expect(SQL16).toContain(
      "create or replace function public.bookings_for_feed(p_token text)",
    );
    expect(SQL16).toContain("where b.feed_token = p_token");
    expect(SQL16).toContain("coalesce(b.starts_at, e.starts_at)");
    expect(SQL16).toContain(
      "grant execute on function public.delete_booking(uuid, text)",
    );
    expect(SQL16).toContain(
      "grant execute on function public.bookings_for_feed(text)",
    );
  });
});

describe("migration 0017 feed end times", () => {
  it("resolves the feed end to null on a mismatched start", () => {
    expect(SQL17).toContain(
      "create or replace function public.bookings_for_feed(p_token text)",
    );
    expect(SQL17).toContain(
      "case when b.starts_at is null or b.starts_at = e.starts_at",
    );
    expect(SQL17).toContain("then e.ends_at end as ends_at");
  });
});
