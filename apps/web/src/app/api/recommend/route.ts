import { NextResponse, type NextRequest } from "next/server";
import { PreferencesSchema } from "@seatpop/shared";
import {
  RecommendError,
  diagnoseEmpty,
  runRecommend,
} from "@seatpop/worker/recommend";
import {
  bearerJwt,
  clientIp,
  publicSupabase,
  recommendCache,
  routeLimiter,
  serverLlmConfig,
} from "@/lib/recommend-server";

/**
 * POST /api/recommend: guest-first recommendations.
 * Body: {prefs} (validated, stored nowhere) or {householdId} (loads the
 * signed-in user's saved household; needs Authorization: Bearer <jwt>).
 * Guest results cache for 5 minutes; household lookups always run fresh.
 * {prefs, diagnose: true} also attaches per-constraint candidate counts
 * (cheap SQL, no LLM) so an empty state can name the blocking filter.
 */

const limiter = routeLimiter();

function statusFor(code: RecommendError["code"]): number {
  switch (code) {
    case "invalid":
    case "unknown_area":
      return 400;
    case "unauthorized":
      return 401;
    case "upstream":
      return 502;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = limiter.check(`recommend:${clientIp(request)}`);
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
  const record = (typeof body === "object" && body !== null ? body : {}) as {
    prefs?: unknown;
    householdId?: unknown;
    diagnose?: unknown;
  };
  const supabase = publicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "recommendations are not configured on this server" },
      { status: 500 },
    );
  }
  try {
    if (typeof record.householdId === "string" && record.householdId !== "") {
      const result = await runRecommend(
        { householdId: record.householdId },
        {
          supabaseUrl: supabase.url,
          anonKey: supabase.anonKey,
          userJwt: bearerJwt(request),
          llmConfig: serverLlmConfig(),
        },
      );
      return NextResponse.json({ ...result, cached: false });
    }
    if (record.prefs === undefined) {
      return NextResponse.json(
        { error: "body needs prefs or householdId" },
        { status: 400 },
      );
    }
    const parsed = PreferencesSchema.safeParse(record.prefs);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: `invalid preferences: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        },
        { status: 400 },
      );
    }
    const key = JSON.stringify(parsed.data);
    const hit = recommendCache.get(key);
    let result: unknown;
    let cached = false;
    if (hit !== undefined) {
      result = hit;
      cached = true;
    } else {
      result = await runRecommend(
        { prefs: parsed.data },
        {
          supabaseUrl: supabase.url,
          anonKey: supabase.anonKey,
          llmConfig: serverLlmConfig(),
        },
      );
      recommendCache.set(key, result);
    }
    const diagnosis =
      record.diagnose === true
        ? await diagnoseEmpty(parsed.data, {
            supabaseUrl: supabase.url,
            anonKey: supabase.anonKey,
            llmConfig: serverLlmConfig(),
          })
        : undefined;
    return NextResponse.json({
      ...(result as object),
      cached,
      ...(diagnosis ? { diagnosis } : {}),
    });
  } catch (error) {
    if (error instanceof RecommendError) {
      return NextResponse.json(
        { error: error.message },
        { status: statusFor(error.code) },
      );
    }
    console.error(
      `recommend failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "recommendation failed" }, { status: 500 });
  }
}
