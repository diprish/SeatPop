import {
  HttpNoRetry,
  RobotsDisallowed,
} from "../ingest/fetcher";

/**
 * Detail-enrich planning (pure, tested): which events qualify, which
 * URLs may be fetched, and how fetch outcomes classify. The runner in
 * run.ts joins these with the database, the polite fetcher, and the
 * usual enrichment path.
 */

/** Feed text shorter than this (or absent) triggers a detail fetch. */
export const SHORT_TEXT_LIMIT = 200;

/** Upper bound on official-page fetches per run (abuse brake). */
export const MAX_PAGES_PER_RUN = 150;

export function needsDetailText(description: string | null): boolean {
  return description === null || description.length < SHORT_TEXT_LIMIT;
}

/** Lowercased host with a leading www. stripped; null when unparsable. */
export function siteHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Same-site gate (round-2 structural rule): the event's official page
 * must live on its source's own host, so off-host booking systems stay
 * unreachable. Applied to the listing URL and, after redirects, to the
 * final URL too.
 */
export function sameSite(feedUrl: string, pageUrl: string): boolean {
  const feed = siteHost(feedUrl);
  const page = siteHost(pageUrl);
  return feed !== null && page !== null && feed === page;
}

export function clampDetailLimit(requested: number | undefined): number {
  if (requested === undefined) return MAX_PAGES_PER_RUN;
  return Math.min(requested, MAX_PAGES_PER_RUN);
}

/** Expected skip kinds (recorded, never fail the run, even --strict). */
export type DetailSkip = "robots" | "forbidden" | "off_host" | "thin";

/**
 * Whether stripped detail text replaces the feed description: never
 * empty, and never shorter than the feed text it would destroy (a
 * "Loading…" shell must not wipe real listing words). Ties go to the
 * official page.
 */
export function detailBeatsFeed(
  detailText: string,
  feedDescription: string | null,
): boolean {
  if (detailText === "") return false;
  return detailText.length >= (feedDescription?.length ?? 0);
}

/**
 * Fetch errors classify as expected skips (robots/403, never retried,
 * never bypassed) or unexpected failures (everything else, --strict
 * fails on these).
 */
export function classifyFetchError(
  error: unknown,
): "robots" | "forbidden" | "error" {
  if (error instanceof RobotsDisallowed) return "robots";
  if (error instanceof HttpNoRetry) return "forbidden";
  return "error";
}

/** Mirror of enrich --strict: any failed event fails the run. */
export function strictDetailFailed(failures: number): boolean {
  return failures > 0;
}
