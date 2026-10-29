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

export type DraftWriteAction =
  | { action: "skip" }
  | { action: "link"; eventId: string }
  | { action: "insert" };

export interface PlannedDraft {
  hash: string;
  key: string;
}

/**
 * One write action per draft, in order. A draft skips when its raw text
 * already exists for this source, or when its canonical event already
 * lists this source; otherwise it links the canonical event, or inserts
 * it when no canonical exists. Drafts are never collapsed by hash:
 * every draft carries its own key and earns its own link, so slice
 * facets attach per occurrence even when raw text repeats.
 * Same-key duplicates in one batch both plan "insert"; the runner links
 * the second to the row the first just inserted.
 */
export function planDraftActions(
  drafts: PlannedDraft[],
  existingHashes: ReadonlySet<string>,
  canonicalIdByKey: ReadonlyMap<string, string>,
  linkedEventIds: ReadonlySet<string>,
): DraftWriteAction[] {
  const linked = new Set(linkedEventIds);
  return drafts.map((draft) => {
    if (existingHashes.has(draft.hash)) return { action: "skip" };
    const eventId = canonicalIdByKey.get(draft.key);
    if (eventId === undefined) return { action: "insert" };
    if (linked.has(eventId)) return { action: "skip" };
    linked.add(eventId);
    return { action: "link", eventId };
  });
}
