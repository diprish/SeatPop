import { NextResponse, type NextRequest } from "next/server";
import { BudgetExceeded, parseProfileDescription } from "@seatpop/llm";
import { PreferencesSchema } from "@seatpop/shared";
import { chipsFor } from "@seatpop/worker/recommend/chips";
import { clientIp, routeLimiter, serverLlmConfig } from "@/lib/recommend-server";

/**
 * POST /api/profile/parse: "describe your household in your own words"
 * (typed only) → structured preferences + editable chips. The raw text
 * is PII-redacted before the model call and discarded (never stored or
 * logged). Model/budget failures degrade to an empty editable template.
 */

const limiter = routeLimiter();

function fallbackPrefs(): unknown {
  return PreferencesSchema.parse({ members: [{ age_band: "adults" }] });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = limiter.check(`parse:${clientIp(request)}`);
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
  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || text.trim() === "") {
    return NextResponse.json(
      { error: "body.text must be a non-empty string" },
      { status: 400 },
    );
  }
  try {
    const result = await parseProfileDescription(text, {
      config: serverLlmConfig(),
    });
    if (!result.ok) {
      // Raw detail stays server-side; the UI shows the friendly line
      // only (and keeps the current picks and chips untouched).
      console.error(
        `profile parse failed (${result.error.kind}): ${result.error.message}`,
      );
      return NextResponse.json(
        {
          error:
            "Couldn't read that description. Pick who's coming with the chips instead.",
          fallbackPrefs: fallbackPrefs(),
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      prefs: result.value.prefs,
      chips: chipsFor(result.value.prefs),
      model: result.value.model,
    });
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      return NextResponse.json(
        {
          error: "model budget reached; edit the empty preferences instead",
          fallbackPrefs: fallbackPrefs(),
        },
        { status: 503 },
      );
    }
    console.error(
      `profile parse failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      { error: "profile parse failed", fallbackPrefs: fallbackPrefs() },
      { status: 500 },
    );
  }
}
