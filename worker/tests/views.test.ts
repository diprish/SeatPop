import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static guarantees on migration 0002: RLS everywhere, service-role-only
// tables, and public views that cannot leak raw_text or raw_hash.
const SQL = readFileSync(
  new URL("../../supabase/migrations/0002_events.sql", import.meta.url),
  "utf8",
);

function viewColumns(view: string): string[] {
  const start = SQL.indexOf(`create view public.${view} as`);
  const from = SQL.indexOf("from public.", start);
  const select = SQL.slice(start, from).split("select")[1] ?? "";
  return select
    .split(",")
    .map((c) => c.replace(/[\s;]+/g, " ").trim())
    .filter((c) => c !== "");
}

describe("migration 0002", () => {
  it("enables RLS on every table with no policies", () => {
    const rls = SQL.match(/enable row level security/g) ?? [];
    expect(rls).toHaveLength(4);
    expect(SQL.toLowerCase()).not.toContain("create policy");
  });

  it("keeps raw_text and raw_hash out of the public views", () => {
    const views = SQL.slice(SQL.indexOf("create view"));
    expect(views).not.toContain("raw_text");
    expect(views).not.toContain("raw_hash");
    expect(viewColumns("public_events").sort()).toEqual(
      [
        "id",
        "source_id",
        "source_url",
        "title",
        "description",
        "starts_at",
        "ends_at",
        "timezone",
        "venue_id",
        "category",
        "status",
      ].sort(),
    );
    expect(viewColumns("public_venues").sort()).toEqual(
      ["id", "name", "address", "lat", "lng"].sort(),
    );
  });

  it("grants the views to anon and authenticated", () => {
    expect(SQL).toContain("grant select on public.public_events to anon");
    expect(SQL).toContain("grant select on public.public_venues to anon");
  });
});

const SQL3 = readFileSync(
  new URL("../../supabase/migrations/0003_enrichment.sql", import.meta.url),
  "utf8",
);

const SQL4 = readFileSync(
  new URL("../../supabase/migrations/0004_pricing_policy.sql", import.meta.url),
  "utf8",
);

describe("migration 0004", () => {
  it("adds policy columns, scope and basis without touching RLS or views", () => {
    for (const fragment of [
      "pricing_policy_kind",
      "pricing_policy_quote",
      "pricing_policy_url",
      "pricing_policy_scope",
      "price_basis",
      "source_policy",
    ]) {
      expect(SQL4).toContain(fragment);
    }
    expect(SQL4.toLowerCase()).not.toContain("create policy");
    expect(SQL4.toLowerCase()).not.toContain("create or replace view");
    expect(SQL4.toLowerCase()).not.toContain("enable row level security");
  });
});

describe("migration 0003", () => {
  it("enables RLS on the new tables with no policies", () => {
    const rls = SQL3.match(/enable row level security/g) ?? [];
    expect(rls).toHaveLength(2);
    expect(SQL3.toLowerCase()).not.toContain("create policy");
  });

  it("keeps evidence, model metadata and embeddings out of public_events", () => {
    const views = SQL3.slice(SQL3.indexOf("create or replace view"));
    for (const hidden of [
      "raw_text",
      "raw_hash",
      "evidence",
      "model",
      "prompt_version",
      "source_hash",
      "confidence",
      "embedding",
      "enriched_at",
    ]) {
      expect(views).not.toContain(hidden);
    }
    for (const exposed of [
      "age_min",
      "age_max",
      "needs_adult",
      "setting",
      "energy",
      "crowd",
      "duration_min",
      "language",
      "accessibility",
      "registration_hint",
      "registration_opens_at",
      "summary_short",
      "tags",
      "price_kind",
      "amount_min_cents",
      "amount_max_cents",
      "currency",
      "price_text",
      "fee_notes",
    ]) {
      expect(views).toContain(exposed);
    }
  });
});
