import { z } from "zod";

/**
 * Email-eval scaffold for phase 3 (worker/eval). Golden file
 * golden/emails.jsonl is EMPTY until the email path exists; the metric
 * code is real and tested so the future eval plugs straight in.
 *
 * Privacy (CONTEXT rule 4): golden rows carry ids and verdicts ONLY —
 * never raw bodies, senders, or addresses. The metric that matters most
 * is junk-email false creations: a promotional or malicious email must
 * never become an event.
 */

export const GoldenEmailRowSchema = z.object({
  email_id: z.string().min(1),
  /** True for spam, promos, phishing, and anything not a real event notice. */
  is_junk: z.boolean(),
  /** Optional note for the labeler (no bodies, no addresses, no names). */
  note: z.string().optional(),
});
export type GoldenEmailRow = z.infer<typeof GoldenEmailRowSchema>;

export function parseGoldenEmailsJsonl(text: string): GoldenEmailRow[] {
  const rows: GoldenEmailRow[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    if (line === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`golden/emails.jsonl line ${i + 1}: not valid JSON`);
    }
    const parsed = GoldenEmailRowSchema.safeParse(json);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new Error(`golden/emails.jsonl line ${i + 1}: ${details}`);
    }
    rows.push(parsed.data);
  }
  return rows;
}

export interface EmailDecision {
  email_id: string;
  /** True when the system created (or proposed) an event from this email. */
  created: boolean;
}

export interface EmailEvalResult {
  total: number;
  junkTotal: number;
  /** Junk emails the system turned into events. Must stay 0. */
  falseCreations: number;
  /** Junk ids the system created events from (for the report). */
  falseCreationIds: string[];
}

/**
 * Score email→event decisions against the golden verdicts. Decisions for
 * unknown ids are ignored (typos in an id must not silently pass or
 * fail the eval — the caller reports coverage separately).
 */
export function scoreEmailDecisions(
  golden: GoldenEmailRow[],
  decisions: EmailDecision[],
): EmailEvalResult {
  const verdicts = new Map(golden.map((row) => [row.email_id, row.is_junk]));
  const falseCreationIds: string[] = [];
  for (const decision of decisions) {
    const isJunk = verdicts.get(decision.email_id);
    if (isJunk === undefined) continue;
    if (isJunk && decision.created) falseCreationIds.push(decision.email_id);
  }
  return {
    total: golden.length,
    junkTotal: golden.filter((row) => row.is_junk).length,
    falseCreations: falseCreationIds.length,
    falseCreationIds,
  };
}
