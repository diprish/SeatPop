import { z } from "zod";
import { EventCategorySchema, type EventCategory } from "@seatpop/shared";
import type { Fetcher } from "./fetcher";

export const SourceKindSchema = z.enum([
  "ics",
  "jsonld",
  "rss",
  "html",
  "user_submitted",
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const EventStatusSchema = z.enum([
  "scheduled",
  "cancelled",
  "full",
  "waitlist",
]);
export type EventStatus = z.infer<typeof EventStatusSchema>;

/** One candidate event parsed from a source listing. Times are UTC ISO. */
export const EventDraftSchema = z.object({
  sourceUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().optional(),
  startsAtUtc: z.string().datetime(),
  endsAtUtc: z.string().datetime().optional(),
  timezone: z.string().min(1),
  venueName: z.string().optional(),
  venueAddress: z.string().optional(),
  category: EventCategorySchema.optional(),
  status: EventStatusSchema.default("scheduled"),
  rawText: z.string().min(1),
});
export type EventDraft = z.infer<typeof EventDraftSchema>;

/** Source configuration: one row of the sources table plus adapter options. */
export interface SourceConfig {
  id?: string;
  name: string;
  kind: SourceKind;
  url: string;
  city?: string;
  /** Default category for drafts that carry no machine-readable category. */
  category?: EventCategory;
  /** IANA zone for dates without one. Default: America/Toronto. */
  timezone?: string;
  /** For kind "ics": url is an HTML index page linking per-event .ics files. */
  icsIndex?: boolean;
  /** For kind "rss": the feed's item date is the event date. */
  rssPubDateIsEventDate?: boolean;
  /**
   * Force all event times into this IANA zone. Only for verified source
   * mis-tagging (e.g. Diefenbunker tags America/Halifax; its own pages
   * state UTC-4).
   */
  overrideTimezone?: string;
  /**
   * Treat url as an index page: follow same-host links whose href matches
   * this regex and parse each target. Used for JSON-LD detail pages.
   */
  linkPattern?: string;
  /** Follow links to subdomains of the index host too (default: same host). */
  includeSubdomains?: boolean;
  /**
   * Extra index pages: fetch template with {n} replaced for n in
   * [from..to] and collect links from every page (for paginated listings).
   */
  extraIndexPages?: { template: string; from: number; to: number };
}

/** What adapters may use: polite fetching, clock, and run window. */
export interface AdapterContext {
  fetcher: Fetcher;
  now: Date;
  /** Upcoming-only window in days. Default: 90. */
  windowDays?: number;
}

export interface Adapter {
  kind: SourceKind;
  collect(source: SourceConfig, ctx: AdapterContext): Promise<EventDraft[]>;
}
