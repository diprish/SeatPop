import { readFileSync } from "node:fs";
import { z } from "zod";
import { PriceKindSchema } from "@seatpop/shared";
import type { ChatMessage } from "./types";

/**
 * Enrichment I/O for phase 2 (prompt_version `enrich.v1`).
 *
 * The model returns one flat object: every EXTRACTED field is a
 * {value, quote} pair verified by packages/shared (the quote must occur in
 * the event's own title/description/venue-name text). `summary_short` and
 * `tags` are GENERATED (no quotes; the verifier skips them).
 *
 * Privacy (CONTEXT rule 4): the venue STREET ADDRESS never reaches the
 * model — venue name only.
 *
 * v2 changes: setting/energy/crowd use fixed vocabularies grounded by
 * cue words (not value-in-quote), and durations accept number words.
 * The verifier side lives in packages/shared/verify.ts.
 */

/** Bumped only with packages/llm/prompts/enrich.v*.md (re-enriches all). */
export const ENRICH_PROMPT_VERSION = "enrich.v2";

/** Voting temperature for every enrichment pass (spec: adaptive voting). */
export const ENRICH_TEMPERATURE = 0.3;

/** Input guard: bound prompt size and cost per event. */
export const ENRICH_MAX_DESCRIPTION_CHARS = 6000;

const QuotedInt = z.object({
  value: z.number().int().nullable(),
  quote: z.string().nullable(),
});
const QuotedBool = z.object({
  value: z.boolean().nullable(),
  quote: z.string().nullable(),
});
const QuotedText = z.object({
  value: z.string().nullable(),
  quote: z.string().nullable(),
});
const QuotedTextList = z.object({
  value: z.array(z.string()).nullable(),
  quote: z.string().nullable(),
});
const QuotedDate = z.object({
  value: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  quote: z.string().nullable(),
});

/**
 * Raw model output. Unknown keys are stripped (nothing unrecognized can
 * reach a row). Every field optional at parse time: a missing field is the
 * same as an explicit null (unverified → dropped downstream).
 */
const QuotedPriceKind = z.object({
  value: PriceKindSchema.nullable(),
  quote: z.string().nullable(),
});

/**
 * Per-field schemas: the worker parses each field independently so one
 * mistyped field nulls itself instead of failing the whole pass.
 */
export const ENRICH_FIELD_SCHEMAS = {
  age_min: QuotedInt,
  age_max: QuotedInt,
  needs_adult: QuotedBool,
  setting: QuotedText,
  energy: QuotedText,
  crowd: QuotedText,
  duration_min: QuotedInt,
  language: QuotedText,
  accessibility: QuotedTextList,
  registration_hint: QuotedText,
  registration_opens_at: QuotedDate,
  price_kind: QuotedPriceKind,
  amount_min_cents: QuotedInt,
  amount_max_cents: QuotedInt,
  currency: QuotedText,
  price_text: QuotedText,
  fee_notes: QuotedText,
} as const;

export const EnrichmentOutputSchema = z.object({
  age_min: ENRICH_FIELD_SCHEMAS.age_min.optional(),
  age_max: ENRICH_FIELD_SCHEMAS.age_max.optional(),
  needs_adult: ENRICH_FIELD_SCHEMAS.needs_adult.optional(),
  setting: ENRICH_FIELD_SCHEMAS.setting.optional(),
  energy: ENRICH_FIELD_SCHEMAS.energy.optional(),
  crowd: ENRICH_FIELD_SCHEMAS.crowd.optional(),
  duration_min: ENRICH_FIELD_SCHEMAS.duration_min.optional(),
  language: ENRICH_FIELD_SCHEMAS.language.optional(),
  accessibility: ENRICH_FIELD_SCHEMAS.accessibility.optional(),
  registration_hint: ENRICH_FIELD_SCHEMAS.registration_hint.optional(),
  registration_opens_at: ENRICH_FIELD_SCHEMAS.registration_opens_at.optional(),
  price_kind: ENRICH_FIELD_SCHEMAS.price_kind.optional(),
  amount_min_cents: ENRICH_FIELD_SCHEMAS.amount_min_cents.optional(),
  amount_max_cents: ENRICH_FIELD_SCHEMAS.amount_max_cents.optional(),
  currency: ENRICH_FIELD_SCHEMAS.currency.optional(),
  price_text: ENRICH_FIELD_SCHEMAS.price_text.optional(),
  fee_notes: ENRICH_FIELD_SCHEMAS.fee_notes.optional(),
  summary_short: z.object({ value: z.string() }).optional(),
  tags: z.object({ value: z.array(z.string()) }).optional(),
});
export type EnrichmentOutput = z.infer<typeof EnrichmentOutputSchema>;

export const EnrichSummarySchema = z.object({ value: z.string() });
export const EnrichTagsSchema = z.object({ value: z.array(z.string()) });

/** Extracted (quote-verified) field names, in a fixed order. */
export const ENRICHED_FIELDS = [
  "age_min",
  "age_max",
  "needs_adult",
  "setting",
  "energy",
  "crowd",
  "duration_min",
  "language",
  "accessibility",
  "registration_hint",
  "registration_opens_at",
  "price_kind",
  "amount_min_cents",
  "amount_max_cents",
  "currency",
  "price_text",
  "fee_notes",
] as const;
export type EnrichedField = (typeof ENRICHED_FIELDS)[number];

let cachedPrompt: string | undefined;

/** Load packages/llm/prompts/enrich.vN.md (cached after first read). */
export function loadEnrichPrompt(): string {
  if (cachedPrompt === undefined) {
    const url = new URL(
      `../prompts/${ENRICH_PROMPT_VERSION}.md`,
      import.meta.url,
    );
    cachedPrompt = readFileSync(url, "utf8");
  }
  return cachedPrompt;
}

export interface EnrichmentPromptInput {
  title: string;
  description: string | null;
  /** Venue NAME only — never the street address (CONTEXT rule 4). */
  venueName: string | null;
  /** YYYY-MM-DD: resolves years for dates stated without one. */
  today: string;
  /** 1-based voting pass: keeps each pass's cache key distinct so passes
   * really are independent samples instead of cache hits. */
  pass: number;
}

/** Deterministic messages per (event, date, pass): re-runs hit the cache. */
export function buildEnrichmentMessages(
  input: EnrichmentPromptInput,
): ChatMessage[] {
  const description = (input.description ?? "").trim();
  const clipped =
    description.length > ENRICH_MAX_DESCRIPTION_CHARS
      ? `${description.slice(0, ENRICH_MAX_DESCRIPTION_CHARS)}\n[TRUNCATED]`
      : description;
  const user = [
    `TODAY: ${input.today}`,
    `VOTING PASS: ${input.pass} (fixed instructions are in the system prompt)`,
    "",
    `TITLE: ${input.title}`,
    `DESCRIPTION: ${clipped === "" ? "(none)" : clipped}`,
    `VENUE: ${input.venueName ?? "(unknown)"}`,
  ].join("\n");
  return [
    { role: "system", content: loadEnrichPrompt() },
    { role: "user", content: user },
  ];
}
