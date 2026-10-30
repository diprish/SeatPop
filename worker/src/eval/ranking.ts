import { z } from "zod";

/**
 * Ranking-eval scaffold for phase 3 (worker/eval). Golden file
 * golden/ranking.jsonl is EMPTY until ranking exists; the metric code is
 * real and tested so the future eval plugs straight in.
 *
 * One golden row per request: the candidate set with graded relevance
 * judgments plus a hard-constraint flag per candidate (CONTEXT rule 3:
 * hard constraints — age fit, budget, distance, time, accessibility,
 * language, cancelled/full — live in SQL; the ranker must never surface
 * a violator in its top 10).
 */

export const RankingCandidateSchema = z.object({
  event_id: z.string().min(1),
  /** Graded relevance: 0 not relevant … 3 perfect. */
  relevance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  /** True when the candidate violates one of the request's hard constraints. */
  violates_constraint: z.boolean(),
});
export type RankingCandidate = z.infer<typeof RankingCandidateSchema>;

export const GoldenRankingRowSchema = z.object({
  query_id: z.string().min(1),
  candidates: z.array(RankingCandidateSchema).min(1),
});
export type GoldenRankingRow = z.infer<typeof GoldenRankingRowSchema>;

export function parseGoldenRankingJsonl(text: string): GoldenRankingRow[] {
  const rows: GoldenRankingRow[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    if (line === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`golden/ranking.jsonl line ${i + 1}: not valid JSON`);
    }
    const parsed = GoldenRankingRowSchema.safeParse(json);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new Error(`golden/ranking.jsonl line ${i + 1}: ${details}`);
    }
    rows.push(parsed.data);
  }
  return rows;
}

export type JudgmentMap = Map<string, RankingCandidate>;

/** Index a golden row's candidates by event id. */
export function judgmentsFor(row: GoldenRankingRow): JudgmentMap {
  const map: JudgmentMap = new Map();
  for (const candidate of row.candidates) map.set(candidate.event_id, candidate);
  return map;
}

const gain = (relevance: number): number => Math.pow(2, relevance) - 1;

const dcgAt = (gains: number[], k: number): number => {
  let total = 0;
  const depth = Math.min(k, gains.length);
  for (let i = 0; i < depth; i++) {
    total += (gains[i] as number) / Math.log2(i + 2);
  }
  return total;
};

/**
 * NDCG@10 of a ranked event-id list against graded judgments. Ids with
 * no judgment gain 0 (CONTEXT rule 3 discards out-of-set ids before
 * scoring, so survivors are simply non-relevant). A query with no
 * relevant candidate scores 1: there is nothing to miss.
 */
export function ndcgAt10(rankedIds: string[], judgments: JudgmentMap): number {
  const gains = rankedIds.map(
    (id) => gain(judgments.get(id)?.relevance ?? 0),
  );
  const ideal = [...judgments.values()]
    .map((j) => gain(j.relevance))
    .sort((a, b) => b - a);
  const idealDcg = dcgAt(ideal, 10);
  if (idealDcg === 0) return 1;
  return dcgAt(gains, 10) / idealDcg;
}

/**
 * Hard-constraint violations in the top 10: judged candidates flagged
 * violates_constraint. Unjudged ids are ignored (out-of-set ids are
 * discarded before scoring per CONTEXT rule 3).
 */
export function constraintViolationsTop10(
  rankedIds: string[],
  judgments: JudgmentMap,
): number {
  return rankedIds
    .slice(0, 10)
    .filter((id) => judgments.get(id)?.violates_constraint === true).length;
}
