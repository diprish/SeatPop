import type { RecommendItemView } from "./api";

/**
 * Saves and hides (client-safe). Guests persist in localStorage; when a
 * JWT is present the same verdict is mirrored to /api/feedback for
 * durability. Storage helpers are pure transitions (writes safely no-op
 * outside the browser) so tests cover the logic without a DOM.
 */

export const SAVED_KEY = "seatpop_saved";
export const HIDDEN_KEY = "seatpop_not_for_us";
export const JWT_KEY = "seatpop_jwt";

export const NOT_FOR_US_REASONS = [
  "Too far",
  "Wrong ages",
  "Too expensive",
  "Bad time",
] as const;

export interface SavedSnapshot {
  item: RecommendItemView;
  savedAt: string;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the session state still works.
  }
}

export function loadSaved(): SavedSnapshot[] {
  const list = readJson<SavedSnapshot[]>(SAVED_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function isSaved(saved: SavedSnapshot[], eventId: string): boolean {
  return saved.some((entry) => entry.item.event_id === eventId);
}

export function toggleSaved(
  saved: SavedSnapshot[],
  item: RecommendItemView,
): SavedSnapshot[] {
  const next = isSaved(saved, item.event_id)
    ? saved.filter((entry) => entry.item.event_id !== item.event_id)
    : [...saved, { item, savedAt: new Date().toISOString() }];
  writeJson(SAVED_KEY, next);
  return next;
}

/** Hidden event ids mapped to their not-for-us reason. */
export function loadHidden(): Record<string, string> {
  const map = readJson<Record<string, string>>(HIDDEN_KEY, {});
  return typeof map === "object" && map !== null ? map : {};
}

export function hideEvent(
  hidden: Record<string, string>,
  eventId: string,
  reason: string,
): Record<string, string> {
  const next = { ...hidden, [eventId]: reason };
  writeJson(HIDDEN_KEY, next);
  return next;
}

export function unhideEvent(
  hidden: Record<string, string>,
  eventId: string,
): Record<string, string> {
  const next = { ...hidden };
  delete next[eventId];
  writeJson(HIDDEN_KEY, next);
  return next;
}

export function getJwt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(JWT_KEY);
  } catch {
    return null;
  }
}

export type FeedbackValue = "saved" | "dismissed" | "not_for_us";

export async function postFeedback(
  jwt: string,
  eventId: string,
  value: FeedbackValue,
  reason?: string,
): Promise<void> {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      event_id: eventId,
      value,
      ...(reason ? { reason } : {}),
    }),
  });
  const json = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `feedback failed (${response.status})`);
  }
}

export async function deleteFeedback(jwt: string, eventId: string): Promise<void> {
  const response = await fetch(
    `/api/feedback?event_id=${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    },
  );
  const json = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `feedback delete failed (${response.status})`);
  }
}

export interface SavedRow {
  event_id: string;
  reason: string | null;
  created_at: string;
}

export async function fetchSavedIds(jwt: string): Promise<SavedRow[]> {
  const response = await fetch("/api/feedback?value=saved", {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const json = (await response.json()) as { feedback?: SavedRow[]; error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `saved lookup failed (${response.status})`);
  }
  return json.feedback ?? [];
}
