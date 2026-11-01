import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  computeRemindAt,
  matchWindow,
  normalizeEmail,
} from "@seatpop/worker/recommend";
import {
  bearerJwt,
  clientIp,
  publicSupabase,
  routeLimiter,
} from "@/lib/recommend-server";
import { loadEventSourceNames, loadWindows } from "@/lib/registration-server";

/**
 * POST /api/reminders: set an email reminder for a saved event.
 * Body {event_id, email}. remind_at is the registration opening minus
 * 1 hour, or the event start minus 1 day when no window matches. The
 * delete token is returned ONCE (the client keeps it for one-click
 * delete); the address is never logged and never sent to a model.
 *
 * DELETE /api/reminders: body {id, delete_token} removes one reminder
 * through the token-checked RPC (no table reads exist for this role).
 */

const limiter = routeLimiter();

const PostBodySchema = z.object({
  event_id: z.string().uuid(),
  email: z.string().min(1).max(320),
});

const DeleteBodySchema = z.object({
  id: z.string().uuid(),
  delete_token: z.string().min(32).max(200),
});

const EventRowSchema = z.object({
  starts_at: z.string(),
});

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
  const limit = limiter.check(`reminders:${clientIp(request)}`);
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
    return NextResponse.json({ error: "body needs event_id and email" }, { status: 400 });
  }
  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    return NextResponse.json(
      { error: "that email address does not look valid" },
      { status: 400 },
    );
  }
  const supabase = publicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "reminders are not configured on this server" },
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
          `public_events?id=eq.${encodeURIComponent(parsed.data.event_id)}&select=starts_at&limit=1`,
        )
      ).json,
    )[0];
    if (!event) {
      return NextResponse.json({ error: "unknown event" }, { status: 404 });
    }
    const [windows, sources] = await Promise.all([
      loadWindows(base, supabase.anonKey),
      loadEventSourceNames(base, supabase.anonKey, [parsed.data.event_id]),
    ]);
    const schedule = computeRemindAt(
      matchWindow(windows, sources.get(parsed.data.event_id) ?? []),
      event.starts_at,
    );
    const delete_token = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
    const inserted = await restJson(base, supabase.anonKey, jwt, "reminders", {
      method: "POST",
      body: {
        event_id: parsed.data.event_id,
        email,
        remind_at: schedule.remind_at,
        basis: schedule.basis,
        delete_token,
      },
      prefer: "return=representation",
    });
    if (inserted.status === 409) {
      return NextResponse.json(
        { error: "a reminder is already set for this event and email" },
        { status: 409 },
      );
    }
    if (inserted.status === 401 || inserted.status === 403) {
      return NextResponse.json({ error: "sign-in required" }, { status: 401 });
    }
    if (inserted.status < 200 || inserted.status >= 300) {
      throw new Error(`supabase reminders failed: HTTP ${inserted.status}`);
    }
    const row = InsertedSchema.array().parse(inserted.json)[0];
    if (!row) throw new Error("supabase reminders insert returned no row");
    return NextResponse.json({
      id: row.id,
      remind_at: schedule.remind_at,
      basis: schedule.basis,
      delete_token,
    });
  } catch (error) {
    console.error(
      `reminder create failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "reminder failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const limit = limiter.check(`reminders:${clientIp(request)}`);
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
      { error: "reminders are not configured on this server" },
      { status: 500 },
    );
  }
  try {
    const deleted = await restJson(
      supabase.url.replace(/\/$/, ""),
      supabase.anonKey,
      bearerJwt(request) ?? supabase.anonKey,
      "rpc/delete_reminder",
      {
        method: "POST",
        body: { p_id: parsed.data.id, p_token: parsed.data.delete_token },
      },
    );
    if (deleted.status < 200 || deleted.status >= 300) {
      throw new Error(`delete_reminder failed: HTTP ${deleted.status}`);
    }
    if (deleted.json !== true) {
      return NextResponse.json({ error: "unknown reminder" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error(
      `reminder delete failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "reminder delete failed" }, { status: 500 });
  }
}
