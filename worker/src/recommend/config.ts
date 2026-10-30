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
}

export const RECOMMEND_WEIGHTS: RecommendWeights = {
  timeFit: 2,
  proximity: 2,
  interests: 3,
  embedding: 2,
  novelty: 1,
  avoid: 4,
};

/** Stage-1 SQL candidate cap (mirrors recommend_candidates default). */
export const STAGE1_LIMIT = 200;
/** Candidates sent to the rerank model. */
export const RERANK_TOP_N = 30;
/** Final list length served + evaluated. */
export const FINAL_TOP_N = 10;
