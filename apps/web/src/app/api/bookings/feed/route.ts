import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildFeedIcs, toIcsUtc } from "@seatpop/shared";
import { publicSupabase } from "@/lib/recommend-server";

/**
 * GET /api/bookings/feed?token= — the family .ics feed. Capability-token
 * gate (no rate limit: the token is unguessable and unlistable, and
 * calendar apps poll on their own schedule). Unknown tokens get an
 * empty feed, never an error oracle. Times come from the feed function,
 * which already resolved parsed-vs-listed starts.
 */

const FeedRowSchema = z.object({
  booking_id: z.string(),
  confirmation_id: z.string().nullable(),
  event_id: z.string(),
  event_title: z.string(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  timezone: z.string(),
  venue_name: z.string().nullable(),
  source_url: z.string(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (token.length < 32 || token.length > 200) {
    return NextResponse.json(
      { error: "a feed token is required" },
      { status: 400 },
    );
  }
  const supabase = publicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "bookings are not configured on this server" },
      { status: 500 },
    );
  }
  try {
    const response = await fetch(
      `${supabase.url.replace(/\/$/, "")}/rest/v1/rpc/bookings_for_feed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabase.anonKey,
          Authorization: `Bearer ${supabase.anonKey}`,
        },
        body: JSON.stringify({ p_token: token }),
      },
    );
    if (!response.ok) {
      throw new Error(`bookings_for_feed failed: HTTP ${response.status}`);
    }
    const rows = FeedRowSchema.array().parse(await response.json());
    const now = new Date().toISOString();
    const events = [];
    for (const row of rows) {
      try {
        // Validate up front: one bad row skips instead of failing the feed.
        toIcsUtc(row.starts_at);
        if (row.ends_at !== null) toIcsUtc(row.ends_at);
        events.push({
          uid: `${row.booking_id}@seatpop`,
          summary: row.event_title,
          start: row.starts_at,
          end: row.ends_at,
          location: row.venue_name,
          description: row.confirmation_id
            ? `Confirmation ${row.confirmation_id} · Tracked in SeatPop`
            : "Tracked in SeatPop",
          url: row.source_url,
        });
      } catch (error) {
        console.warn(
          `feed skips booking ${row.booking_id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const ics = buildFeedIcs(events, now);
    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="seatpop-family.ics"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error(
      `booking feed failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "feed failed" }, { status: 500 });
  }
}
