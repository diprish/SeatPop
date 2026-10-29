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

/**
 * Fixed vocabularies (enrich.v2): a value is accepted only when the
 * grounded quote contains one of its cue words (word boundaries, so
 * "mushroom" never matches "room"). A cue preceded within three words by
 * no/not/without/none/never does not count ("no registration" is not a
 * cap). This replaces value-in-quote for these three fields — the prompt
 * teaches normalized values ("indoors") the old rule always dropped.
 */
const SETTING_KEYWORDS: Record<string, string[]> = {
  indoors: [
    "indoor",
    "indoors",
    "hall",
    "halls",
    "room",
    "rooms",
    "gym",
    "gyms",
    "gymnasium",
    "arena",
    "arenas",
    "rink",
    "rinks",
    "pool",
    "pools",
    "studio",
    "studios",
    "auditorium",
    "classroom",
    "classrooms",
  ],
  outdoors: [
    "outdoor",
    "outdoors",
    "park",
    "parks",
    "garden",
    "gardens",
    "trail",
    "trails",
    "field",
    "fields",
    "playground",
    "playgrounds",
    "courtyard",
    "patio",
    "beach",
    "beaches",
    "forest",
    "forests",
  ],
  online: [
    "online",
    "virtual",
    "zoom",
    "webinar",
    "webinars",
    "livestream",
    "live stream",
    "ms teams",
  ],
};

const ENERGY_KEYWORDS: Record<string, string[]> = {
  calm: [
    "calm",
    "quiet",
    "quietly",
    "gentle",
    "relaxing",
    "relaxed",
    "relaxation",
    "slow",
    "peaceful",
    "restorative",
    "meditation",
    "meditative",
    "mindfulness",
    "tranquil",
    "soothing",
    "low-key",
    "low key",
  ],
  moderate: [
    "moderate",
    "casual",
    "casually",
    "social",
    "interactive",
    "playful",
    "fun",
    "lively",
  ],
  "high-energy": [
    "high-energy",
    "high energy",
    "energetic",
    "intense",
    "intensity",
    "vigorous",
    "cardio",
    "fast-paced",
    "adrenaline",
    "bootcamp",
    "workout",
    "athletic",
  ],
};

const CROWD_KEYWORDS: Record<string, string[]> = {
  "small-group": [
    "small",
    "intimate",
    "limited",
    "limit",
    "spot",
    "spots",
    "spaces",
    "seat",
    "seats",
    "capped",
    "maximum",
    "max",
    "registration",
    "registered",
    "register",
  ],
  "large-group": [
    "large",
    "big",
    "festival",
    "festivals",
    "fair",
    "fairground",
    "hundreds",
    "thousand",
    "thousands",
    "everyone",
    "everybody",
    "crowd",
    "crowds",
    "open to all",
    "all welcome",
  ],
};

const NEGATION = /\b(no|not|without|none|never)\b/;

function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An unnegated whole-word cue hit anywhere in the normalized quote. */
function hasCueWord(quoteNorm: string, cue: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(cue)}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(quoteNorm)) !== null) {
    const before = quoteNorm.slice(Math.max(0, match.index - 30), match.index);
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

function verifyVocab(
  value: string | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
  vocab: Record<string, string[]>,
): string | null {
  const q = groundingQuote(quote, sourceNorm);
  if (q === null || !value) return null;
  const cues = vocab[value];
  if (!cues) return null;
  return cues.some((cue) => hasCueWord(q, cue)) ? value : null;
}

export function verifySetting(
  value: string | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
): string | null {
  const q = groundingQuote(quote, sourceNorm);
  if (q === null || !value) return null;
  // Hybrid is structural: cue words from at least two place categories.
  if (value === "hybrid") {
    const hits = Object.values(SETTING_KEYWORDS).filter((cues) =>
      cues.some((cue) => hasCueWord(q, cue)),
    ).length;
    return hits >= 2 ? value : null;
  }
  return verifyVocab(value, quote, sourceNorm, SETTING_KEYWORDS);
}

export function verifyEnergy(
  value: string | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
): string | null {
  return verifyVocab(value, quote, sourceNorm, ENERGY_KEYWORDS);
}

export function verifyCrowd(
  value: string | null | undefined,
  quote: string | null | undefined,
  sourceNorm: string,
): string | null {
  return verifyVocab(value, quote, sourceNorm, CROWD_KEYWORDS);
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

/**
 * Deterministic duration parse of a normalized quote, in whole minutes:
 * digits ("90 minutes", "1.5 hours"), number words ("one-hour",
 * "twenty minutes"), "an hour", half/quarter hours. Hyphenated compounds
 * ("forty-five") are out of scope and return null.
 */
export function parseDurationMinutes(quoteNorm: string): number | null {
  const half = /\bhalf\s*(?:an?\s*)?hour\b/.exec(quoteNorm);
  if (half) return 30;
  const quarter = /\bquarter\s*(?:of\s*an?\s*)?hour\b/.exec(quoteNorm);
  if (quarter) return 15;
  const words = Object.keys(NUMBER_WORDS).join("|");
  // Lookbehind (not \b): "forty-five minutes" must not parse as 5.
  const m = new RegExp(
    `(?<![\\w-])(\\d+(?:\\.\\d+)?|${words})\\s*-?\\s*(hours?|hrs?|minutes?|mins?)\\b`,
  ).exec(quoteNorm);
  if (!m) return null;
  const raw = m[1] as string;
  const amount = /^\d/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? NaN);
  if (!Number.isFinite(amount)) return null;
  const unit = m[2] as string;
  const minutes = unit.startsWith("h") ? amount * 60 : amount;
  return Number.isInteger(minutes) ? minutes : null;
}

/**
 * Durations: grounding quote plus the figure either as digits ("90") or
 * parsed from words ("one-hour" → 60).
 */
export function verifyDuration(
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
    value < 1 ||
    value > 10080
  ) {
    return null;
  }
  if (q.includes(String(value))) return value;
  return parseDurationMinutes(q) === value ? value : null;
}

/**
 * Facet-label ages ("Adults 50-plus" → min 50): digits the label itself
 * states. Labels without digits ("Teen", "Adult") yield null — stored as
 * labels only, never converted to ages.
 */
export function parseFacetAges(
  label: string,
): { min?: number; max?: number } | null {
  const norm = normalizeEvidence(label);
  let m = /\bages?\s*(\d{1,3})\s*(?:to|-|–)\s*(\d{1,3})\b/.exec(norm);
  if (m) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    return min <= max ? { min, max } : null;
  }
  m = /\b(\d{1,3})\s*-?\s*(?:\+|plus|and\s*(?:up|over))\b/.exec(norm);
  if (m) return { min: Number(m[1]) };
  return null;
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
