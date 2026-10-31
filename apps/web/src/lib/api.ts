import type { Preferences } from "@seatpop/shared";
import type { Chip } from "@seatpop/worker/recommend/chips";

/** Typed client for the web API routes (no node imports). */

export interface RecommendItemView {
  event_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  venue_name: string | null;
  venue_lat: number | null;
  venue_lng: number | null;
  distance_km: number | null;
  category: string | null;
  status: string;
  source_url: string;
  age_min: number | null;
  age_max: number | null;
  age_fallback: boolean;
  age_flag: string | null;
  price_kind: string;
  price_label: string;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  currency: string | null;
  accessibility: string[];
  language: string | null;
  tags: string[];
  summary_short: string | null;
  score: number;
  reason: string;
  reasonFromModel: boolean;
}

export interface RecommendMetaView {
  reranked: boolean;
  model: string | null;
  warnings: string[];
}

export interface RecommendResponse {
  items: RecommendItemView[];
  meta: RecommendMetaView;
  cached?: boolean;
}

export interface ParseResponse {
  prefs: Preferences;
  chips: Chip[];
  fallbackPrefs?: Preferences;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `request failed (${response.status})`);
  }
  return json;
}

export function fetchRecommend(prefs: Preferences): Promise<RecommendResponse> {
  return postJson<RecommendResponse>("/api/recommend", { prefs });
}

export function parseProfile(text: string): Promise<ParseResponse> {
  return postJson<ParseResponse>("/api/profile/parse", { text });
}
