import { z } from "zod";

/**
 * Quote verifier for model-extracted fields (CONTEXT rule 2: the model
 * proposes, the verifier disposes).
 *
 * Every extracted value must ground in a verbatim evidence quote that
 * occurs in the event's OWN source text (title + description + venue
 * name — never the whole listing page, so a price belonging to a
 * different event on the page cannot leak in). Matching normalises
 * whitespace, case, and quote styles. Anything failing verification is
 * null, never a guess.
 */

export const PRICE_KINDS = [
  "free",
  "paid",
  "pay_what_you_can",
  "donation",
  "member_only",
  "unknown",
] as const;

export const PriceKindSchema = z.enum(PRICE_KINDS);
export type PriceKind = z.infer<typeof PriceKindSchema>;

/** Whitespace runs → one space, curly quotes → ASCII, lowercased. */
export function normalizeEvidence(value: string): string {
  return value
    .replace(/[‘’‚‛′‵]/g, "'")
    .replace(/[“”„‟″‶]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The normalized quote when it is non-empty and occurs in the normalized
 * source; otherwise null. Every verifier below funnels through this.
 */
export function groundingQuote(
  quote: string | null | undefined,
  sourceNorm: string,
): string | null {
  if (!quote) return null;
  const q = normalizeEvidence(quote);
  if (q === "" || !sourceNorm.includes(q)) return null;
  return q;
}

/**
 * Copied text: the value must occur inside its own grounding quote
 * (guards paraphrase: reworded values have no verbatim span).
 */
export function verifyText(
  value: string | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
): string | null {
  const q = groundingQuote(quote, sourceNorm);
  if (!q || !value) return null;
  const v = normalizeEvidence(value);
  if (v === "" || !q.includes(v)) return null;
  return v;
}

/**
 * Integers whose digits must appear in the quote: ages ("ages 3 to 5" →
 * 3), durations ("90 minutes" → 90). Word-form numbers ("one-hour" → 60)
 * are dropped — conservative by design, since CONTEXT forbids stating a
 * number that is not in the quote.
 */
export function verifyInt(
  value: number | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
  opts: { min: number; max: number },
): number | null {
  const q = groundingQuote(quote, sourceNorm);
  if (
    q === null ||
    value === null ||
    value === undefined ||
    !Number.isInteger(value) ||
    value < opts.min ||
    value > opts.max ||
    !q.includes(String(value))
  ) {
    return null;
  }
  return value;
}

/** Booleans ground in any source span (no textual value to match). */
export function verifyBool(
  value: boolean | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
): boolean | null {
  if (typeof value !== "boolean") return null;
  if (groundingQuote(quote, sourceNorm) === null) return null;
  return value;
}

/** Every list item must occur inside the one grounding quote. */
export function verifyTextList(
  values: string[] | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
): string[] | null {
  const q = groundingQuote(quote, sourceNorm);
  if (!q || !values || values.length === 0 || values.length > 20) return null;
  const out: string[] = [];
  for (const item of values) {
    const v = normalizeEvidence(item ?? "");
    if (v === "" || !q.includes(v)) return null;
    out.push(v);
  }
  return out;
}

/** "free" signals: exactly the three the spec allows (word-bound free). */
const FREE_SIGNAL = /(\bfree\b|no cost|no charge)/;

/**
 * "Free X" phrases that never mean free admission. Tight by design: a
 * false drop costs one field, a false "free" misleads a household budget.
 */
const FREE_EXCLUSIONS = ["parking", "wifi", "wi-fi", "coat check"];

/**
 * price_kind grounds in any source span, with two extra rules: "free"
 * needs an explicit admission signal (never "free parking"), and
 * "unknown" needs no quote at all (it is the absence of a signal).
 */
export function verifyPriceKind(
  value: string | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
): PriceKind | null {
  if (value === null || value === undefined || value === "unknown") {
    return "unknown";
  }
  if (!PRICE_KINDS.includes(value as PriceKind)) return null;
  const q = groundingQuote(quote, sourceNorm);
  if (q === null) return null;
  if (value === "free") {
    if (!FREE_SIGNAL.test(q)) return null;
    if (FREE_EXCLUSIONS.some((excluded) => q.includes(excluded))) return null;
  }
  return value as PriceKind;
}

const CURRENCY_TOKEN = /(\$|cad|usd|dollar|cent|€|£)/;

/**
 * Amounts in cents: kept only when the quote carries digits AND a
 * currency token (spec rule). The dollar figure itself is not matched —
 * cents cannot be verified textually — so the quote is the audit trail.
 */
export function verifyAmount(
  value: number | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
): number | null {
  const q = groundingQuote(quote, sourceNorm);
  if (
    q === null ||
    value === null ||
    value === undefined ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100_000_00 ||
    !/\d/.test(q) ||
    !CURRENCY_TOKEN.test(q)
  ) {
    return null;
  }
  return value;
}

const MONTH_TOKEN =
  /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|\d)/;

/**
 * Registration-open dates (YYYY-MM-DD): grounding quote plus a month or
 * digit token (so "register soon" cannot evidence an invented date),
 * plus a real-calendar check.
 */
export function verifyRegDate(
  value: string | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
): string | null {
  const q = groundingQuote(quote, sourceNorm);
  if (q === null || !value || !MONTH_TOKEN.test(q)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const check = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (
    check.getUTCFullYear() !== Number(m[1]) ||
    check.getUTCMonth() !== Number(m[2]) - 1 ||
    check.getUTCDate() !== Number(m[3])
  ) {
    return null;
  }
  return value;
}
