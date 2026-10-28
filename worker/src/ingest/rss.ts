import type { EventCategory } from "@seatpop/shared";
import {
  EventDraftSchema,
  type Adapter,
  type AdapterContext,
  type EventDraft,
  type SourceConfig,
} from "./types";
import { DEFAULT_TIMEZONE } from "./tz";

/**
 * Narrow RSS 2.0 / Atom parser for event feeds: extracts items, titles,
 * links, dates and descriptions. Deliberately small — feeds outside these
 * two shapes are rejected, not guessed at.
 */

interface FeedItem {
  title: string;
  link: string | undefined;
  published: string | undefined;
  eventStart: string | undefined;
  description: string | undefined;
  raw: string;
}

function innerXml(block: string, tag: string): string | undefined {
  const re = new RegExp(
    `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    "i",
  );
  const match = re.exec(block);
  return match?.[1]?.trim() || undefined;
}

function allInnerXml(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    if (match[1]?.trim()) out.push(match[1].trim());
  }
  return out;
}

function atomLink(block: string): string | undefined {
  const re = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  let fallback: string | undefined;
  while ((match = re.exec(block)) !== null) {
    const tag = match[0];
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "alternate";
    if (rel === "alternate") return href;
    fallback ??= href;
  }
  return fallback;
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(value: string): string {
  return decodeEntities(stripCdata(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** Split a feed into item/entry blocks (RSS <item>, Atom <entry>). */
export function splitFeedItems(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const block of allInnerXml(xml, "item")) {
    items.push({
      title: stripTags(innerXml(block, "title") ?? ""),
      link: atomLink(block) ?? stripCdata(innerXml(block, "link") ?? "") ?? undefined,
      published:
        innerXml(block, "pubDate") ??
        innerXml(block, "dc:date") ??
        innerXml(block, "dcterms:issued"),
      eventStart:
        innerXml(block, "ev:startdate") ??
        innerXml(block, "event:start") ??
        innerXml(block, "xCal:dtstart"),
      description:
        innerXml(block, "content:encoded") ?? innerXml(block, "description") ?? undefined,
      raw: block,
    });
  }
  for (const block of allInnerXml(xml, "entry")) {
    items.push({
      title: stripTags(innerXml(block, "title") ?? ""),
      link: atomLink(block),
      published:
        innerXml(block, "published") ?? innerXml(block, "updated"),
      eventStart: undefined,
      description:
        innerXml(block, "content") ?? innerXml(block, "summary") ?? undefined,
      raw: block,
    });
  }
  return items;
}

export interface ParseRssOptions {
  feedUrl: string;
  defaultZone?: string;
  now?: Date;
  windowDays?: number;
  defaultCategory?: EventCategory;
  /** When true, a missing event date falls back to the item publish date. */
  pubDateIsEventDate?: boolean;
}

/**
 * Parse an RSS/Atom feed to upcoming event drafts. An item becomes a draft
 * only with an explicit event date (ev:startdate and friends); otherwise the
 * publish date is used only when the source declares it is the event date.
 */
export function parseRss(xml: string, options: ParseRssOptions): EventDraft[] {
  const defaultZone = options.defaultZone ?? DEFAULT_TIMEZONE;
  const nowMs = (options.now ?? new Date()).getTime();
  const windowEndMs = nowMs + (options.windowDays ?? 90) * 86400000;
  const drafts: EventDraft[] = [];
  for (const item of splitFeedItems(xml)) {
    if (item.title === "") continue;
    const dateText = item.eventStart ?? (options.pubDateIsEventDate ? item.published : undefined);
    if (!dateText) continue;
    const startMs = Date.parse(stripCdata(dateText).trim());
    if (Number.isNaN(startMs)) continue;
    if (startMs < nowMs - 24 * 3600000 || startMs > windowEndMs) continue;
    let sourceUrl = options.feedUrl;
    if (item.link) {
      try {
        sourceUrl = new URL(stripCdata(item.link).trim(), options.feedUrl).href;
      } catch {
        sourceUrl = options.feedUrl;
      }
    }
    const description = item.description
      ? stripTags(item.description) || undefined
      : undefined;
    const candidate = {
      sourceUrl,
      title: item.title,
      description,
      startsAtUtc: new Date(startMs).toISOString(),
      endsAtUtc: undefined,
      timezone: defaultZone,
      venueName: undefined,
      venueAddress: undefined,
      category: options.defaultCategory,
      status: "scheduled" as const,
      rawText: item.raw,
    };
    const parsed = EventDraftSchema.safeParse(candidate);
    if (parsed.success) drafts.push(parsed.data);
  }
  return drafts;
}

export const RssAdapter: Adapter = {
  kind: "rss",
  async collect(
    source: SourceConfig,
    ctx: AdapterContext,
  ): Promise<EventDraft[]> {
    const feed = await ctx.fetcher.fetchText(source.url);
    if (feed.notModified) {
      console.log(`rss: ${source.name} not modified since last fetch`);
      return [];
    }
    return parseRss(feed.text, {
      feedUrl: feed.url,
      defaultZone: source.timezone,
      now: ctx.now,
      windowDays: ctx.windowDays,
      defaultCategory: source.category,
      pubDateIsEventDate: source.rssPubDateIsEventDate,
    });
  },
};
