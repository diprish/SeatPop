import {
  candidateAgeTier,
  countExactFits,
  type AgeFitMember,
  type Preferences,
} from "@seatpop/shared";
import { RECOMMEND_WEIGHTS, type RecommendWeights } from "./config";

/**
 * Stage-2 scoring (worker/recommend): pure TypeScript over SQL-approved
 * candidates. Weights come from config; every signal is 0..1 (missing
 * data scores neutral 0.5, never 0 — absence of evidence is not evidence
 * of irrelevance). Ties break deterministically by start time, then id.
 */

export interface ScoreEvent {
  event_id: string;
  starts_at: string;
  distance_km: number | null;
  category: string | null;
  tags: string[];
  fetched_at: string;
  age_min: number | null;
  age_max: number | null;
}

export interface ScoreSignals {
  timeFit: number;
  proximity: number;
  interests: number;
  embedding: number;
  novelty: number;
  avoidHit: boolean;
  ageFit: number;
}

export interface ScoredEvent {
  event_id: string;
  score: number;
  signals: ScoreSignals;
}

const DAY_MS = 86_400_000;

/** Sooner starts score higher: 1 at now, decaying over ~weeks. */
export function timeFitSignal(startsAt: string, nowMs: number): number {
  const daysOut = Math.max(
    0,
    (new Date(startsAt).getTime() - nowMs) / DAY_MS,
  );
  return 1 / (1 + daysOut / 7);
}

/** Closer venues score higher; unknown distance is neutral. */
export function proximitySignal(distanceKm: number | null): number {
  if (distanceKm === null) return 0.5;
  return 1 / (1 + Math.max(0, distanceKm) / 5);
}

function haystack(event: Pick<ScoreEvent, "category" | "tags">): string {
  return [event.category ?? "", ...event.tags].join(" ").toLowerCase();
}

function wordHit(hay: string, needle: string): boolean {
  const words = needle
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");
  return words.length > 0 && words.every((w) => hay.includes(w));
}

/**
 * Interest affinity: fraction of stated interests matched by the event's
 * category/tags (multi-word interests need every word). No stated
 * interests is neutral.
 */
export function interestSignal(
  event: Pick<ScoreEvent, "category" | "tags">,
  interests: string[],
): number {
  if (interests.length === 0) return 0.5;
  const hay = haystack(event);
  const matched = interests.filter((interest) => wordHit(hay, interest));
  return matched.length / interests.length;
}

/** Fresh listings score higher (novelty = listing freshness here). */
export function noveltySignal(fetchedAt: string, nowMs: number): number {
  const ageDays = Math.max(
    0,
    (nowMs - new Date(fetchedAt).getTime()) / DAY_MS,
  );
  return 1 / (1 + ageDays / 7);
}

/** True when any avoid term hits the event's category/tags. */
export function avoidHit(
  event: Pick<ScoreEvent, "category" | "tags">,
  avoid: string[],
): boolean {
  if (avoid.length === 0) return false;
  const hay = haystack(event);
  return avoid.some((term) => wordHit(hay, term));
}

/**
 * Age fit: exact-band fits score 0.9–1.0 (rising with the share of
 * members fit exactly), unknown ages 0.5, adjacent-only 0. The tier
 * gaps are what the ageFit weight multiplies into strict ordering —
 * see the config comment. A memberless prefs object is neutral.
 */
export function ageFitSignal(
  event: Pick<ScoreEvent, "age_min" | "age_max" | "category">,
  members: AgeFitMember[],
): number {
  if (members.length === 0) return 0.5;
  const tier = candidateAgeTier(
    { age_min: event.age_min, age_max: event.age_max, category: event.category },
    members,
  );
  if (tier === "unknown") return 0.5;
  if (tier === "adjacent") return 0;
  return 0.9 + (0.1 * countExactFits(event, members)) / members.length;
}

export interface ScoreOptions {
  weights?: RecommendWeights;
  nowMs?: number;
  /**
   * Precomputed embedding similarities by event id (0..1, higher is
   * closer). Absent entries are neutral — the web lite path passes no
   * map at all, the worker eval path passes real similarities.
   */
  embeddingSimilarity?: Map<string, number>;
}

export function scoreEvent(
  event: ScoreEvent,
  prefs: Pick<Preferences, "interests" | "avoid" | "members">,
  options: ScoreOptions = {},
): ScoredEvent {
  const weights = options.weights ?? RECOMMEND_WEIGHTS;
  const nowMs = options.nowMs ?? Date.now();
  const embedding = options.embeddingSimilarity?.get(event.event_id) ?? 0.5;
  const signals: ScoreSignals = {
    timeFit: timeFitSignal(event.starts_at, nowMs),
    proximity: proximitySignal(event.distance_km),
    interests: interestSignal(event, prefs.interests),
    embedding: Math.min(1, Math.max(0, embedding)),
    novelty: noveltySignal(event.fetched_at, nowMs),
    avoidHit: avoidHit(event, prefs.avoid),
    ageFit: ageFitSignal(event, prefs.members),
  };
  const score =
    weights.timeFit * signals.timeFit +
    weights.proximity * signals.proximity +
    weights.interests * signals.interests +
    weights.embedding * signals.embedding +
    weights.novelty * signals.novelty +
    weights.ageFit * signals.ageFit -
    (signals.avoidHit ? weights.avoid : 0);
  return { event_id: event.event_id, score, signals };
}

/**
 * Deterministic stage-2 order: score desc, then soonest start, then id.
 * Events are looked up by id from the candidates map.
 */
export function orderByScore<T extends ScoreEvent>(
  candidates: T[],
  prefs: Pick<Preferences, "interests" | "avoid" | "members">,
  options: ScoreOptions = {},
): Array<{ event: T; scored: ScoredEvent }> {
  const ranked = candidates.map((event) => ({
    event,
    scored: scoreEvent(event, prefs, options),
  }));
  ranked.sort((a, b) => {
    if (b.scored.score !== a.scored.score) {
      return b.scored.score - a.scored.score;
    }
    const timeA = new Date(a.event.starts_at).getTime();
    const timeB = new Date(b.event.starts_at).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.event.event_id < b.event.event_id ? -1 : 1;
  });
  return ranked;
}
