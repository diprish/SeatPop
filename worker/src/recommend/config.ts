/**
 * Stage-2 scoring weights + pipeline limits for recommendations
 * (worker/recommend). Weights live here in config, not in logic, so the
 * eval can retune without touching the scorer.
 */

export interface RecommendWeights {
  /** Sooner events score higher (recency decay over ~weeks). */
  timeFit: number;
  /** Closer events score higher (haversine decay over ~km). */
  proximity: number;
  /** Overlap of event tags/category with stated interests. */
  interests: number;
  /** Cosine similarity to the interest embedding (when computed). */
  embedding: number;
  /** Fresh listings score higher (fetched_at decay). */
  novelty: number;
  /** Subtracted when event tags/category hit the avoid list. */
  avoid: number;
  /**
   * Exact age-band fits outrank unknown ages, which outrank
   * adjacent-only fits — strictly. The tier gap (0.4 of signal between
   * exact-min 0.9 and unknown 0.5, 0.5 between unknown and adjacent 0)
   * times this weight must exceed the spread of all other signals
   * combined (positives sum 10, avoid penalty 4, spread 14), so an
   * adjacent-only candidate can never outscore an exact fit however
   * attractive it is otherwise. Pinned by the invariant test in
   * recommend-score.test.ts — retune there first.
   */
  ageFit: number;
}

export const RECOMMEND_WEIGHTS: RecommendWeights = {
  timeFit: 2,
  proximity: 2,
  interests: 3,
  embedding: 2,
  novelty: 1,
  avoid: 4,
  ageFit: 40,
};

/** Stage-1 SQL candidate cap (mirrors recommend_candidates default). */
export const STAGE1_LIMIT = 200;
/** Candidates sent to the rerank model. */
export const RERANK_TOP_N = 30;
/** Final list length served + evaluated. */
export const FINAL_TOP_N = 10;
/**
 * Coverage pass on/off (SEATPOP_COVERAGE=off disables, e.g. for
 * before/after comparisons; unset means on).
 */
export const COVERAGE_ENABLED = process.env.SEATPOP_COVERAGE !== "off";
/** Top-N window the coverage pass protects (keep <= FINAL_TOP_N). */
export const COVERAGE_TOP_N = 10;
