import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { findSiblings } from "@seatpop/worker/recommend";
import { clientIp, publicSupabase, routeLimiter } from "@/lib/recommend-server";
import { attachWindows } from "@/lib/registration-server";

/**
 * GET /api/events/[id]: one event with venue, enrichment facts, evidence
 * quotes, and pricing basis. Reads the public_events/public_venues views
 * (anon key; the views are the column allowlist). No LLM, no PII.
 */

const limiter = routeLimiter();

const EventRowSchema = z.object({
  id: z.string(),
  source_url: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  timezone: z.string(),
  venue_id: z.string().nullable(),
  category: z.string().nullable(),
  status: z.string(),
  age_min: z.number().nullable(),
  age_max: z.number().nullable(),
  needs_adult: z.boolean().nullable(),
  setting: z.string().nullable(),
  energy: z.string().nullable(),
  crowd: z.string().nullable(),
  duration_min: z.number().nullable(),
  language: z.string().nullable(),
  accessibility: z.array(z.string()).nullable(),
  registration_hint: z.string().nullable(),
  registration_opens_at: z.string().nullable(),
  summary_short: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  price_kind: z.string().nullable(),
  amount_min_cents: z.number().nullable(),
  amount_max_cents: z.number().nullable(),
  currency: z.string().nullable(),
  price_text: z.string().nullable(),
  fee_notes: z.string().nullable(),
  price_basis: z.string().nullable(),
  evidence: z
    .record(
      z.string(),
      z.object({ value: z.unknown(), quote: z.string().nullable() }),
    )
    .nullable(),
  evidence_quote: z.string().nullable(),
});

const VenueRowSchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

const SiblingRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  starts_at: z.string(),
  venue_id: z.string().nullable(),
});

const SiblingVenueSchema = z.object({
  id: z.string(),
  name: z.string(),
});

async function restJson<T>(base: string, anonKey: string, path: string): Promise<T> {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (!response.ok) {
    throw new Error(`supabase ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const limit = limiter.check(`events:${clientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "daily request cap reached for this address" },
      { status: 429 },
    );
  }
  const { id } = await params;
  if (!id || id.length > 100) {
    return NextResponse.json({ error: "unknown event" }, { status: 404 });
  }
  const supabase = publicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "event lookup is not configured on this server" },
      { status: 500 },
    );
  }
  try {
    const rows = EventRowSchema.array().parse(
      await restJson<unknown[]>(
        supabase.url,
        supabase.anonKey,
        `public_events?id=eq.${encodeURIComponent(id)}&limit=1`,
      ),
    );
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: "unknown event" }, { status: 404 });
    }
    let venue: z.infer<typeof VenueRowSchema> | null = null;
    if (row.venue_id) {
      const venues = VenueRowSchema.array().parse(
        await restJson<unknown[]>(
          supabase.url,
          supabase.anonKey,
          `public_venues?id=eq.${encodeURIComponent(row.venue_id)}&select=name,address,lat,lng&limit=1`,
        ),
      );
      venue = venues[0] ?? null;
    }
    // Same-occurrence twins (one row per room): same start instant, then
    // the shared collapse key decides. A sibling-lookup failure degrades
    // to no room list — the event itself still renders.
    let siblings: Array<{ id: string; venue_name: string; room: string | null }> = [];
    try {
      const sameInstant = SiblingRowSchema.array().parse(
        await restJson<unknown[]>(
          supabase.url,
          supabase.anonKey,
          `public_events?starts_at=eq.${encodeURIComponent(row.starts_at)}&select=id,title,starts_at,venue_id`,
        ),
      );
      const others = sameInstant.filter((candidate) => candidate.id !== row.id);
      const venueIds = [
        ...new Set(
          others
            .map((candidate) => candidate.venue_id)
            .filter((id): id is string => id !== null),
        ),
      ];
      const venueNames = new Map<string, string>();
      if (venueIds.length > 0) {
        const siblingVenues = SiblingVenueSchema.array().parse(
          await restJson<unknown[]>(
            supabase.url,
            supabase.anonKey,
            `public_venues?id=in.(${venueIds.map((id) => encodeURIComponent(id)).join(",")})&select=id,name`,
          ),
        );
        for (const siblingVenue of siblingVenues) {
          venueNames.set(siblingVenue.id, siblingVenue.name);
        }
      }
      siblings = findSiblings(
        {
          event_id: row.id,
          title: row.title,
          starts_at: row.starts_at,
          venue_name: venue?.name ?? null,
        },
        others.map((candidate) => ({
          event_id: candidate.id,
          title: candidate.title,
          starts_at: candidate.starts_at,
          venue_name: candidate.venue_id
            ? (venueNames.get(candidate.venue_id) ?? null)
            : null,
        })),
      ).map((sibling) => ({
        id: sibling.event_id,
        venue_name: sibling.venue_name,
        room: sibling.room,
      }));
    } catch (error) {
      console.warn(
        `sibling lookup failed for ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // Registration window: degrades to null when the lookup fails —
    // the event itself still renders.
    let registration_window: {
      scope: string;
      kind: string;
      opens_at: string;
      opens_date_only: boolean;
      quote: string;
      source_url: string;
      label: string | null;
    } | null = null;
    try {
      const attached = await attachWindows(supabase, [
        {
          event_id: row.id,
          title: row.title,
          category: row.category,
          starts_at: row.starts_at,
          description: row.description,
        },
      ]);
      registration_window = attached[0]?.registration_window ?? null;
    } catch (error) {
      console.warn(
        `registration window unavailable for ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return NextResponse.json({
      id: row.id,
      title: row.title,
      description: row.description,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      timezone: row.timezone,
      venue,
      category: row.category,
      status: row.status,
      source_url: row.source_url,
      age_min: row.age_min,
      age_max: row.age_max,
      needs_adult: row.needs_adult,
      setting: row.setting,
      energy: row.energy,
      crowd: row.crowd,
      duration_min: row.duration_min,
      language: row.language,
      accessibility: row.accessibility ?? [],
      registration_hint: row.registration_hint,
      registration_opens_at: row.registration_opens_at,
      summary_short: row.summary_short,
      tags: row.tags ?? [],
      price_kind: row.price_kind ?? "unknown",
      amount_min_cents: row.amount_min_cents,
      amount_max_cents: row.amount_max_cents,
      currency: row.currency,
      price_text: row.price_text,
      fee_notes: row.fee_notes,
      price_basis: row.price_basis ?? "event_text",
      evidence: row.evidence,
      price_evidence_quote: row.evidence_quote,
      siblings,
      registration_window,
    });
  } catch (error) {
    console.error(
      `event lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "event lookup failed" }, { status: 500 });
  }
}
