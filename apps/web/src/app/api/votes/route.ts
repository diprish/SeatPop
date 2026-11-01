import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { voteSeriesKey } from "@seatpop/worker/recommend";
import { voteCreateError } from "@/lib/create-errors";
import {
  clientIp,
  publicSupabase,
  routeLimiter,
} from "@/lib/recommend-server";
import { VOTE_TAGS, type VoteTag } from "@/lib/votes";
import { voterHashFor } from "@/lib/voter-hash";

/**
 * Worth-it votes, keyed by event series (one vote per device per
 * series, re-votes update). The only stored identity is the salted
 * device hash below — no names, emails, free text, or IPs, and the raw
 * device id is never logged or stored.
 *
 * GET /api/votes?event_id=…: counts for the event's series, or
 * {enough: false} below 3 votes (no counts leak for tiny samples).
 * POST /api/votes: {event_id, vote: 1 | -1, tags, device_id}.
 */

const limiter = routeLimiter();

const TagSchema = z
  .string()
  .refine(
    (tag): tag is VoteTag =>
      (VOTE_TAGS as readonly string[]).includes(tag),
    "unknown tag",
  );

const PostBodySchema = z.object({
  event_id: z.string().uuid(),
  vote: z.union([z.literal(1), z.literal(-1)]),
  tags: z.array(TagSchema).max(VOTE_TAGS.length),
  device_id: z.string().min(8).max(200),
});

const EventRowSchema = z.object({
  title: z.string(),
  venue_id: z.string().nullable(),
});

const VenueRowSchema = z.object({ name: z.string() });

const SummarySchema = z.object({
  ok: z.literal(true),
  enough: z.boolean(),
  total: z.number().optional(),
  up: z.number().optional(),
  down: z.number().optional(),
  tags: z.record(z.string(), z.number()).optional(),
});

const CreatedSchema = z.object({
  ok: z.boolean(),
  id: z.string().optional(),
  error: z.string().optional(),
});

async function restJson(
  base: string,
  anonKey: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text !== "") {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

/** The event's vote series, or null when the event is unknown. */
async function seriesKeyForEvent(
  base: string,
  anonKey: string,
  eventId: string,
): Promise<string | null> {
  const event = EventRowSchema.array()
    .parse(
      (
        await restJson(
          base,
          anonKey,
          `public_events?id=eq.${encodeURIComponent(eventId)}&select=title,venue_id&limit=1`,
        )
      ).json,
    )[0];
  if (!event) return null;
  let venueName: string | null = null;
  if (event.venue_id) {
    const venue = VenueRowSchema.array()
      .parse(
        (
          await restJson(
            base,
            anonKey,
            `public_venues?id=eq.${encodeURIComponent(event.venue_id)}&select=name&limit=1`,
          )
        ).json,
      )[0];
    venueName = venue?.name ?? null;
  }
  return voteSeriesKey(event.title, venueName);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const eventId = request.nextUrl.searchParams.get("event_id") ?? "";
  if (!z.string().uuid().safeParse(eventId).success) {
    return NextResponse.json(
      { error: "event_id must be a uuid" },
      { status: 400 },
    );
  }
  const supabase = publicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "votes are not configured on this server" },
      { status: 500 },
    );
  }
  const base = supabase.url.replace(/\/$/, "");
  try {
    const seriesKey = await seriesKeyForEvent(base, supabase.anonKey, eventId);
    if (!seriesKey) {
      return NextResponse.json({ error: "unknown event" }, { status: 404 });
    }
    const summary = await restJson(
      base,
      supabase.anonKey,
      "rpc/series_votes_summary",
      { method: "POST", body: { p_series_key: seriesKey } },
    );
    if (summary.status < 200 || summary.status >= 300) {
      throw new Error(`series_votes_summary failed: HTTP ${summary.status}`);
    }
    return NextResponse.json(SummarySchema.parse(summary.json));
  } catch {
    return NextResponse.json({ error: "votes unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Writes only: every card reads its summary on view, so GET stays
  // unlimited (cheap aggregates) while votes share the daily IP cap.
  const limit = limiter.check(`votes:${clientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "daily request cap reached for this address" },
      { status: 429 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "body needs event_id, vote, tags, and device_id" },
      { status: 400 },
    );
  }
  const salt = process.env["VOTE_SALT"]?.trim();
  if (!salt) {
    return NextResponse.json(
      { error: "votes are not configured on this server" },
      { status: 500 },
    );
  }
  const supabase = publicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "votes are not configured on this server" },
      { status: 500 },
    );
  }
  const base = supabase.url.replace(/\/$/, "");
  try {
    const seriesKey = await seriesKeyForEvent(
      base,
      supabase.anonKey,
      parsed.data.event_id,
    );
    if (!seriesKey) {
      return NextResponse.json({ error: "unknown event" }, { status: 404 });
    }
    const created = await restJson(base, supabase.anonKey, "rpc/create_vote", {
      method: "POST",
      body: {
        p_series_key: seriesKey,
        p_event_id: parsed.data.event_id,
        p_voter_hash: voterHashFor(parsed.data.device_id, salt),
        p_vote: parsed.data.vote,
        p_tags: parsed.data.tags,
      },
    });
    if (created.status < 200 || created.status >= 300) {
      throw new Error(`create_vote failed: HTTP ${created.status}`);
    }
    const envelope = CreatedSchema.parse(created.json);
    if (!envelope.ok) {
      const mapped = voteCreateError(envelope.error ?? "");
      return NextResponse.json(
        { error: mapped.message },
        { status: mapped.status },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "vote failed" }, { status: 500 });
  }
}
