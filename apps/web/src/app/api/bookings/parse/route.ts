import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BudgetExceeded, parseBookingConfirmation } from "@seatpop/llm";
import { clientIp, routeLimiter, serverLlmConfig } from "@/lib/recommend-server";

/**
 * POST /api/bookings/parse: pasted confirmation text → verified booking
 * facts (confirmation id + event date/time, each with its verbatim
 * quote). Anything not verifiable against the redacted paste comes back
 * null. The raw text is discarded (never stored or logged); a calendar
 * mismatch against the event's listed time is flagged, not rejected —
 * the user confirms before saving.
 */

const limiter = routeLimiter();

const BodySchema = z.object({
  text: z.string().min(1).max(8000),
  event_starts_at: z.string().min(1),
});

function calendarDay(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = limiter.check(`booking-parse:${clientIp(request)}`);
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
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "body needs text and event_starts_at" },
      { status: 400 },
    );
  }
  try {
    const result = await parseBookingConfirmation(parsed.data.text, {
      config: serverLlmConfig(),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: `confirmation parse failed (${result.error.kind}): ${result.error.message}` },
        { status: 502 },
      );
    }
    const booking = result.value.booking;
    const parsedDay = booking.starts_at
      ? calendarDay(booking.starts_at)
      : null;
    const eventDay = calendarDay(parsed.data.event_starts_at);
    const mismatch =
      parsedDay !== null && eventDay !== null && parsedDay !== eventDay;
    return NextResponse.json({
      booking,
      mismatch,
      model: result.value.model,
    });
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      return NextResponse.json(
        { error: "model budget reached; try again later" },
        { status: 503 },
      );
    }
    console.error(
      `booking parse failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "booking parse failed" }, { status: 500 });
  }
}
