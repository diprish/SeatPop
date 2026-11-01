import type { PriceKind } from "@seatpop/shared";
import type { VoteResult } from "../enrich/vote";
import type { GoldenEvent, GoldenLabels } from "./golden";

/**
 * Enrichment-eval scoring for phase 3 (worker/eval).
 *
 * Compares voted enrichment output against human labels text-to-text: the
 * model side is the verifier-cleaned vote (no source-policy merge, no
 * facet ages), because the CSV rule is "label only what the text says"
 * and the eval measures extraction from text, not the deterministic
 * merge rules.
 */

/** The eight labeled fields, in CSV column order. */
export const SCORED_FIELDS = [
  "age_min",
  "age_max",
  "price_kind",
  "amount",
  "setting",
  "language",
  "registration_hint",
  "accessibility",
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

export interface ModelPrediction {
  age_min: number | null;
  age_max: number | null;
  price_kind: string;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  setting: string | null;
  language: string | null;
  registration_hint: string | null;
  accessibility: string[];
}

/** Project a vote result onto the scored fields (policy/facets excluded). */
export function predictionFromVote(result: VoteResult): ModelPrediction {
  const num = (v: unknown): number | null =>
    typeof v === "number" ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  return {
    age_min: num(result.values.age_min),
    age_max: num(result.values.age_max),
    price_kind:
      typeof result.values.price_kind === "string"
        ? result.values.price_kind
        : "unknown",
    amount_min_cents: num(result.values.amount_min_cents),
    amount_max_cents: num(result.values.amount_max_cents),
    setting: str(result.values.setting),
    language: str(result.values.language),
    registration_hint: str(result.values.registration_hint),
    accessibility: Array.isArray(result.values.accessibility)
      ? result.values.accessibility.filter(
          (s): s is string => typeof s === "string",
        )
      : [],
  };
}

const normText = (s: string): string =>
  s.trim().replace(/\s+/g, " ").toLowerCase();

function equalText(
  label: string | null,
  pred: string | null,
): boolean {
  if (label === null || label === "") return pred === null || pred === "";
  if (pred === null || pred === "") return false;
  return normText(label) === normText(pred);
}

function normAmount(
  min: number | null,
  max: number | null,
): { min: number | null; max: number | null } {
  if (min === null && max === null) return { min: null, max: null };
  const single = min ?? max;
  return { min: min ?? single, max: max ?? single };
}

/**
 * Amount equality with single-value expansion on both sides: a lone $25
 * (min 2500, max null) and an explicit 2500/2500 pair are the same claim.
 */
export function equalAmount(
  label: Pick<GoldenLabels, "amount_min_cents" | "amount_max_cents">,
  pred: Pick<ModelPrediction, "amount_min_cents" | "amount_max_cents">,
): boolean {
  const l = normAmount(label.amount_min_cents, label.amount_max_cents);
  const p = normAmount(pred.amount_min_cents, pred.amount_max_cents);
  return l.min === p.min && l.max === p.max;
}

function normList(items: string[]): string[] {
  return items.map(normText).filter((s) => s !== "").sort();
}

export function equalAccessibility(
  label: string[],
  pred: string[],
): boolean {
  const a = normList(label);
  const b = normList(pred);
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

export function fieldCorrect(
  field: ScoredField,
  label: GoldenLabels,
  pred: ModelPrediction,
): boolean {
  switch (field) {
    case "age_min":
      return label.age_min === pred.age_min;
    case "age_max":
      return label.age_max === pred.age_max;
    case "price_kind":
      return label.price_kind === (pred.price_kind as PriceKind);
    case "amount":
      return equalAmount(label, pred);
    case "setting":
      return equalText(label.setting, pred.setting);
    case "language":
      return equalText(label.language, pred.language);
    case "registration_hint":
      return equalText(label.registration_hint, pred.registration_hint);
    case "accessibility":
      return equalAccessibility(label.accessibility, pred.accessibility);
  }
}

/** True when the label says nothing for this field (the CSV cell was blank). */
export function labelBlank(field: ScoredField, label: GoldenLabels): boolean {
  switch (field) {
    case "age_min":
      return label.age_min === null;
    case "age_max":
      return label.age_max === null;
    case "price_kind":
      return label.price_kind === "unknown";
    case "amount":
      return (
        label.amount_min_cents === null && label.amount_max_cents === null
      );
    case "setting":
      return label.setting === null || label.setting === "";
    case "language":
      return label.language === null || label.language === "";
    case "registration_hint":
      return (
        label.registration_hint === null || label.registration_hint === ""
      );
    case "accessibility":
      return label.accessibility.length === 0;
  }
}

/** True when the model output is empty for this field. */
export function predBlank(field: ScoredField, pred: ModelPrediction): boolean {
  switch (field) {
    case "age_min":
      return pred.age_min === null;
    case "age_max":
      return pred.age_max === null;
    case "price_kind":
      return pred.price_kind === "unknown";
    case "amount":
      return pred.amount_min_cents === null && pred.amount_max_cents === null;
    case "setting":
      return pred.setting === null || pred.setting === "";
    case "language":
      return pred.language === null || pred.language === "";
    case "registration_hint":
      return pred.registration_hint === null || pred.registration_hint === "";
    case "accessibility":
      return pred.accessibility.length === 0;
  }
}

export interface FieldScore {
  correct: number;
  total: number;
  accuracy: number;
  modelNulls: number;
  nullRate: number;
}

export interface TokenTotals {
  prompt: number;
  completion: number;
  reasoning: number;
  livePasses: number;
  cachedPasses: number;
}

export interface ModelScore {
  eventsScored: number;
  eventsFailed: number;
  fields: Record<ScoredField, FieldScore>;
  /** Events where the model said "free" but the label is not free. */
  falseFree: number;
  /**
   * Events with any other price error: a non-free kind mismatch, an
   * amount mismatch, or both. Disjoint from falseFree: every price
   * error lands in exactly one of the two buckets.
   */
  wrongPrice: number;
  /** (event, field) pairs where the label is blank but the model said a value. */
  hallucinatedFields: number;
  tokens: TokenTotals;
  /** Live spend only: cached passes cost $0 by construction. */
  costUsd: number;
  costPer1kUsd: number;
}

function freshFieldScore(): FieldScore {
  return { correct: 0, total: 0, accuracy: 0, modelNulls: 0, nullRate: 0 };
}

/**
 * Score one model's voted outputs against the golden labels. Events whose
 * enrichment produced no usable pass (null) are counted as failed and
 * excluded from every denominator — silently scoring them as all-wrong
 * would conflate pipeline failures with extraction errors. Rows marked
 * ambiguous-excluded skip scoring entirely (their labels stay, and the
 * report lists them, but they enter no denominator).
 */
export function scoreModel(
  goldens: GoldenEvent[],
  outputs: Map<string, VoteResult | null>,
): ModelScore {
  const fields = {} as Record<ScoredField, FieldScore>;
  for (const field of SCORED_FIELDS) fields[field] = freshFieldScore();
  let eventsScored = 0;
  let eventsFailed = 0;
  let falseFree = 0;
  let wrongPrice = 0;
  let hallucinatedFields = 0;
  const tokens: TokenTotals = {
    prompt: 0,
    completion: 0,
    reasoning: 0,
    livePasses: 0,
    cachedPasses: 0,
  };
  let costUsd = 0;

  for (const golden of goldens) {
    if (golden.excluded) continue;
    const output = outputs.get(golden.event_id) ?? null;
    if (!output) {
      eventsFailed++;
      continue;
    }
    eventsScored++;
    const pred = predictionFromVote(output);
    for (const call of output.calls) {
      if (call.cached) tokens.cachedPasses++;
      else tokens.livePasses++;
      tokens.prompt += call.promptTokens;
      tokens.completion += call.completionTokens;
      tokens.reasoning += call.reasoningTokens;
      costUsd += call.costUsd;
    }
    for (const field of SCORED_FIELDS) {
      const score = fields[field] as FieldScore;
      score.total++;
      if (fieldCorrect(field, golden.labels, pred)) score.correct++;
      if (predBlank(field, pred)) score.modelNulls++;
      if (labelBlank(field, golden.labels) && !predBlank(field, pred)) {
        hallucinatedFields++;
      }
    }
    const kindOk = fieldCorrect("price_kind", golden.labels, pred);
    const amountOk = fieldCorrect("amount", golden.labels, pred);
    if (pred.price_kind === "free" && golden.labels.price_kind !== "free") {
      falseFree++;
    } else if (!kindOk || !amountOk) {
      wrongPrice++;
    }
  }

  for (const field of SCORED_FIELDS) {
    const score = fields[field] as FieldScore;
    score.accuracy = score.total > 0 ? score.correct / score.total : 0;
    score.nullRate = score.total > 0 ? score.modelNulls / score.total : 0;
  }
  return {
    eventsScored,
    eventsFailed,
    fields,
    falseFree,
    wrongPrice,
    hallucinatedFields,
    tokens,
    costUsd,
    costPer1kUsd: eventsScored > 0 ? (costUsd / eventsScored) * 1000 : 0,
  };
}
