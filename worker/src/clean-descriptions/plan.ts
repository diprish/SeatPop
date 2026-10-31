import { sanitizeText } from "@seatpop/shared";

/**
 * One-off description re-clean: which stored rows change under the
 * shared sanitizer. Pure planning (tested); run.ts does the REST calls.
 * Idempotent: sanitizeText runs to a fixpoint, so a second run plans
 * zero updates.
 */

export interface DescriptionRow {
  id: string;
  description: string | null;
}

export interface DescriptionUpdate {
  id: string;
  before: string;
  after: string;
}

export function planDescriptionClean(
  rows: DescriptionRow[],
): DescriptionUpdate[] {
  const updates: DescriptionUpdate[] = [];
  for (const row of rows) {
    if (row.description === null) continue;
    const after = sanitizeText(row.description);
    if (after !== row.description) {
      updates.push({ id: row.id, before: row.description, after });
    }
  }
  return updates;
}
