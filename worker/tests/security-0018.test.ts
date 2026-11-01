import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Migration 0018 pins: app roles write reminders/bookings only through
 * the SECURITY DEFINER create functions, which validate and cap.
 */

const migration = readFileSync(
  new URL("../../supabase/migrations/0018_hardened_creates.sql", import.meta.url),
  "utf8",
);

describe("migration 0018 revokes direct inserts", () => {
  it("drops both app-role insert policies", () => {
    expect(migration).toContain("drop policy if exists reminders_insert");
    expect(migration).toContain("drop policy if exists bookings_insert");
    expect(migration).not.toContain("create policy");
  });
});

describe("create_reminder", () => {
  it("is a locked-down definer function open to guests", () => {
    expect(migration).toContain("create or replace function public.create_reminder(");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain(
      "grant execute on function public.create_reminder(uuid, text, timestamptz, text, text)",
    );
    expect(migration).toContain("to anon, authenticated");
  });

  it("validates email, basis, token, event, and timing", () => {
    expect(migration).toContain("'invalid_email'");
    expect(migration).toContain("'invalid_basis'");
    expect(migration).toContain("char_length(p_delete_token) < 32");
    expect(migration).toContain("not exists (select 1 from public.events where id = p_event_id)");
    expect(migration).toContain("p_remind_at <= now()");
    // NULLs take the typed path too (NULL comparisons are falsy).
    expect(migration).toContain("v_email is null");
    expect(migration).toContain("p_event_id is null");
    expect(migration).toContain("p_remind_at is null");
  });

  it("caps 3 unsent per email and 20 created per hour", () => {
    expect(migration).toContain("where email = v_email and sent_at is null) >= 3");
    expect(migration).toContain("'per_email_cap'");
    expect(migration).toContain("where created_at > now() - interval '1 hour') >= 20");
    expect(migration).toContain("'global_cap'");
  });

  it("stamps the caller and reports duplicates typed", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("exception when unique_violation");
    expect(migration).toContain("'duplicate'");
  });
});

describe("create_booking", () => {
  it("is a locked-down definer function open to guests", () => {
    expect(migration).toContain("create or replace function public.create_booking(");
    expect(migration).toContain("security definer");
    expect(migration).toContain(
      "grant execute on function public.create_booking(uuid, text, timestamptz, jsonb, text, text)",
    );
  });

  it("requires long tokens and a known event", () => {
    expect(migration).toContain("char_length(p_feed_token) < 32");
    expect(migration).toContain("not exists (select 1 from public.events where id = p_event_id)");
    expect(migration).toContain("p_feed_token is null");
  });

  it("caps 50 bookings per feed and reports duplicates typed", () => {
    expect(migration).toContain("where feed_token = p_feed_token) >= 50");
    expect(migration).toContain("'feed_cap'");
    expect(migration).toContain("auth.uid()");
  });

  it("adds a feed_token length check to the table", () => {
    expect(migration).toContain("bookings_feed_token_length");
    expect(migration).toContain("check (char_length(feed_token) >= 32)");
  });
});
