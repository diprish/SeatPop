import { isOwnerRow } from "../seed-owner-events/seed";

/**
 * Deterministic months-as-years repair planner: no model calls.
 *
 * Old enrichment stored month-stated ages unconverted ("19-35 months"
 * became 19-35), and the model re-enrichment never repaired the live
 * rows. This planner finds events whose own listing text (title +
 * description — never page-level raw text, which could match a
 * different event's span) states a single months/mois range and
 * converts it to whole years: floor(min/12), ceil(max/12).
 *
 * Only months-magnitude rows are touched: a stored side already in
 * years (< 5, the verifyAge ceiling for month quotes) is the model's
 * call, never ours — v4-correct rows like (0, 1) plan nothing.
 * Idempotent: a repaired row's stored ages equal the conversion, so a
 * second run plans nothing. Owner-transcribed rows never qualify.
 */

export const REPAIR_MODEL = "repair-months";

export interface MonthsRange {
  minMonths: number;
  maxMonths: number;
  /** The verbatim matched span, stamped as the evidence quote. */
  quote: string;
}

/**
 * A months range: two numbers joined by a dash, "to", or "à", directly
 * before months/mois ("19-35 months", "0-18 months", "6 to 24 months",
 * "0 à 18 mois"). Single spans ("6 months and up") and frequencies
 * ("every month", "monthly") do not match — the model owns those.
 *
 * The trailing guard is a case-sensitive "no lowercase letter next"
 * (spelled with explicit classes, no /i flag, so the guard can tell
 * cases apart): it admits glued uppercase continuations from tag
 * strips ("0-18 monthsPlease note" — live Tuesday Babytime text)
 * while still rejecting "monthly". The quote stays the clean span.
 */
export function findMonthsRanges(text: string): MonthsRange[] {
  const re =
    /\b(\d{1,3})\s*(?:-|–|—|[Tt][Oo]|[àÀ])\s*(\d{1,3})\s*(?:[Mm][Oo][Nn][Tt][Hh][Ss]?|[Mm][Oo][Ii][Ss])(?![a-z])/g;
  const out: MonthsRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const minMonths = Number(match[1]);
    const maxMonths = Number(match[2]);
    if (minMonths > maxMonths) continue;
    if (maxMonths > 120) continue;
    out.push({ minMonths, maxMonths, quote: match[0].trim() });
  }
  return out;
}

/** Months to whole years: min down, max up (19-35 → 1-3, 0-18 → 0-2). */
export function monthsToYears(
  minMonths: number,
  maxMonths: number,
): { min: number; max: number } {
  return {
    min: Math.floor(minMonths / 12),
    max: Math.ceil(maxMonths / 12),
  };
}

export interface MonthsRepairRow {
  eventId: string;
  title: string;
  description: string | null;
  ageMin: number | null;
  ageMax: number | null;
  model: string | null;
}

export interface MonthsCorrection {
  eventId: string;
  title: string;
  quote: string;
  beforeMin: number | null;
  beforeMax: number | null;
  afterMin: number;
  afterMax: number;
}

/**
 * One side's repaired value: already-converted sides stay, null sides
 * fill, months magnitudes (≥ 5) convert, years-scale sides (< 5) stay —
 * a small stored value beside a months range is the model's territory.
 */
function decideSide(stored: number | null, computed: number): number {
  if (stored === computed) return stored;
  if (stored === null) return computed;
  if (stored >= 5) return computed;
  return stored;
}

export function planMonthsRepair(
  rows: MonthsRepairRow[],
): MonthsCorrection[] {
  const plans: MonthsCorrection[] = [];
  for (const row of rows) {
    if (isOwnerRow(row)) continue;
    const ranges = findMonthsRanges(
      `${row.title}\n${row.description ?? ""}`,
    );
    if (ranges.length === 0) continue;
    const first = ranges[0] as MonthsRange;
    // Bilingual repeats of one range agree; distinct ranges are
    // ambiguous (which binds the stored ages?) — leave those to review.
    const agreed = ranges.every(
      (range) =>
        range.minMonths === first.minMonths &&
        range.maxMonths === first.maxMonths,
    );
    if (!agreed) continue;
    const { min, max } = monthsToYears(first.minMonths, first.maxMonths);
    const afterMin = decideSide(row.ageMin, min);
    const afterMax = decideSide(row.ageMax, max);
    if (afterMin === row.ageMin && afterMax === row.ageMax) continue;
    if (afterMin > afterMax) continue;
    plans.push({
      eventId: row.eventId,
      title: row.title,
      quote: first.quote,
      beforeMin: row.ageMin,
      beforeMax: row.ageMax,
      afterMin,
      afterMax,
    });
  }
  return plans;
}
