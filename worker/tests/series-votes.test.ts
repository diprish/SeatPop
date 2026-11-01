import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { voteSeriesKey } from "../src/recommend/series";

describe("voteSeriesKey", () => {
  it("keys rooms of one branch as one series", () => {
    expect(
      voteSeriesKey("Babytime", "Ruth E. Dickinson at Children's program room"),
    ).toBe(
      voteSeriesKey("Babytime", "Ruth E. Dickinson at 2nd floor meeting room"),
    );
  });

  it("splits different titles and different branches", () => {
    const base = voteSeriesKey("Babytime", "Main at Room B125");
    expect(voteSeriesKey("Storytime", "Main at Room B125")).not.toBe(base);
    expect(voteSeriesKey("Babytime", "Sunnyside at Room 1")).not.toBe(base);
  });

  it("normalizes case, accents, and punctuation", () => {
    expect(voteSeriesKey("  BABYTIME! ", "Main at Room")).toBe("babytime|main");
    expect(voteSeriesKey("Brin d’brico", "Orléans at Salle")).toBe(
      "brin d brico|orleans",
    );
  });

  it("keys venue-less events on the title alone", () => {
    expect(voteSeriesKey("Winter Fun Day", null)).toBe("winter fun day|");
  });
});

describe("migration 0021", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/0021_series_votes.sql", import.meta.url),
    "utf8",
  );

  it("creates the votes table with checks and one-row-per-voter dedupe", () => {
    expect(migration).toContain("create table public.event_series_votes");
    expect(migration).toContain("vote smallint not null check (vote in (1, -1))");
    expect(migration).toContain("voter_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("unique (series_key, voter_hash)");
  });

  it("locks the table behind RLS with no direct access", () => {
    expect(migration).toContain(
      "alter table public.event_series_votes enable row level security",
    );
    expect(migration).not.toContain("create policy");
  });

  it("creates a locked-down definer vote function open to guests", () => {
    expect(migration).toContain("create or replace function public.create_vote(");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain(
      "grant execute on function public.create_vote(text, uuid, text, smallint, text[])",
    );
    expect(migration).toContain("to anon, authenticated");
  });

  it("enforces the fixed tag vocabulary", () => {
    for (const tag of [
      "good for toddlers",
      "good for older kids",
      "crowded",
      "well run",
      "worth the drive",
      "not as described",
    ]) {
      expect(migration).toContain(`'${tag}'`);
    }
    expect(migration).toContain("'invalid_tags'");
  });

  it("caps per-voter totals and global hourly creates", () => {
    expect(migration).toContain(
      "where voter_hash = p_voter_hash) >= 100",
    );
    expect(migration).toContain("'voter_cap'");
    expect(migration).toContain(
      "where created_at > now() - interval '1 hour') >= 100",
    );
    expect(migration).toContain("'global_cap'");
  });

  it("lets re-votes update past the caps without touching created_at", () => {
    expect(migration).toContain("on conflict (series_key, voter_hash)");
    expect(migration).toContain("do update set");
    expect(migration).not.toContain("created_at = excluded.created_at");
  });

  it("summarizes counts only, gated at 3 votes", () => {
    expect(migration).toContain(
      "create or replace function public.series_votes_summary(p_series_key text)",
    );
    expect(migration).toContain("select vote, tags");
    expect(migration).toContain("< 3 then");
    expect(migration).toContain("'enough', false");
    expect(migration).toContain("'up', (select up from totals)");
    expect(migration).toContain(
      "grant execute on function public.series_votes_summary(text)",
    );
  });
});
