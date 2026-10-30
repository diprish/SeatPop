import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  FsaSchema,
  HouseholdMemberSchema,
  PreferencesSchema,
} from "@seatpop/shared";
import { bearerJwt, publicSupabase } from "@/lib/recommend-server";

/**
 * Household storage for signed-in users (guest recommend stores nothing).
 * GET lists the caller's households with members + preferences; POST
 * saves one household (members + optional preferences). The caller's JWT
 * is forwarded to PostgREST so RLS — not application code — enforces
 * ownership. user_id is never accepted from the body: inserts rely on
 * auth.uid() matching the policy WITH CHECK.
 */

const PostBodySchema = z.object({
  home_fsa: FsaSchema.optional(),
  members: z.array(HouseholdMemberSchema).min(1),
  preferences: PreferencesSchema.omit({ members: true, fsa: true })
    .partial()
    .optional(),
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
      throw { status: 502, message: "supabase returned invalid JSON" } satisfies PostgrestError;
    }
  }
  if (!response.ok) {
    const detail =
      typeof json === "object" && json !== null && "message" in json
        ? String((json as { message: unknown }).message)
        : `supabase HTTP ${response.status}`;
    // 409 here means the home_fsa foreign key (nothing else references).
    throw {
      status: response.status === 409 ? 400 : 502,
      message: response.status === 409 ? `unknown area: ${detail}` : detail,
    } satisfies PostgrestError;
  }
  return json;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "message" in error
  );
}

const HouseholdListSchema = z.array(
  z.object({ id: z.string(), home_fsa: z.string().nullable() }),
);
const MemberListSchema = z.array(HouseholdMemberSchema);
const PreferencesGetSchema = z.array(
  PreferencesSchema.omit({ members: true, fsa: true }).partial(),
);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const jwt = bearerJwt(request);
  if (!jwt) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }
  const supabase = publicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "households are not configured on this server" },
      { status: 500 },
    );
  }
  try {
    const households = HouseholdListSchema.parse(
      await rest(supabase.url, supabase.anonKey, jwt, "households?select=id,home_fsa"),
    );
    const out = [];
    for (const household of households) {
      const id = encodeURIComponent(household.id);
      const members = MemberListSchema.parse(
        await rest(
          supabase.url,
          supabase.anonKey,
          jwt,
          `members?household_id=eq.${id}&select=age_band,include_adjacent`,
        ),
      );
      const prefsRows = PreferencesGetSchema.parse(
        await rest(
          supabase.url,
          supabase.anonKey,
          jwt,
          `preferences?household_id=eq.${id}&select=max_price_cents,free_only,max_distance_km,availability,language,accessibility,interests,avoid`,
        ),
      );
      out.push({
        id: household.id,
        home_fsa: household.home_fsa,
        members,
        preferences: prefsRows[0] ?? null,
      });
    }
    return NextResponse.json({ households: out });
  } catch (error) {
    if (isPostgrestError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      `households GET failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "households lookup failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const jwt = bearerJwt(request);
  if (!jwt) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }
  const supabase = publicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "households are not configured on this server" },
      { status: 500 },
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
      {
        error: `invalid household: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      },
      { status: 400 },
    );
  }
  try {
    const created = z.array(z.object({ id: z.string() })).parse(
      await rest(supabase.url, supabase.anonKey, jwt, "households", {
        method: "POST",
        body: { home_fsa: parsed.data.home_fsa ?? null },
        prefer: "return=representation",
      }),
    );
    const householdId = (created[0] as { id: string }).id;
    await rest(supabase.url, supabase.anonKey, jwt, "members", {
      method: "POST",
      body: parsed.data.members.map((m) => ({
        household_id: householdId,
        age_band: m.age_band,
        include_adjacent: m.include_adjacent,
      })),
      prefer: "return=minimal",
    });
    const prefs = parsed.data.preferences ?? {};
    await rest(
      supabase.url,
      supabase.anonKey,
      jwt,
      "preferences?on_conflict=household_id",
      {
        method: "POST",
        body: { household_id: householdId, ...prefs },
        prefer: "return=minimal,resolution=merge-duplicates",
      },
    );
    return NextResponse.json({ household_id: householdId }, { status: 201 });
  } catch (error) {
    if (isPostgrestError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      `households POST failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "household save failed" }, { status: 500 });
  }
}
