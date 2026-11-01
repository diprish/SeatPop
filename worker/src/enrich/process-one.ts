import {
  ENRICHED_FIELDS,
  ENRICH_PROMPT_VERSION,
  type LlmConfig,
  type LlmProvider,
} from "@seatpop/llm";
import { optionsForSource } from "../ingest/source-config";
import type { StoreConfig } from "../ingest/store";
import { zonedLocalToUtc } from "../ingest/tz";
import { applyFacetAges, applyPricingPolicy } from "./policy";
import {
  upsertEnrichment,
  upsertPricing,
  type EnrichCandidate,
} from "./store";
import {
  sourceHashFor,
  voteEnrichment,
  type VerifiedValue,
  type VoteResult,
} from "./vote";

/**
 * One candidate through vote → facet/policy → upserts, shared by the
 * enrich runner and the months repair script (a single assembly, so a
 * repair row is shaped exactly like a normal enrichment).
 *
 * Budget exhaustion throws BudgetExceeded to the caller (both callers
 * already handle it); a null vote returns no_pass and writes nothing.
 */

function regOpensAtUtc(
  value: VerifiedValue,
  timezone: string,
): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  try {
    return zonedLocalToUtc(
      {
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
        hour: 0,
        minute: 0,
        second: 0,
      },
      timezone,
    );
  } catch {
    return null;
  }
}

const numOrNull = (v: VerifiedValue): number | null =>
  typeof v === "number" ? v : null;
const strOrNull = (v: VerifiedValue): string | null =>
  typeof v === "string" ? v : null;
const boolOrNull = (v: VerifiedValue): boolean | null =>
  typeof v === "boolean" ? v : null;
const listOrEmpty = (v: VerifiedValue): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

export interface ProcessOneDeps {
  store: StoreConfig;
  llmConfig: LlmConfig;
  modelOverride: string | undefined;
  providerOverride: LlmProvider;
  noTraining: boolean;
  basetenExhausted: boolean;
  now: Date;
  hashFor: (candidate: EnrichCandidate) => string;
  facetLabelsFor: (candidate: EnrichCandidate) => string[];
}

export interface ProcessedCandidate {
  result: VoteResult;
  facet: ReturnType<typeof applyFacetAges>;
  pricing: ReturnType<typeof applyPricingPolicy>;
}

export type ProcessOneOutcome =
  | { status: "processed"; processed: ProcessedCandidate }
  | { status: "no_pass" }
  | { status: "skipped_baseten" };

/**
 * Facet + hash closures over the listing-source map, shared by the
 * enrich runner and the months repair script. One definition, so the
 * repair script's staleness check can never drift from the runner's:
 * a row either path enriches is current for both.
 */
export function hashContext(listingSources: Map<string, string[]>): {
  facetLabelsFor: (candidate: EnrichCandidate) => string[];
  hashFor: (candidate: EnrichCandidate) => string;
} {
  // Facet labels from every listing source (OPL age slices); a policy or
  // facet change re-enriches the event via the hash inputs.
  const facetLabelsFor = (c: EnrichCandidate): string[] =>
    [...new Set(listingSources.get(c.id) ?? [])]
      .map((name) => optionsForSource(name).ageFacet?.label)
      .filter((label): label is string => label !== undefined)
      .sort();
  const policyStringFor = (c: EnrichCandidate): string =>
    c.policy
      ? [c.policy.kind, c.policy.quote, c.policy.url, ...(c.policy.scope ?? [])].join("\n")
      : "";
  const hashFor = (c: EnrichCandidate): string =>
    sourceHashFor({
      title: c.title,
      description: c.description,
      venueName: c.venueName,
      policy: policyStringFor(c),
      facets: facetLabelsFor(c).join(","),
    });
  return { facetLabelsFor, hashFor };
}

export async function processOneCandidate(
  candidate: EnrichCandidate,
  deps: ProcessOneDeps,
): Promise<ProcessOneOutcome> {
  if (deps.noTraining && deps.basetenExhausted) {
    return { status: "skipped_baseten" };
  }
  const result = await voteEnrichment(
    {
      id: candidate.id,
      title: candidate.title,
      description: candidate.description,
      venueName: candidate.venueName,
    },
    {
      config: deps.llmConfig,
      model: deps.noTraining ? undefined : deps.modelOverride,
      provider: deps.noTraining ? "baseten" : deps.providerOverride,
      fallback: deps.noTraining ? "none" : undefined,
      now: deps.now,
    },
  );
  if (!result) {
    console.warn(`enrich: ${candidate.id} produced no usable pass; skipped`);
    return { status: "no_pass" };
  }
  const facetLabels = deps.facetLabelsFor(candidate);
  const facet = applyFacetAges(
    numOrNull(result.values.age_min),
    numOrNull(result.values.age_max),
    facetLabels,
  );
  const pricing = applyPricingPolicy(
    result.values,
    result.quotes.price_kind,
    candidate.policy,
    facetLabels,
  );
  const evidence: Record<
    string,
    { value: unknown; quote: string | null; basis?: string }
  > = {};
  for (const field of ENRICHED_FIELDS) {
    evidence[field] = {
      value: result.values[field],
      quote: result.quotes[field],
    };
  }
  evidence["summary_short"] = { value: result.summary, quote: null };
  evidence["tags"] = { value: result.tags, quote: null };
  evidence["age_facet"] = {
    value: facet.labels.length > 0 ? facet.labels : null,
    quote: null,
  };
  evidence["price_kind"] = {
    value: pricing.priceKind,
    quote: pricing.evidenceQuote,
    basis: pricing.basis,
  };
  await upsertEnrichment(deps.store, {
    event_id: candidate.id,
    age_min: facet.ageMin,
    age_max: facet.ageMax,
    needs_adult: boolOrNull(result.values.needs_adult),
    setting: strOrNull(result.values.setting),
    energy: strOrNull(result.values.energy),
    crowd: strOrNull(result.values.crowd),
    duration_min: numOrNull(result.values.duration_min),
    language: strOrNull(result.values.language),
    accessibility: listOrEmpty(result.values.accessibility),
    registration_hint: strOrNull(result.values.registration_hint),
    registration_opens_at: regOpensAtUtc(
      result.values.registration_opens_at,
      candidate.timezone,
    ),
    summary_short: result.summary,
    tags: result.tags,
    evidence,
    model: result.model,
    prompt_version: ENRICH_PROMPT_VERSION,
    source_hash: deps.hashFor(candidate),
    confidence: result.confidence,
  });
  await upsertPricing(deps.store, {
    event_id: candidate.id,
    price_kind: pricing.priceKind,
    amount_min_cents: numOrNull(result.values.amount_min_cents),
    amount_max_cents: numOrNull(result.values.amount_max_cents),
    currency: strOrNull(result.values.currency),
    price_text: strOrNull(result.values.price_text),
    evidence_quote: pricing.evidenceQuote,
    fee_notes: strOrNull(result.values.fee_notes),
    price_basis: pricing.basis,
  });
  return { status: "processed", processed: { result, facet, pricing } };
}
