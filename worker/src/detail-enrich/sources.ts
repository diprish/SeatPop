/**
 * Detail-page allowlist: sources whose own event pages we may fetch.
 * Every name here must hold a YES or accepted-DECIDE verdict in
 * docs/sources.md (pinned by the detail-enrich tests, which parse the
 * verdict table — a docs edit removing approval fails loudly).
 */
export const DETAIL_SOURCES = [
  "Ottawa Chamberfest",
  "Ottawa Little Theatre",
  "Ottawa Art Gallery",
  "Canadian War Museum",
  "Canadian Museum of History",
] as const;
export type DetailSource = (typeof DETAIL_SOURCES)[number];
