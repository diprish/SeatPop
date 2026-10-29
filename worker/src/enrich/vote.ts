import { createHash } from "node:crypto";
import {
  ENRICHED_FIELDS,
  ENRICH_FIELD_SCHEMAS,
  ENRICH_PROMPT_VERSION,
  ENRICH_TEMPERATURE,
  EnrichSummarySchema,
  EnrichTagsSchema,
  buildEnrichmentMessages,
  chat,
  type EnrichedField,
  type LlmConfig,
  type LlmProvider,
} from "@seatpop/llm";
import {
  groundingQuote,
  normalizeEvidence,
  verifyAmount,
  verifyBool,
  verifyCrowd,
  verifyDuration,
  verifyEnergy,
  verifyInt,
  verifyPriceKind,
  verifyRegDate,
  verifySetting,
  verifyText,
  verifyTextList,
  type PriceKind,
} from "@seatpop/shared";
import { extractJsonObject, type ChatFn } from "../ingest/extract";

/**
 * Adaptive voting for enrichment (phase 2).
 *
 * Two passes at temperature 0.3 over the event's own title, description
 * and venue NAME (never the street address — CONTEXT rule 4). A third
 * pass runs only where a field disagrees; each field resolves by
 * majority, else null. Summary and tags are generated (no quotes), so
 * they take the first parsed pass and never trigger a third one.
 */

/** Fixed output limit: part of the cache key, so re-runs hit the cache. */
export const ENRICH_MAX_TOKENS = 2048;
/** Rows below this confidence join the printed review list. */
export const REVIEW_CONFIDENCE_BELOW = 0.7;
export const SUMMARY_MAX_CHARS = 140;
export const TAGS_MAX_COUNT = 8;

export type VerifiedValue = string | number | boolean | string[] | null;

export interface VerifiedPass {
  values: Record<EnrichedField, VerifiedValue>;
  quotes: Record<EnrichedField, string | null>;
  summary: string | null;
  tags: string[];
}

export interface PassCallStats {
  cached: boolean;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

export interface VoteResult {
  values: Record<EnrichedField, VerifiedValue>;
  quotes: Record<EnrichedField, string | null>;
  summary: string | null;
  tags: string[];
  confidence: number;
  passesUsed: number;
  /** Model id the API reported for the first successful call. */
  model: string;
  calls: PassCallStats[];
}

export interface EnrichEventInput {
  id: string;
  title: string;
  description: string | null;
  venueName: string | null;
}

/**
 * Change-detection hash: title + description + venue name + prompt, plus
 * the pricing policy and facet labels when the caller passes them (a new
 * policy or facet re-enriches the event even when its text is unchanged).
 */
export function sourceHashFor(
  input: Pick<EnrichEventInput, "title" | "description" | "venueName"> & {
    policy?: string;
    facets?: string;
  },
): string {
  return createHash("sha256")
    .update(
      [
        input.title,
        input.description ?? "",
        input.venueName ?? "",
        ENRICH_PROMPT_VERSION,
        input.policy ?? "",
        input.facets ?? "",
      ].join("\n"),
    )
    .digest("hex");
}

/** The verification source: the event's own text only, never the page. */
export function verificationSource(input: EnrichEventInput): string {
  return normalizeEvidence(
    [input.title, input.description ?? "", input.venueName ?? ""].join("\n"),
  );
}

function verifyField(
  field: EnrichedField,
  raw: unknown,
  sourceNorm: string,
): { value: VerifiedValue; quote: string | null } {
  const none = { value: null as VerifiedValue, quote: null as string | null };
  const parsed = ENRICH_FIELD_SCHEMAS[field].safeParse(raw);
  if (!parsed.success) return none;
  const { value, quote } = parsed.data as {
    value: string | number | boolean | string[] | null;
    quote: string | null;
  };
  let kept: VerifiedValue;
  switch (field) {
    case "age_min":
    case "age_max":
      kept = verifyInt(
        typeof value === "number" ? value : null,
        quote,
        sourceNorm,
        { min: 0, max: 130 },
      );
      break;
    case "duration_min":
      kept = verifyDuration(
        typeof value === "number" ? value : null,
        quote,
        sourceNorm,
      );
      break;
    case "setting":
      kept = verifySetting(
        typeof value === "string" ? value : null,
        quote,
        sourceNorm,
      );
      break;
    case "energy":
      kept = verifyEnergy(
        typeof value === "string" ? value : null,
        quote,
        sourceNorm,
      );
      break;
    case "crowd":
      kept = verifyCrowd(
        typeof value === "string" ? value : null,
        quote,
        sourceNorm,
      );
      break;
    case "amount_min_cents":
    case "amount_max_cents":
      kept = verifyAmount(
        typeof value === "number" ? value : null,
        quote,
        sourceNorm,
      );
      break;
    case "needs_adult":
      kept = verifyBool(
        typeof value === "boolean" ? value : null,
        quote,
        sourceNorm,
      );
      break;
    case "accessibility":
      kept = verifyTextList(
        Array.isArray(value) ? (value as string[]) : null,
        quote,
        sourceNorm,
      );
      break;
    case "registration_opens_at":
      kept = verifyRegDate(
        typeof value === "string" ? value : null,
        quote,
        sourceNorm,
      );
      break;
    case "price_kind": {
      const kind = verifyPriceKind(
        typeof value === "string" ? value : null,
        quote,
        sourceNorm,
      );
      return {
        value: (kind ?? "unknown") as PriceKind,
        quote:
          kind === null || kind === "unknown"
            ? null
            : groundingQuote(quote, sourceNorm),
      };
    }
    case "currency": {
      const code = verifyText(
        typeof value === "string" ? value : null,
        quote,
        sourceNorm,
      );
      kept =
        code !== null && /^[a-z]{3}$/.test(code) ? code.toUpperCase() : null;
      break;
    }
    default:
      kept = verifyText(
        typeof value === "string" ? value : null,
        quote,
        sourceNorm,
      );
      break;
  }
  return {
    value: kept,
    quote: kept === null ? null : groundingQuote(quote, sourceNorm),
  };
}

function emptyPass(): VerifiedPass {
  const values = {} as Record<EnrichedField, VerifiedValue>;
  const quotes = {} as Record<EnrichedField, string | null>;
  for (const field of ENRICHED_FIELDS) {
    values[field] = field === "price_kind" ? "unknown" : null;
    quotes[field] = null;
  }
  return { values, quotes, summary: null, tags: [] };
}

function parsePass(content: string, sourceNorm: string): VerifiedPass | null {
  let output: unknown;
  try {
    output = extractJsonObject(content);
  } catch {
    return null;
  }
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const record = output as Record<string, unknown>;
  const pass = emptyPass();
  for (const field of ENRICHED_FIELDS) {
    const checked = verifyField(field, record[field], sourceNorm);
    pass.values[field] = checked.value;
    pass.quotes[field] = checked.quote;
  }
  const summary = EnrichSummarySchema.safeParse(record["summary_short"]);
  if (summary.success) {
    const text = summary.data.value.replace(/\s+/g, " ").trim();
    pass.summary =
      text === ""
        ? null
        : text.length > SUMMARY_MAX_CHARS
          ? `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…`
          : text;
  }
  const tags = EnrichTagsSchema.safeParse(record["tags"]);
  if (tags.success) {
    const seen = new Set<string>();
    for (const tag of tags.data.value) {
      const clean = tag.replace(/\s+/g, " ").trim().toLowerCase();
      if (clean !== "" && !seen.has(clean)) seen.add(clean);
      if (seen.size >= TAGS_MAX_COUNT) break;
    }
    pass.tags = [...seen];
  }
  return pass;
}

const sameValue = (a: VerifiedValue, b: VerifiedValue): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export interface VoteDeps {
  config: LlmConfig;
  fetchImpl?: typeof fetch;
  chatFn?: ChatFn;
  /** Model override: the spark-comparison flag pins standard Spark. */
  model?: string;
  /** Provider override: baseten runs the same public-text task remotely. */
  provider?: LlmProvider;
  now?: Date;
}

/**
 * Enrich one event by adaptive majority vote. Returns null when no pass
 * produced parsable output (the event keeps no row and is retried on the
 * next run). Budget exhaustion throws BudgetExceeded from the client.
 */
export async function voteEnrichment(
  input: EnrichEventInput,
  deps: VoteDeps,
): Promise<VoteResult | null> {
  const chatFn: ChatFn = deps.chatFn ?? chat;
  const today = (deps.now ?? new Date()).toISOString().slice(0, 10);
  const sourceNorm = verificationSource(input);
  const calls: PassCallStats[] = [];
  const models: string[] = [];

  const runPass = async (pass: number): Promise<VerifiedPass | null> => {
    const result = await chatFn(
      {
        task: "listing_extraction",
        messages: buildEnrichmentMessages({
          title: input.title,
          description: input.description,
          venueName: input.venueName,
          today,
          pass,
        }),
        ...(deps.model ? { model: deps.model } : {}),
        ...(deps.provider ? { provider: deps.provider } : {}),
        temperature: ENRICH_TEMPERATURE,
        maxTokens: ENRICH_MAX_TOKENS,
      },
      { fetchImpl: deps.fetchImpl, config: deps.config },
    );
    if (!result.ok) {
      console.warn(
        `enrich: pass ${pass} for ${input.id} failed (${result.error.kind}): ${result.error.message}`,
      );
      return null;
    }
    calls.push({
      cached: result.value.cached,
      promptTokens: result.value.usage.promptTokens,
      completionTokens: result.value.usage.completionTokens,
      reasoningTokens: result.value.usage.reasoningTokens,
      costUsd: result.value.costUsd,
    });
    models.push(result.value.model);
    const parsed = parsePass(result.value.content, sourceNorm);
    if (!parsed) {
      console.warn(`enrich: pass ${pass} for ${input.id} was not usable JSON`);
    }
    return parsed;
  };

  const first = await runPass(1);
  const second = await runPass(2);
  const parsed = [first, second].filter(
    (p): p is VerifiedPass => p !== null,
  );
  if (parsed.length === 0) return null;
  if (parsed.length === 1) {
    const only = parsed[0] as VerifiedPass;
    return finalize(only, only.summary, only.tags, 0.5, models[0] as string, calls);
  }
  const [a, b] = parsed as [VerifiedPass, VerifiedPass];
  const fields = [...ENRICHED_FIELDS];
  if (fields.every((f) => sameValue(a.values[f], b.values[f]))) {
    return finalize(a, a.summary, a.tags, 1, models[0] as string, calls);
  }
  const third = await runPass(3);
  if (!third) {
    // No majority possible: keep agreements, null the rest.
    const merged = emptyPass();
    let agreed = 0;
    for (const f of fields) {
      if (sameValue(a.values[f], b.values[f])) {
        merged.values[f] = a.values[f];
        merged.quotes[f] = a.quotes[f];
        agreed++;
      }
    }
    return finalize(
      merged,
      a.summary,
      a.tags,
      agreed / fields.length,
      models[0] as string,
      calls,
    );
  }
  const merged = emptyPass();
  let firstTwoAgree = 0;
  for (const f of fields) {
    const ab = sameValue(a.values[f], b.values[f]);
    if (ab) firstTwoAgree++;
    const winner = ab
      ? { value: a.values[f], quote: a.quotes[f] }
      : sameValue(a.values[f], third.values[f])
        ? { value: a.values[f], quote: a.quotes[f] }
        : sameValue(b.values[f], third.values[f])
          ? { value: b.values[f], quote: b.quotes[f] }
          : null;
    if (winner) {
      merged.values[f] = winner.value;
      merged.quotes[f] = winner.quote;
    }
  }
  // Confidence is the first-two agreement rate: a field that needed
  // arbitration stays less certain than one two samples agreed on.
  return finalize(
    merged,
    a.summary,
    a.tags,
    firstTwoAgree / fields.length,
    models[0] as string,
    calls,
  );
}

function finalize(
  pass: VerifiedPass,
  summary: string | null,
  tags: string[],
  confidence: number,
  model: string,
  calls: PassCallStats[],
): VoteResult {
  // Range repairs: inverted pairs null out (evidence can't support a fix).
  const values = { ...pass.values };
  const quotes = { ...pass.quotes };
  const ageMin = values.age_min;
  const ageMax = values.age_max;
  if (
    typeof ageMin === "number" &&
    typeof ageMax === "number" &&
    ageMin > ageMax
  ) {
    values.age_min = null;
    values.age_max = null;
    quotes.age_min = null;
    quotes.age_max = null;
  }
  const amtMin = values.amount_min_cents;
  const amtMax = values.amount_max_cents;
  if (
    typeof amtMin === "number" &&
    typeof amtMax === "number" &&
    amtMin > amtMax
  ) {
    values.amount_min_cents = null;
    values.amount_max_cents = null;
    quotes.amount_min_cents = null;
    quotes.amount_max_cents = null;
  }
  return {
    values,
    quotes,
    summary,
    tags,
    confidence,
    passesUsed: calls.length,
    model,
    calls,
  };
}
