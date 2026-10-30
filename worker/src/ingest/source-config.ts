import { EventCategorySchema, type EventCategory } from "@seatpop/shared";
import { isValidTimeZone } from "./tz";

/**
 * Per-source options keyed by source NAME (must match sources.json and the
 * sources table). Keeps source-specific config in code review instead of
 * the database: default category, time zones, and index discovery.
 */
export interface SourceOptions {
  category?: EventCategory;
  timezone?: string;
  overrideTimezone?: string;
  icsIndex?: boolean;
  linkPattern?: string;
  includeSubdomains?: boolean;
  extraIndexPages?: { template: string; from: number; to: number };
  rssPubDateIsEventDate?: boolean;
  /** OPL listing-facet label (e.g. an age group): structured evidence. */
  ageFacet?: { label: string };
  /**
   * No-training route: no terms of use found for this source
   * (docs/sources.md), so its text uses Baseten only; on Baseten
   * errors or cap, skip and retry later — never fall back to the
   * contributor model, which may train on inputs.
   */
  noTrainingRoute?: boolean;
}

export const SOURCE_OPTIONS: Record<string, SourceOptions> = {
  // Per-event .ics links live on the booking subdomain (probe-verified).
  // No pagination: ?page=0,N and ?page=N both return page 1 to stateless
  // fetches (the faceted browser needs session state), verified 2026-10-27.
  "Ottawa Public Library": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    noTrainingRoute: true,
  },
  // Filter-experiment winners (2026-10-28): single-filter listing slices
  // that return different page-1 results to a stateless fetch. Same
  // tier-1 ICS-index handling; booking crawl-delay 10 applies.
  "Ottawa Public Library (English)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    noTrainingRoute: true,
  },
  "Ottawa Public Library (Adults)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    ageFacet: { label: "Adult" },
    noTrainingRoute: true,
  },
  // Age-group slices (probe:opl --age-groups winners, 2026-10-29): all 9
  // differ from the baseline; the Adult slice is the existing (Adults)
  // source above. Facet labels are stored as structured evidence; only
  // digit-bearing labels ("Adults 50-plus") may set ages.
  "Ottawa Public Library (Adults 50-plus)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    ageFacet: { label: "Adults 50-plus" },
    noTrainingRoute: true,
  },
  "Ottawa Public Library (Baby)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    ageFacet: { label: "Baby" },
    noTrainingRoute: true,
  },
  "Ottawa Public Library (Child)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    ageFacet: { label: "Child" },
    noTrainingRoute: true,
  },
  "Ottawa Public Library (Family)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    ageFacet: { label: "Family" },
    noTrainingRoute: true,
  },
  "Ottawa Public Library (Newcomers)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    ageFacet: { label: "Newcomers" },
    noTrainingRoute: true,
  },
  "Ottawa Public Library (Preschool)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    ageFacet: { label: "Preschool" },
    noTrainingRoute: true,
  },
  "Ottawa Public Library (Teen)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    ageFacet: { label: "Teen" },
    noTrainingRoute: true,
  },
  "Ottawa Public Library (Toddler)": {
    category: "library",
    icsIndex: true,
    includeSubdomains: true,
    ageFacet: { label: "Toddler" },
    noTrainingRoute: true,
  },
  // No-ToU sources (round-1 table): OPL #1, OAG #4, Farmers #13, GCTC
  // #14, Chamberfest #15, OLT #17, Diefenbunker #19 — Baseten only.
  // Nature #5, War #8, History #16 have federal copyright terms: Meta OK.
  "Ottawa Art Gallery": { category: "arts", noTrainingRoute: true },
  "Canadian Museum of Nature": { category: "museums" },
  "Canadian War Museum": { category: "museums" },
  "Ottawa Farmers' Market": { category: "markets", noTrainingRoute: true },
  "Great Canadian Theatre Company": {
    category: "arts",
    noTrainingRoute: true,
  },
  // Listing page carries no quotable dates (upcoming concerts are
  // dateless links); follow per-event detail pages instead (approved
  // 2026-10-28 — beyond listing-text scope, same evidence rules).
  "Ottawa Chamberfest": {
    category: "music",
    linkPattern: "/event/20\\d\\d/",
    noTrainingRoute: true,
  },
  "Canadian Museum of History": { category: "museums" },
  "Ottawa Little Theatre": { category: "arts", noTrainingRoute: true },
  // Event pages state UTC-4 while the feed tags America/Halifax (verified
  // against https://diefenbunker.ca/events/halloween-at-the-bunker-2026/).
  Diefenbunker: {
    category: "museums",
    overrideTimezone: "America/Toronto",
    noTrainingRoute: true,
  },
  // Round-2 approval (2026-10-30): Dovercourt only (#29, #30, #32,
  // #33 dropped under the under-3 rule after one extraction attempt —
  // see docs/sources.md). No ToU: Baseten only. Same-host link
  // following keeps PerfectMind (off-host, login-walled) unreachable.
  "Dovercourt Recreation": { category: "community", noTrainingRoute: true },
};

export function optionsForSource(name: string): SourceOptions {
  return SOURCE_OPTIONS[name] ?? {};
}

/** Validate every entry (used by tests; throws on the first problem). */
export function validateSourceOptions(): void {
  for (const [name, options] of Object.entries(SOURCE_OPTIONS)) {
    if (
      options.category !== undefined &&
      !EventCategorySchema.safeParse(options.category).success
    ) {
      throw new Error(`source ${name}: invalid category`);
    }
    for (const zone of [options.timezone, options.overrideTimezone]) {
      if (zone !== undefined && !isValidTimeZone(zone)) {
        throw new Error(`source ${name}: invalid time zone ${zone}`);
      }
    }
    if (options.linkPattern !== undefined) {
      try {
        new RegExp(options.linkPattern);
      } catch {
        throw new Error(`source ${name}: invalid linkPattern`);
      }
    }
    const pages = options.extraIndexPages;
    if (pages !== undefined) {
      if (
        !pages.template.includes("{n}") ||
        !Number.isInteger(pages.from) ||
        !Number.isInteger(pages.to) ||
        pages.from < 0 ||
        pages.to < pages.from
      ) {
        throw new Error(`source ${name}: invalid extraIndexPages`);
      }
    }
  }
}
