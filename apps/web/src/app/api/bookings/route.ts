import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  bearerJwt,
  clientIp,
  publicSupabase,
  routeLimiter,
} from "@/lib/recommend-server";

/**
 * POST /api/bookings: persist a user-confirmed booking (one per event
 * per family feed). Body {event_id, confirmation_id?, starts_at?,
 * evidence?, feed_token}. Returns the row id plus a one-time delete
 * token. 409 when this feed already booked the event.
 *
 * DELETE /api/bookings: body {id, delete_token} removes one booking
 * through the token-checked RPC (no table reads exist for this role).
 */

const limiter = routeLimiter();

const PostBodySchema = z.object({
  event_id: z.string().uuid(),
  confirmation_id: z.string().max(100).nullable(),
  starts_at: z.string().max(100).nullable(),
  evidence: z
    .object({
      confirmation_quote: z.string().max(500).nullable(),
      datetime_quote: z.string().max(500).nullable(),
    })
    .nullable(),
  feed_token: z.string().min(32).max(200),
});

const DeleteBodySchema = z.object({
  id: z.string().uuid(),
  delete_token: z.string().min(32).max(200),
});

const EventRowSchema = z.object({ id: z.string() });
const InsertedSchema = z.object({ id: z.string() });

async function restJson(
  base: string,
  anonKey: string,
  jwt: string,
  path: string,
  init?: { method?: string; body?: unknown; prefer?: string },
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${jwt}`,
      ...(init?.prefer ? { Prefer: init.prefer } : {}),
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = limiter.check(`bookings:${clientIp(request)}`);
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
      { error: "body needs event_id and feed_token" },
      { status: 400 },
    );
  }
  if (parsed.data.starts_at !== null && Number.isNaN(Date.parse(parsed.data.starts_at))) {
    return NextResponse.json(
      { error: "starts_at is not a valid date/time" },
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
  const base = supabase.url.replace(/\/$/, "");
  const jwt = bearerJwt(request) ?? supabase.anonKey;
  try {
    const event = EventRowSchema.array().parse(
      (
        await restJson(
          base,
          supabase.anonKey,
          jwt,
          `public_events?id=eq.${encodeURIComponent(parsed.data.event_id)}&select=id&limit=1`,
        )
      ).json,
    )[0];
    if (!event) {
      return NextResponse.json({ error: "unknown event" }, { status: 404 });
    }
    const delete_token = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
    const inserted = await restJson(base, supabase.anonKey, jwt, "bookings", {
      method: "POST",
      body: {
        event_id: parsed.data.event_id,
        confirmation_id: parsed.data.confirmation_id,
        starts_at: parsed.data.starts_at,
        evidence: parsed.data.evidence,
        feed_token: parsed.data.feed_token,
        delete_token,
      },
      prefer: "return=representation",
    });
    if (inserted.status === 409) {
      return NextResponse.json(
        { error: "this event is already booked on this calendar" },
        { status: 409 },
      );
    }
    if (inserted.status === 401 || inserted.status === 403) {
      return NextResponse.json({ error: "sign-in required" }, { status: 401 });
    }
    if (inserted.status < 200 || inserted.status >= 300) {
      throw new Error(`supabase bookings failed: HTTP ${inserted.status}`);
    }
    const row = InsertedSchema.array().parse(inserted.json)[0];
    if (!row) throw new Error("supabase bookings insert returned no row");
    return NextResponse.json({ id: row.id, delete_token });
  } catch (error) {
    console.error(
      `booking create failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "booking failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const limit = limiter.check(`bookings:${clientIp(request)}`);
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
  const parsed = DeleteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "body needs id and delete_token" },
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
    const deleted = await restJson(
      supabase.url.replace(/\/$/, ""),
      supabase.anonKey,
      bearerJwt(request) ?? supabase.anonKey,
      "rpc/delete_booking",
      {
        method: "POST",
        body: { p_id: parsed.data.id, p_token: parsed.data.delete_token },
      },
    );
    if (deleted.status < 200 || deleted.status >= 300) {
      throw new Error(`delete_booking failed: HTTP ${deleted.status}`);
    }
    if (deleted.json !== true) {
      return NextResponse.json({ error: "unknown booking" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error(
      `booking delete failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "booking delete failed" }, { status: 500 });
  }
}
