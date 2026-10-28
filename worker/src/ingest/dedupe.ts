import { createHash } from "node:crypto";

/** Stable hash of a listing's raw text: unchanged input, unchanged hash. */
export function rawHash(rawText: string): string {
  return createHash("sha256").update(rawText, "utf8").digest("hex");
}

/** Collapse a title for comparison: case, diacritics, punctuation gone. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface DedupeInput {
  title: string;
  /** UTC ISO instant. */
  startsAtUtc: string;
  venue?: string;
}

/**
 * Cross-source identity: normalized title + start instant + venue.
 * Two listings with equal keys are the same canonical event.
 */
export function dedupeKey(input: DedupeInput): string {
  const instant = new Date(input.startsAtUtc).toISOString();
  return [
    normalizeTitle(input.title),
    instant,
    normalizeTitle(input.venue ?? ""),
  ].join("|");
}
