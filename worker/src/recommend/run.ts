import { z } from "zod";
import {
  BudgetExceeded,
  chat,
  type ChatResult,
  type LlmConfig,
} from "@seatpop/llm";
import {
  AgeBandSchema,
  PreferencesSchema,
  type Preferences,
} from "@seatpop/shared";
import { collapseRows } from "./collapse";
import { FINAL_TOP_N, RERANK_TOP_N, STAGE1_LIMIT } from "./config";
import { groupSeries, type SeriesSlot } from "./series";
import {
  rerankCandidates,
  templatedReason,
  type RerankCandidate,
} from "./rerank";
import { orderByScore, type ScoreEvent } from "./score";

/**
 * Recommendation orchestration (worker/recommend): prefs → SQL
 * candidates → stage-2 scoring → rerank (or deterministic fallback).
 * Used by the web API route and the worker eval script alike. Guests
 * pass prefs JSON (stored nowhere); signed-in users pass a household id
 * whose rows RLS scopes to their JWT.
 */

export type RecommendErrorCode =
  | "invalid"
  | "unauthorized"
  | "unknown_area"
  | "upstream";

export class RecommendError extends Error {
  readonly code: RecommendErrorCode;

  constructor(code: RecommendErrorCode, message: string) {
    super(message);
    this.name = "RecommendError";
    this.code = code;
  }
}

/** One recommend_candidates() row (validated — schema drift fails loudly). */
export const CandidateRowSchema = z.object({
  event_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  timezone: z.string(),
  venue_name: z.string().nullable(),
  venue_lat: z.number().nullable(),
  venue_lng: z.number().nullable(),
  distance_km: z.number().nullable(),
  category: z.string().nullable(),
  status: z.string(),
  source_url: z.string(),
  age_min: z.number().nullable(),
  age_max: z.number().nullable(),
  age_fallback: z.boolean(),
  age_flag: z.string().nullable(),
  price_kind: z.string(),
  price_label: z.string(),
  amount_min_cents: z.number().nullable(),
  amount_max_cents: z.number().nullable(),
  currency: z.string().nullable(),
  accessibility: z.array(z.string()),
  language: z.string().nullable(),
  tags: z.array(z.string()),
  summary_short: z.string().nullable(),
  fetched_at: z.string(),
});
export type CandidateRow = z.infer<typeof CandidateRowSchema>;

export interface RecommendOccurrence {
  event_id: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
}

export interface RecommendItem extends CandidateRow {
  score: number;
  reason: string;
  reasonFromModel: boolean;
  /** Later series occurrences, soonest first (empty for singles). */
  more_dates: RecommendOccurrence[];
}

export interface RecommendMeta {
  reranked: boolean;
  model: string | null;
  warnings: string[];
}

export interface RecommendResult {
  items: RecommendItem[];
  meta: RecommendMeta;
}

export type RecommendInput =
  | { prefs: unknown }
  | { householdId: string };

export interface RecommendDeps {
  supabaseUrl: string;
  anonKey: string;
  /** End-user JWT for household reads (RLS); absent for guests. */
  userJwt?: string;
  fetchImpl?: typeof fetch;
  chatFn?: (
    request: Parameters<typeof chat>[0],
    options?: Parameters<typeof chat>[1],
  ) => Promise<ChatResult>;
  llmConfig: LlmConfig;
  now?: Date;
  embeddingSimilarity?: Map<string, number>;
  /** Stage-1 SQL cap override (the eval policy probe widens its net). */
  stage1Limit?: number;
}

async function restJson(
  deps: RecommendDeps,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.supabaseUrl.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetchImpl(`${base}/rest/v1/${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: deps.anonKey,
        Authorization: `Bearer ${deps.userJwt ?? deps.anonKey}`,
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new RecommendError(
      "upstream",
      `supabase unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new RecommendError("unauthorized", "sign-in required");
  }
  if (!response.ok) {
    throw new RecommendError("upstream", `supabase HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text === "") return [];
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RecommendError("upstream", "supabase returned invalid JSON");
  }
}

const HouseholdRowSchema = z.object({
  id: z.string(),
  home_fsa: z.string().nullable(),
});

const MemberRowSchema = z.object({
  age_band: AgeBandSchema,
  include_adjacent: z.boolean(),
});

const PreferencesRowSchema = z.object({
  max_price_cents: z.number().nullable(),
  free_only: z.boolean(),
  max_distance_km: z.number().nullable(),
  availability: z.unknown(),
  language: z.array(z.string()),
  accessibility: z.array(z.string()),
  interests: z.array(z.string()),
  avoid: z.array(z.string()),
});

async function loadHouseholdPrefs(
  householdId: string,
  deps: RecommendDeps,
): Promise<Preferences> {
  if (!deps.userJwt) {
    throw new RecommendError("unauthorized", "household lookup needs sign-in");
  }
  const id = encodeURIComponent(householdId);
  const households = HouseholdRowSchema.array().safeParse(
    await restJson(deps, `households?id=eq.${id}&select=id,home_fsa`),
  );
  if (!households.success || households.data.length === 0) {
    throw new RecommendError("invalid", "household not found");
  }
  const household = households.data[0] as { id: string; home_fsa: string | null };
  const members = MemberRowSchema.array().safeParse(
    await restJson(
      deps,
      `members?household_id=eq.${id}&select=age_band,include_adjacent`,
    ),
  );
  if (!members.success || members.data.length === 0) {
    throw new RecommendError("invalid", "household has no members");
  }
  const prefsRows = PreferencesRowSchema.array().safeParse(
    await restJson(
      deps,
      `preferences?household_id=eq.${id}&select=max_price_cents,free_only,max_distance_km,availability,language,accessibility,interests,avoid`,
    ),
  );
  if (!prefsRows.success) {
    throw new RecommendError("upstream", "saved preferences unreadable");
  }
  const row = prefsRows.data[0] as z.infer<typeof PreferencesRowSchema> | undefined;
  const parsed = PreferencesSchema.safeParse({
    members: members.data,
    max_price_cents: row?.max_price_cents ?? undefined,
    free_only: row?.free_only ?? false,
    max_distance_km: row?.max_distance_km ?? undefined,
    fsa: household.home_fsa ?? undefined,
    availability: row?.availability ?? {},
    language: row?.language ?? [],
    accessibility: row?.accessibility ?? [],
    interests: row?.interests ?? [],
    avoid: row?.avoid ?? [],
  });
  if (!parsed.success) {
    throw new RecommendError("invalid", "saved preferences are invalid");
  }
  return parsed.data;
}

async function resolvePrefs(
  input: RecommendInput,
  deps: RecommendDeps,
): Promise<Preferences> {
  if ("householdId" in input) {
    return loadHouseholdPrefs(input.householdId, deps);
  }
  const parsed = PreferencesSchema.safeParse(input.prefs);
  if (!parsed.success) {
    throw new RecommendError(
      "invalid",
      `invalid preferences: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}

function toScoreEvent(row: CandidateRow): ScoreEvent {
  return {
    event_id: row.event_id,
    starts_at: row.starts_at,
    distance_km: row.distance_km,
    category: row.category,
    tags: row.tags,
    fetched_at: row.fetched_at,
  };
}

function toRerankCandidate(row: CandidateRow): RerankCandidate {
  return {
    event_id: row.event_id,
    title: row.title,
    summary_short: row.summary_short,
    category: row.category,
    starts_at: row.starts_at,
    venue_name: row.venue_name,
    price_label: row.price_label,
    age_min: row.age_min,
    age_max: row.age_max,
    age_flag: row.age_flag,
    tags: row.tags,
  };
}

export interface RecommendStages {
  prefs: Preferences;
  /** SQL candidates in date order (baseline A reads the first 10). */
  candidates: CandidateRow[];
  /** Stage-2 slots: scored, twins-collapsed, series-grouped. */
  stage2: Array<SeriesSlot<CandidateRow>>;
  scores: Map<string, number>;
}

/** Stages 0-2 without the rerank: shared by the API path and the eval. */
export async function recommendStages(
  input: RecommendInput,
  deps: RecommendDeps,
): Promise<RecommendStages> {
  const prefs = await resolvePrefs(input, deps);
  if (prefs.max_distance_km !== undefined && prefs.fsa === undefined) {
    throw new RecommendError("invalid", "max_distance_km needs an fsa area");
  }
  if (prefs.fsa !== undefined) {
    const areas = z.array(z.object({ fsa: z.string() })).safeParse(
      await restJson(
        deps,
        `home_area?fsa=eq.${encodeURIComponent(prefs.fsa)}&select=fsa`,
      ),
    );
    if (!areas.success || areas.data.length === 0) {
      throw new RecommendError(
        "unknown_area",
        `unknown area ${prefs.fsa}: Ottawa K-prefixed areas only`,
      );
    }
  }

  const rows = CandidateRowSchema.array().safeParse(
    await restJson(deps, "rpc/recommend_candidates", {
      method: "POST",
      body: { p_prefs: prefs, p_limit: deps.stage1Limit ?? STAGE1_LIMIT },
    }),
  );
  if (!rows.success) {
    throw new RecommendError(
      "upstream",
      "candidate rows failed validation (schema drift?)",
    );
  }
  const now = deps.now ?? new Date();
  const ranked = orderByScore(rows.data.map(toScoreEvent), prefs, {
    nowMs: now.getTime(),
    embeddingSimilarity: deps.embeddingSimilarity,
  });
  const byId = new Map(rows.data.map((row) => [row.event_id, row]));
  const scored: CandidateRow[] = [];
  const scores = new Map<string, number>();
  for (const r of ranked) {
    scores.set(r.scored.event_id, r.scored.score);
    const row = byId.get(r.event.event_id);
    if (row) scored.push(row);
  }
  // Twins (same title + start + branch, different rooms) collapse to the
  // top-scored row so the reranker never sees duplicates; the detail view
  // lists the other rooms (findSiblings). Series (same title + venue on
  // a weekly/regular cadence) group into one slot showing the next
  // occurrence. Stage-1 counts stay raw.
  const stage2 = groupSeries(collapseRows(scored));
  return { prefs, candidates: rows.data, stage2, scores };
}

export async function runRecommend(
  input: RecommendInput,
  deps: RecommendDeps,
): Promise<RecommendResult> {
  const { prefs, candidates, stage2, scores } = await recommendStages(
    input,
    deps,
  );
  const byId = new Map(candidates.map((row) => [row.event_id, row]));
  const slotById = new Map(
    stage2.map((slot) => [slot.row.event_id, slot] as const),
  );
  const shortlist = stage2.slice(0, RERANK_TOP_N);

  let reranked;
  try {
    reranked = await rerankCandidates(
      shortlist.map((slot) => toRerankCandidate(slot.row)),
      prefs,
      {
        config: deps.llmConfig,
        fetchImpl: deps.fetchImpl,
        chatFn: deps.chatFn,
      },
    );
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      reranked = null;
    } else {
      throw error;
    }
  }
  // Budget stop: the stage-2 order stands with templated reasons
  // (empty shortlists rerank trivially inside rerankCandidates).
  const { items, fallback } =
    reranked === null
      ? {
          items: shortlist.map((slot) => ({
            event_id: slot.row.event_id,
            reason: "",
            fromModel: false,
          })),
          fallback: true,
        }
      : {
          items: reranked.items,
          fallback: reranked.fallback,
        };

  const finalItems: RecommendItem[] = [];
  for (const item of items.slice(0, FINAL_TOP_N)) {
    const row = byId.get(item.event_id);
    if (!row) continue;
    const more =
      slotById.get(item.event_id)?.more.map((occurrence) => ({
        event_id: occurrence.event_id,
        starts_at: occurrence.starts_at,
        ends_at: occurrence.ends_at,
        timezone: occurrence.timezone,
      })) ?? [];
    finalItems.push({
      ...row,
      score: scores.get(item.event_id) ?? 0,
      reason: item.reason !== "" ? item.reason : templatedReason(row),
      reasonFromModel: item.fromModel,
      more_dates: more,
    });
  }
  const warnings: string[] = [];
  if (candidates.length < FINAL_TOP_N) {
    warnings.push(
      `only ${candidates.length} event(s) passed the hard constraints`,
    );
  }
  if (fallback && shortlist.length > 0) {
    warnings.push("rerank unavailable; showing match order");
  }
  return {
    items: finalItems,
    meta: {
      reranked: !fallback && shortlist.length > 0,
      model: fallback ? null : (reranked?.model ?? null),
      warnings,
    },
  };
}
