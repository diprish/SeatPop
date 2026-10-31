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

export interface DiagnosisRelaxed {
  id: string;
  label: string;
  candidates: number;
}

export interface Diagnosis {
  base: number;
  relaxed: DiagnosisRelaxed[];
}

export interface RecommendResponse {
  items: RecommendItemView[];
  meta: RecommendMetaView;
  cached?: boolean;
  diagnosis?: Diagnosis;
}

export interface ParseResponse {
  prefs: Preferences;
  chips: Chip[];
  fallbackPrefs?: Preferences;
}

export interface EventDetailView {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  venue: {
    name: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
  category: string | null;
  status: string;
  source_url: string;
  age_min: number | null;
  age_max: number | null;
  needs_adult: boolean | null;
  setting: string | null;
  energy: string | null;
  crowd: string | null;
  duration_min: number | null;
  language: string | null;
  accessibility: string[];
  registration_hint: string | null;
  registration_opens_at: string | null;
  summary_short: string | null;
  tags: string[];
  price_kind: string;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  currency: string | null;
  price_text: string | null;
  fee_notes: string | null;
  price_basis: string;
  evidence: Record<string, { value: unknown; quote: string | null }> | null;
  price_evidence_quote: string | null;
  siblings: Array<{ id: string; venue_name: string; room: string | null }>;
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

export function fetchRecommend(
  prefs: Preferences,
  diagnose = false,
): Promise<RecommendResponse> {
  return postJson<RecommendResponse>(
    "/api/recommend",
    diagnose ? { prefs, diagnose: true } : { prefs },
  );
}

export function parseProfile(text: string): Promise<ParseResponse> {
  return postJson<ParseResponse>("/api/profile/parse", { text });
}

export async function getEventDetail(id: string): Promise<EventDetailView> {
  const response = await fetch(`/api/events/${encodeURIComponent(id)}`);
  const json = (await response.json()) as EventDetailView & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `event lookup failed (${response.status})`);
  }
  return json;
}
