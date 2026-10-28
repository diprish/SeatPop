import type { EventCategory } from "@seatpop/shared";
import { extractMatchingLinks, fetchIndexPages } from "./linkindex";
import {
  EventDraftSchema,
  type Adapter,
  type AdapterContext,
  type EventDraft,
  type SourceConfig,
} from "./types";
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedLocalToUtc } from "./tz";

interface JsonLdEvent {
  name?: unknown;
  description?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  url?: unknown;
  eventStatus?: unknown;
  location?: unknown;
}

/** Extract schema.org Event nodes from JSON-LD script blocks (incl. @graph). */
export function extractJsonLdEvents(html: string): JsonLdEvent[] {
  const out: JsonLdEvent[] = [];
  const re =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    let doc: unknown;
    try {
      doc = JSON.parse(match[1] as string);
    } catch {
      continue;
    }
    const nodes = Array.isArray(doc) ? doc : [doc];
    for (const node of nodes) {
      out.push(...eventsFromNode(node));
    }
  }
  return out;
}

function eventsFromNode(node: unknown): JsonLdEvent[] {
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const found: JsonLdEvent[] = [];
  const graph = record["@graph"];
  if (Array.isArray(graph)) {
    for (const child of graph) found.push(...eventsFromNode(child));
  }
  const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  if (types.includes("Event")) found.push(record as JsonLdEvent);
  return found;
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return undefined;
}

/** startDate may carry an offset, be UTC, or be a floating local time. */
function parseEventDate(
  value: unknown,
  defaultZone: string,
): { utc: string; zone: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // Offset or Zulu: Date parses directly.
  if (/([+-]\d{2}:?\d{2}|Z)$/i.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) return null;
    return { utc: new Date(ms).toISOString(), zone: "UTC" };
  }
  // Floating local time in the default zone.
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    trimmed,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const parts = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s ?? 0),
  };
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 60
  ) {
    return null;
  }
  return {
    utc: zonedLocalToUtc(parts, defaultZone),
    zone: defaultZone,
  };
}

function locationOf(event: JsonLdEvent): {
  name: string | undefined;
  address: string | undefined;
} {
  const loc = event.location;
  if (typeof loc === "string") {
    return { name: loc.trim() || undefined, address: undefined };
  }
  if (loc === null || typeof loc !== "object") {
    return { name: undefined, address: undefined };
  }
  const record = loc as Record<string, unknown>;
  const name = asText(record["name"]);
  const addr = record["address"];
  if (typeof addr === "string") {
    return { name, address: addr.trim() || undefined };
  }
  if (addr !== null && typeof addr === "object") {
    const a = addr as Record<string, unknown>;
    const parts = [
      asText(a["streetAddress"]),
      asText(a["addressLocality"]),
      asText(a["addressRegion"]),
      asText(a["postalCode"]),
    ].filter((p): p is string => p !== undefined);
    return {
      name,
      address: parts.length > 0 ? parts.join(", ") : undefined,
    };
  }
  return { name, address: undefined };
}

function statusOf(event: JsonLdEvent): "scheduled" | "cancelled" {
  const status = asText(event.eventStatus) ?? "";
  const leaf = status.split("/").pop() ?? status;
  return leaf.toLowerCase().includes("cancel") ? "cancelled" : "scheduled";
}

export interface ParseJsonLdOptions {
  pageUrl: string;
  defaultZone?: string;
  now?: Date;
  windowDays?: number;
  defaultCategory?: EventCategory;
}

/** Parse schema.org Event JSON-LD from a page to upcoming event drafts. */
export function parseJsonLd(
  html: string,
  options: ParseJsonLdOptions,
): EventDraft[] {
  const defaultZone =
    options.defaultZone && isValidTimeZone(options.defaultZone)
      ? options.defaultZone
      : DEFAULT_TIMEZONE;
  const nowMs = (options.now ?? new Date()).getTime();
  const windowEndMs = nowMs + (options.windowDays ?? 90) * 86400000;
  const drafts: EventDraft[] = [];
  for (const event of extractJsonLdEvents(html)) {
    const title = asText(event.name);
    const start = parseEventDate(event.startDate, defaultZone);
    if (!title || !start) continue;
    const startMs = Date.parse(start.utc);
    if (startMs < nowMs - 24 * 3600000 || startMs > windowEndMs) continue;
    const end = parseEventDate(event.endDate, defaultZone);
    const { name: venueName, address: venueAddress } = locationOf(event);
    let sourceUrl = options.pageUrl;
    const rawUrl = asText(event.url);
    if (rawUrl) {
      try {
        sourceUrl = new URL(rawUrl, options.pageUrl).href;
      } catch {
        sourceUrl = options.pageUrl;
      }
    }
    const candidate = {
      sourceUrl,
      title,
      description: asText(event.description),
      startsAtUtc: start.utc,
      endsAtUtc: end?.utc,
      timezone: start.zone,
      venueName,
      venueAddress,
      category: options.defaultCategory,
      status: statusOf(event),
      rawText: JSON.stringify(event),
    };
    const parsed = EventDraftSchema.safeParse(candidate);
    if (parsed.success) drafts.push(parsed.data);
  }
  return drafts;
}

export const JsonLdAdapter: Adapter = {
  kind: "jsonld",
  async collect(
    source: SourceConfig,
    ctx: AdapterContext,
  ): Promise<EventDraft[]> {
    const options = {
      defaultZone: source.timezone,
      now: ctx.now,
      windowDays: ctx.windowDays,
      defaultCategory: source.category,
    };
    if (!source.linkPattern) {
      const page = await ctx.fetcher.fetchText(source.url);
      if (page.notModified) {
        console.log(`jsonld: ${source.name} not modified since last fetch`);
        return [];
      }
      return parseJsonLd(page.text, { ...options, pageUrl: page.url });
    }
    const pages = await fetchIndexPages(
      ctx.fetcher,
      source.url,
      source.extraIndexPages,
    );
    if (pages.length === 0) {
      console.log(`jsonld: ${source.name} index not modified since last fetch`);
      return [];
    }
    const links = new Set<string>();
    for (const page of pages) {
      for (const link of extractMatchingLinks(page.url, page.text, source.linkPattern, {
        allowSubdomains: source.includeSubdomains,
      })) {
        links.add(link);
      }
    }
    const drafts: EventDraft[] = [];
    for (const link of [...links].slice(0, 1000)) {
      try {
        const page = await ctx.fetcher.fetchText(link);
        if (page.notModified) continue;
        drafts.push(...parseJsonLd(page.text, { ...options, pageUrl: page.url }));
      } catch (error) {
        console.warn(
          `jsonld index skipping ${link}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return drafts;
  },
};
