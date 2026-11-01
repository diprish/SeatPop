import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  EventCategorySchema,
  normalizeEvidence,
  PriceKindSchema,
  verifyAge,
  verifyAmount,
  verifyPriceKind,
  type EventCategory,
  type PriceKind,
} from "@seatpop/shared";
import { sourceHashFor } from "../enrich/vote";
import type {
  EnrichmentUpsert,
  PricingUpsert,
} from "../enrich/store";

/**
 * Owner-curated events seed: facts the owner transcribes BY HAND from
 * official City pages (never crawled, never derived). Validation is
 * strict and loud: bad rows fail the run with every error listed, never
 * a partial load. Every stored value runs through the same quote
 * verifier enrichment uses, grounded in the transcription itself
 * (title + venue + quotes) — the owner record is its own source text.
 *
 * Row shape: {title, venue_name, starts_at (zoned ISO), ends_at?,
 * price_kind, amount_min_cents?, amount_max_cents?, price_quote,
 * ages_quote?, age_min?, age_max?, source_url (required https),
 * category}. Ages without an ages_quote are rejected: unverifiable
 * ages are not stored.
 */

export const OWNER_MODEL = "owner-transcribed";
export const OWNER_PROMPT_VERSION = "owner-v1";
export const OWNER_SOURCE_NAME = "City of Ottawa Recreation";
/**
 * The owner's reference page (registration dates they transcribe
 * from). Stored as the manual source's URL; never fetched — the row
 * stays enabled=false and out of sources.json.
 */
export const OWNER_SOURCE_URL =
  "https://ottawa.ca/en/recreation-and-parks/register-courses-and-camps/registration-terms-and-cancellations/registration-dates";
export const OWNER_SOURCE_NOTES =
  "Manual entry: the owner transcribed the facts by hand. No crawler.";

/** True for candidates whose enrichment is owner transcription. */
export function isOwnerRow(candidate: {
  model: string | null;
}): boolean {
  return candidate.model === OWNER_MODEL;
}

const OwnerEventInputSchema = z.object({
  title: z.string(),
  venue_name: z.string(),
  starts_at: z.string(),
  ends_at: z.string().optional(),
  price_kind: PriceKindSchema,
  amount_min_cents: z.number().int().nonnegative().optional(),
  amount_max_cents: z.number().int().nonnegative().optional(),
  price_quote: z.string(),
  ages_quote: z.string().optional(),
  age_min: z.number().int().min(0).max(130).optional(),
  age_max: z.number().int().min(0).max(130).optional(),
  source_url: z.string(),
  category: EventCategorySchema,
});
export type OwnerEventInput = z.infer<typeof OwnerEventInputSchema>;

export interface ValidatedOwnerEvent {
  title: string;
  venue_name: string;
  starts_at: string;
  ends_at: string | null;
  price_kind: PriceKind;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  currency: string | null;
  price_quote: string;
  ages_quote: string | null;
  age_min: number | null;
  age_max: number | null;
  source_url: string;
  category: EventCategory;
  /** Canonical content hash: change detection for idempotent upserts. */
  rowHash: string;
}

export function seedFileUrl(): URL {
  return new URL(
    "../../../data/seed/owner-curated-events.json",
    import.meta.url,
  );
}

/** A datetime is only accepted with an explicit zone (Z or ±offset). */
function zonedInstant(raw: string): string | null {
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Currency for stored amounts, read off the quote's own token (€/£/USD
 * win explicitly; $/CAD/dollars in a City of Ottawa listing is CAD).
 * Null when no amounts are stored.
 */
export function currencyForQuote(
  priceQuote: string,
  hasAmounts: boolean,
): string | null {
  if (!hasAmounts) return null;
  const quote = priceQuote.toLowerCase();
  if (quote.includes("€")) return "EUR";
  if (quote.includes("£")) return "GBP";
  if (/\busd\b/.test(quote)) return "USD";
  return "CAD";
}

export function validateOwnerEvent(
  raw: unknown,
  index: number,
): { ok: true; event: ValidatedOwnerEvent } | { ok: false; error: string } {
  const shape = OwnerEventInputSchema.safeParse(raw);
  if (!shape.success) {
    const details = shape.error.issues
      .map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `row ${index}: ${details}` };
  }
  const input = shape.data;
  const fail = (reason: string) => ({ ok: false as const, error: `row ${index}: ${reason}` });
  const title = input.title.trim();
  if (title === "") return fail("empty title");
  const venueName = input.venue_name.trim();
  if (venueName === "") return fail("empty venue_name");
  if (input.source_url.trim() === "") {
    return fail("missing source_url (the official link is required)");
  }
  let sourceUrl: string;
  try {
    const parsed = new URL(input.source_url.trim());
    if (parsed.protocol !== "https:") throw new Error("not https");
    sourceUrl = parsed.toString();
  } catch {
    return fail("source_url must be an https URL");
  }
  const startsAt = zonedInstant(input.starts_at.trim());
  if (startsAt === null) {
    return fail("starts_at needs an ISO datetime with a timezone");
  }
  let endsAt: string | null = null;
  if (input.ends_at !== undefined) {
    endsAt = zonedInstant(input.ends_at.trim());
    if (endsAt === null) {
      return fail("ends_at needs an ISO datetime with a timezone");
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      return fail("ends_at must be after starts_at");
    }
  }
  const amountMin = input.amount_min_cents ?? null;
  const amountMax = input.amount_max_cents ?? null;
  if (amountMin !== null && amountMax !== null && amountMin > amountMax) {
    return fail("amount_min_cents exceeds amount_max_cents");
  }
  const ageMin = input.age_min ?? null;
  const ageMax = input.age_max ?? null;
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    return fail("age_min exceeds age_max");
  }
  const priceQuote = input.price_quote.trim();
  if (priceQuote === "") return fail("empty price_quote");
  const agesQuote =
    input.ages_quote === undefined || input.ages_quote.trim() === ""
      ? null
      : input.ages_quote.trim();
  if ((ageMin !== null || ageMax !== null) && agesQuote === null) {
    return fail("ages need an ages_quote (unverifiable ages are not stored)");
  }
  // The transcription is its own ground: the verifier's containment
  // check passes by construction, leaving the real rules (free signal,
  // digits + currency, digits in quote, months handling).
  const sourceNorm = normalizeEvidence(
    [title, venueName, priceQuote, agesQuote ?? ""].join("\n"),
  );
  const kind = verifyPriceKind(input.price_kind, priceQuote, sourceNorm);
  if (kind === null) {
    return fail(
      `price_quote does not support price_kind "${input.price_kind}"`,
    );
  }
  for (const [label, amount] of [
    ["amount_min_cents", amountMin],
    ["amount_max_cents", amountMax],
  ] as const) {
    if (
      amount !== null &&
      verifyAmount(amount, priceQuote, sourceNorm) === null
    ) {
      return fail(
        `${label} rejected: price_quote must contain the price digits and a currency ($, CAD, …)`,
      );
    }
  }
  for (const [label, age] of [
    ["age_min", ageMin],
    ["age_max", ageMax],
  ] as const) {
    if (
      age !== null &&
      verifyAge(age, agesQuote, sourceNorm, { min: 0, max: 130 }) === null
    ) {
      return fail(`${label} rejected: ages_quote must contain the age digits`);
    }
  }
  const validated = {
    title,
    venue_name: venueName,
    starts_at: startsAt,
    ends_at: endsAt,
    price_kind: kind,
    amount_min_cents: amountMin,
    amount_max_cents: amountMax,
    currency: currencyForQuote(priceQuote, amountMin !== null || amountMax !== null),
    price_quote: priceQuote,
    ages_quote: agesQuote,
    age_min: ageMin,
    age_max: ageMax,
    source_url: sourceUrl,
    category: input.category,
  };
  const rowHash = createHash("sha256")
    .update(JSON.stringify(validated))
    .digest("hex");
  return { ok: true, event: { ...validated, rowHash } };
}

/** Load + validate the seed file; throws listing every problem. */
export function loadOwnerSeed(fileUrl?: URL): ValidatedOwnerEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(fileUrl ?? seedFileUrl(), "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `owner seed unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("owner seed invalid: the file must hold an array of rows");
  }
  const errors: string[] = [];
  const events: ValidatedOwnerEvent[] = [];
  parsed.forEach((raw, index) => {
    const checked = validateOwnerEvent(raw, index);
    if (checked.ok) events.push(checked.event);
    else errors.push(checked.error);
  });
  if (errors.length > 0) {
    throw new Error(`owner seed invalid:\n  ${errors.join("\n  ")}`);
  }
  return events;
}

/**
 * Owner enrichment row (minus event_id): transcribed ages with their
 * evidence, the owner marker, and the same change hash enrichment
 * computes — so scheduled runs see the row as current and the model
 * guard below never even matters until a prompt bump.
 */
export function buildOwnerEnrichment(
  event: ValidatedOwnerEvent,
): Omit<EnrichmentUpsert, "event_id"> {
  return {
    age_min: event.age_min,
    age_max: event.age_max,
    needs_adult: null,
    setting: null,
    energy: null,
    crowd: null,
    duration_min: null,
    language: null,
    accessibility: [],
    registration_hint: null,
    registration_opens_at: null,
    summary_short: null,
    tags: [],
    evidence: {
      age_min: { value: event.age_min, quote: event.ages_quote },
      age_max: { value: event.age_max, quote: event.ages_quote },
    },
    model: OWNER_MODEL,
    prompt_version: OWNER_PROMPT_VERSION,
    source_hash: sourceHashFor({
      title: event.title,
      description: null,
      venueName: event.venue_name,
      policy: "",
      facets: "",
    }),
    confidence: 1,
  };
}

/** Owner pricing row (minus event_id): everything is event text. */
export function buildOwnerPricing(
  event: ValidatedOwnerEvent,
): Omit<PricingUpsert, "event_id"> {
  return {
    price_kind: event.price_kind,
    amount_min_cents: event.amount_min_cents,
    amount_max_cents: event.amount_max_cents,
    currency: event.currency,
    price_text: event.price_quote,
    evidence_quote: event.price_quote,
    fee_notes: null,
    price_basis: "event_text",
  };
}
