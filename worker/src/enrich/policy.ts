import { parseFacetAges } from "@seatpop/shared";
import type { EnrichedField } from "@seatpop/llm";
import type { VerifiedValue } from "./vote";

/**
 * Source-level pricing policies and OPL age-facet ages (phase 2b).
 * Pure merge rules; the runner feeds them voted values + source metadata.
 */

export interface SourcePolicy {
  kind: string;
  quote: string;
  url: string;
  /** Facet labels the policy covers; null/empty = every event. */
  scope: string[] | null;
}

export interface PolicyOutcome {
  priceKind: string;
  evidenceQuote: string | null;
  basis: "event_text" | "source_policy";
  applied: boolean;
}

/**
 * Apply a source policy when the event carries no fee signal of its own:
 * voted kind is unknown and amounts/price_text/fee_notes/currency are all
 * empty. Event text always wins ties. A scoped policy (OPL kids slices)
 * additionally needs an overlapping facet label.
 */
export function applyPricingPolicy(
  values: Record<EnrichedField, VerifiedValue>,
  eventQuote: string | null,
  policy: SourcePolicy | null,
  facetLabels: string[],
): PolicyOutcome {
  const votedKind =
    typeof values.price_kind === "string" ? values.price_kind : "unknown";
  const eventOutcome: PolicyOutcome = {
    priceKind: votedKind,
    evidenceQuote: eventQuote,
    basis: "event_text",
    applied: false,
  };
  if (!policy) return eventOutcome;
  const hasFeeSignal =
    votedKind !== "unknown" ||
    values.amount_min_cents !== null ||
    values.amount_max_cents !== null ||
    values.price_text !== null ||
    values.fee_notes !== null ||
    values.currency !== null;
  if (hasFeeSignal) return eventOutcome;
  if (
    policy.scope !== null &&
    policy.scope.length > 0 &&
    !facetLabels.some((label) => policy.scope?.includes(label))
  ) {
    return eventOutcome;
  }
  return {
    priceKind: policy.kind,
    evidenceQuote: policy.quote,
    basis: "source_policy",
    applied: true,
  };
}

export interface FacetOutcome {
  ageMin: number | null;
  ageMax: number | null;
  /** Labels recorded as structured evidence (always, digits or not). */
  labels: string[];
}

/**
 * OPL age-facet ages: digit-bearing facet labels must ALL agree on the
 * same min/max, else labels-only. Text-verified ages (passed in) always
 * win over facet ages — the event's own words beat the slice it came in.
 */
export function applyFacetAges(
  textMin: number | null,
  textMax: number | null,
  facetLabels: string[],
): FacetOutcome {
  const labels = [...new Set(facetLabels)];
  const outcome: FacetOutcome = {
    ageMin: textMin,
    ageMax: textMax,
    labels,
  };
  if (textMin !== null || textMax !== null) return outcome;
  const parsed = labels
    .map((label) => parseFacetAges(label))
    .filter((p): p is { min?: number; max?: number } => p !== null);
  if (parsed.length === 0) return outcome;
  const mins = new Set(parsed.map((p) => p.min ?? null));
  const maxes = new Set(parsed.map((p) => p.max ?? null));
  // Unanimous digit facets only; conflicting audience tags constrain nothing.
  if (mins.size === 1 && maxes.size === 1) {
    outcome.ageMin = [...mins][0] ?? null;
    outcome.ageMax = [...maxes][0] ?? null;
  }
  return outcome;
}
