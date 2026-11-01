import { z } from "zod";
import {
  normalizeEvidence,
  redactBookingPii,
} from "@seatpop/shared";
import { chat } from "./client";
import type { LlmConfig } from "./config";
import type { ChatResult, LlmError } from "./types";

/**
 * Booking confirmation parsing (phase 8): a pasted confirmation text or
 * email body → {confirmation id, event date/time}, each with the verbatim
 * quote it came from.
 *
 * Privacy: emails, phones, addresses, and postal codes are redacted
 * before the call, the task runs on standard Spark via Meta only (never
 * contributor, never Baseten), and the raw paste is discarded by the
 * caller. Anything not verifiable against the redacted text is nulled,
 * never passed through: a missing fact is null, an invented one is
 * rejected the same way.
 *
 * The prompt is inline (not a prompts/*.md file) so the web route can
 * use this without filesystem reads at request time.
 */

export const BOOKING_PARSE_VERSION = "booking.v1";

const SYSTEM_PROMPT = `You read a pasted event-registration confirmation (possibly an email body) and extract the booking facts. Reply with raw JSON only, no prose, matching this shape:
{"confirmation_id": "ABC123" | null, "confirmation_quote": "verbatim span holding the id" | null, "starts_at": "2031-03-08T15:00:00Z" | null, "datetime_quote": "verbatim span holding the date/time" | null}
Rules, in order:
- Copy spans verbatim. Never invent an id, date, or time that is not stated.
- confirmation_id: the booking/confirmation/reference number exactly as shown; null when none is stated. confirmation_quote is the exact span it came from.
- starts_at: the event's date/time as an ISO instant with timezone (assume America/Toronto when the text names no zone); null when no date/time is stated. datetime_quote is the exact span it came from.
- Never copy names, emails, phone numbers, or addresses into any field; the input was redacted, and [email]/[phone]/[address]/[postal code] placeholders must never appear in values or quotes.`;

const BookingReplySchema = z.object({
  confirmation_id: z.string().max(100).nullable(),
  confirmation_quote: z.string().max(500).nullable(),
  starts_at: z.string().max(100).nullable(),
  datetime_quote: z.string().max(500).nullable(),
});
type BookingReply = z.infer<typeof BookingReplySchema>;

export interface VerifiedBooking {
  confirmation_id: string | null;
  confirmation_quote: string | null;
  starts_at: string | null;
  datetime_quote: string | null;
}

/** First { ... } block of a reply (the model is asked for raw JSON only). */
function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no JSON object in booking-parse reply");
  }
  return JSON.parse(content.slice(start, end + 1));
}

/** Normalized quote, grounded in the source and placeholder-free. */
function groundedQuote(
  quote: string | null,
  sourceNorm: string,
): string | null {
  if (quote === null) return null;
  const q = normalizeEvidence(quote);
  if (q === "" || q.includes("[")) return null;
  return sourceNorm.includes(q) ? q : null;
}

/**
 * Null anything not verifiable: the id must sit inside its grounded
 * quote, the instant must parse with a grounded quote. Placeholders and
 * ungrounded text can never pass.
 */
export function verifyBookingExtract(
  reply: BookingReply,
  redactedNorm: string,
): VerifiedBooking {
  let confirmation_id: string | null = null;
  let confirmation_quote: string | null = null;
  const idQuote = groundedQuote(reply.confirmation_quote, redactedNorm);
  if (reply.confirmation_id !== null && idQuote !== null) {
    const id = normalizeEvidence(reply.confirmation_id);
    if (id !== "" && !id.includes("[") && idQuote.includes(id)) {
      confirmation_id = reply.confirmation_id.trim();
      confirmation_quote = reply.confirmation_quote?.trim() ?? null;
    }
  }
  let starts_at: string | null = null;
  let datetime_quote: string | null = null;
  const whenQuote = groundedQuote(reply.datetime_quote, redactedNorm);
  if (reply.starts_at !== null && whenQuote !== null) {
    const ms = Date.parse(reply.starts_at);
    if (!Number.isNaN(ms)) {
      starts_at = new Date(ms).toISOString();
      datetime_quote = reply.datetime_quote?.trim() ?? null;
    }
  }
  return { confirmation_id, confirmation_quote, starts_at, datetime_quote };
}

export type BookingParseResult =
  | { ok: true; value: { booking: VerifiedBooking; model: string } }
  | { ok: false; error: LlmError };

export interface BookingParseDeps {
  config: LlmConfig;
  fetchImpl?: typeof fetch;
  chatFn?: (
    request: Parameters<typeof chat>[0],
    options?: Parameters<typeof chat>[1],
  ) => Promise<ChatResult>;
}

/**
 * Parse redacted confirmation text into verified booking facts. Budget
 * exhaustion throws BudgetExceeded (the caller reports it; the user
 * retries). The raw paste never leaves this call.
 */
export async function parseBookingConfirmation(
  text: string,
  deps: BookingParseDeps,
): Promise<BookingParseResult> {
  const redacted = redactBookingPii(text).trim().slice(0, 4000);
  if (redacted === "") {
    return {
      ok: false,
      error: { kind: "schema", message: "confirmation text is empty" },
    };
  }
  const chatFn = deps.chatFn ?? chat;
  const result = await chatFn(
    {
      task: "booking_parse",
      provider: "meta",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: redacted },
      ],
      temperature: 0,
    },
    { fetchImpl: deps.fetchImpl, config: deps.config },
  );
  if (!result.ok) return { ok: false, error: result.error };
  let json: unknown;
  try {
    json = extractJson(result.value.content);
  } catch {
    return {
      ok: false,
      error: { kind: "schema", message: "model reply was not JSON" },
    };
  }
  const parsed = BookingReplySchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        kind: "schema",
        message: `model reply failed booking validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      },
    };
  }
  return {
    ok: true,
    value: {
      booking: verifyBookingExtract(parsed.data, normalizeEvidence(redacted)),
      model: result.value.model,
    },
  };
}
