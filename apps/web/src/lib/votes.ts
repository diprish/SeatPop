"use client";

/**
 * Client-safe worth-it helpers: the fixed tag vocabulary (mirrored in
 * migration 0021 — keep both lists in sync) and the per-device voter
 * id. The id is random (never personal); only its salted server-side
 * hash is stored, and it is never logged.
 */

export const VOTE_TAGS = [
  "good for toddlers",
  "good for older kids",
  "crowded",
  "well run",
  "worth the drive",
  "not as described",
] as const;
export type VoteTag = (typeof VOTE_TAGS)[number];

export const VOTE_DEVICE_KEY = "seatpop_vote_device";

/** Stable random device id, generated once per browser. */
export function getVoteDeviceId(): string {
  try {
    const stored = localStorage.getItem(VOTE_DEVICE_KEY);
    if (stored && stored !== "") return stored;
    const fresh =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(VOTE_DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode: an in-memory id still votes this session.
    return `ephemeral-${Math.random().toString(36).slice(2)}`;
  }
}

export interface VotesSummary {
  enough: boolean;
  total: number;
  up: number;
  down: number;
  tags: Record<string, number>;
}

export async function fetchVotesSummary(
  eventId: string,
): Promise<VotesSummary | null> {
  const response = await fetch(
    `/api/votes?event_id=${encodeURIComponent(eventId)}`,
  );
  if (!response.ok) {
    throw new Error(`votes unavailable (HTTP ${response.status})`);
  }
  const body = (await response.json()) as {
    enough?: boolean;
    total?: number;
    up?: number;
    down?: number;
    tags?: Record<string, number>;
  };
  if (!body || body.enough !== true) return null;
  return {
    enough: true,
    total: typeof body.total === "number" ? body.total : 0,
    up: typeof body.up === "number" ? body.up : 0,
    down: typeof body.down === "number" ? body.down : 0,
    tags:
      body.tags && typeof body.tags === "object" && !Array.isArray(body.tags)
        ? body.tags
        : {},
  };
}

export async function castVote(
  eventId: string,
  vote: 1 | -1,
  tags: string[],
): Promise<void> {
  const response = await fetch("/api/votes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_id: eventId,
      vote,
      tags,
      device_id: getVoteDeviceId(),
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      typeof body?.error === "string" && body.error !== ""
        ? body.error
        : `vote failed (HTTP ${response.status})`,
    );
  }
}
