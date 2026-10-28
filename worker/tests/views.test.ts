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
