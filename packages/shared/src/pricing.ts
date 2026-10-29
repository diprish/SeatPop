import { z } from "zod";
import type { PriceKind } from "./verify";

/**
 * Where a price_kind came from. Mirrored by the CHECK constraint on
 * event_pricing.price_basis in supabase/migrations/0004_pricing_policy.sql
 * — keep both lists in sync.
 */
export const PRICE_BASES = ["event_text", "source_policy"] as const;

export const PriceBasisSchema = z.enum(PRICE_BASES);
export type PriceBasis = z.infer<typeof PriceBasisSchema>;

/**
 * Short owner label for source-policy attribution. Policies are
 * migration-curated and OPL is currently the only owner; if a second
 * owner ever appears, this single choke point must become a lookup.
 */
export const POLICY_OWNER_SHORT_NAME = "OPL";

/**
 * Display label for a price kind. The safety property: a policy-derived
 * value is always attributed to the policy owner ("free (per OPL)"),
 * never shown as a plain fact ("Free"), because the evidence is the
 * source's policy, not the event's own text. This holds for every kind,
 * present and future — only free policies exist today. Non-free
 * event-text kinds pass through unchanged; their display copy is
 * future UI work.
 */
export function priceDisplayLabel(kind: PriceKind, basis: PriceBasis): string {
  if (basis === "source_policy") {
    return `${kind} (per ${POLICY_OWNER_SHORT_NAME})`;
  }
  if (kind === "free") return "Free";
  return kind;
}
