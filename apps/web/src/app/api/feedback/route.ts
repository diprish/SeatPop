import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  bearerJwt,
  clientIp,
  publicSupabase,
  routeLimiter,
} from "@/lib/recommend-server";

/**
 * Signed-in feedback (guests use localStorage): saved / dismissed /
 * not_for_us per event, with an optional reason. The caller's JWT is
 * forwarded so RLS enforces ownership; user_id is never accepted from
 * the body (it defaults to auth.uid() — migration 0013).
 *
 * POST {event_id, value, reason?} upserts one verdict.
 * GET ?value=saved lists the caller's verdicts (newest first).
 * DELETE ?event_id= removes one verdict (unsave).
 */

const limiter = routeLimiter();

const ValueSchema = z.enum(["saved", "dismissed", "not_for_us"]);

const PostBodySchema = z.object({
  event_id: z.string().uuid(),
  value: ValueSchema,
  reason: z.string().trim().max(280).optional(),
});

interface PostgrestError {
  status: number;
  message: string;
}

async function rest(
  base: string,
  anonKey: string,
  jwt: string,
  path: string,
  init?: { method?: string; body?: unknown; prefer?: string },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${base}/rest/v1/${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        ...(init?.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw {
      status: 502,
      message: `supabase unreachable: ${error instanceof Error ? error.message : String(error)}`,
    } satisfies PostgrestError;
  }
  if (response.status === 401 || response.status === 403) {
    throw { status: 401, message: "sign-in required" } satisfies PostgrestError;
  }
  const text = await response.text();
  let json: unknown = [];
  if (text !== "") {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw {
        status: 502,
        message: "supabase returned invalid JSON",
      } satisfies PostgrestError;
    }
  }
  if (!response.ok) {
    // 409 here means the event_id foreign key (the unique pair merges).
    throw {
      status: response.status === 409 ? 400 : 502,
      message: response.status === 409 ? "unknown event" : `supabase HTTP ${response.status}`,
    } satisfies PostgrestError;
  }
  return json;
}

function authed(request: NextRequest): NextResponse | { jwt: string; url: string; anonKey: string } {
  const jwt = bearerJwt(request);
  if (!jwt) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }
  const supabase = publicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "feedback is not configured on this server" },
      { status: 500 },
    );
  }
  return { jwt, url: supabase.url, anonKey: supabase.anonKey };
}

const ListSchema = z.array(
  z.object({
    event_id: z.string(),
    value: z.string(),
    reason: z.string().nullable(),
    created_at: z.string(),
  }),
);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = limiter.check(`feedback:${clientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "daily request cap reached for this address" },
      { status: 429 },
    );
  }
  const auth = authed(request);
  if (auth instanceof NextResponse) return auth;
  const value = request.nextUrl.searchParams.get("value");
  if (value !== null && !ValueSchema.safeParse(value).success) {
    return NextResponse.json({ error: "unknown value filter" }, { status: 400 });
  }
  try {
    const query =
      "feedback?select=event_id,value,reason,created_at" +
      (value ? `&value=eq.${value}` : "") +
      "&order=created_at.desc&limit=100";
    const rows = ListSchema.parse(await rest(auth.url, auth.anonKey, auth.jwt, query));
    return NextResponse.json({ feedback: rows });
  } catch {
    return NextResponse.json({ error: "feedback lookup failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = limiter.check(`feedback:${clientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "daily request cap reached for this address" },
      { status: 429 },
    );
  }
  const auth = authed(request);
  if (auth instanceof NextResponse) return auth;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: `invalid feedback: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      },
      { status: 400 },
    );
  }
  try {
    await rest(auth.url, auth.anonKey, auth.jwt, "feedback?on_conflict=user_id,event_id", {
      method: "POST",
      body: {
        event_id: parsed.data.event_id,
        value: parsed.data.value,
        reason: parsed.data.reason ?? null,
      },
      prefer: "return=minimal,resolution=merge-duplicates",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      "message" in error
    ) {
      const { status, message } = error as PostgrestError;
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ error: "feedback save failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const limit = limiter.check(`feedback:${clientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "daily request cap reached for this address" },
      { status: 429 },
    );
  }
  const auth = authed(request);
  if (auth instanceof NextResponse) return auth;
  const eventId = request.nextUrl.searchParams.get("event_id");
  if (!eventId || !z.string().uuid().safeParse(eventId).success) {
    return NextResponse.json({ error: "unknown event" }, { status: 400 });
  }
  try {
    await rest(
      auth.url,
      auth.anonKey,
      auth.jwt,
      `feedback?event_id=eq.${encodeURIComponent(eventId)}`,
      { method: "DELETE", prefer: "return=minimal" },
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "feedback delete failed" }, { status: 500 });
  }
}
