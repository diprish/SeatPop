import { extractMatchingLinks, fetchIndexPages } from "./linkindex";
import {
  type Adapter,
  type AdapterContext,
  type EventDraft,
  type SourceConfig,
} from "./types";

/**
 * Tier 2: generic HTML page adapter. Fetches a page and returns its visible
 * text; a later phase sends that text to the extraction task. The extraction
 * call is stubbed: collect() returns no drafts yet.
 */

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Best-effort visible text: drops scripts, styles, nav boilerplate stays. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, " ")
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

export interface HtmlPage {
  url: string;
  text: string;
}

/** Fetch a page through the polite fetcher and return its visible text. */
export async function fetchVisibleText(
  url: string,
  ctx: AdapterContext,
): Promise<HtmlPage | null> {
  const page = await ctx.fetcher.fetchText(url);
  if (page.notModified) {
    console.log(`html: ${url} not modified since last fetch`);
    return null;
  }
  return { url: page.url, text: visibleText(page.text) };
}

/**
 * Stub for the phase-N extraction task (model call over page text).
 * Returns no drafts until that phase lands.
 */
export async function extractEventsFromText(
  _page: HtmlPage,
  _source: SourceConfig,
): Promise<EventDraft[]> {
  return [];
}

export const HtmlAdapter: Adapter = {
  kind: "html",
  async collect(
    source: SourceConfig,
    ctx: AdapterContext,
  ): Promise<EventDraft[]> {
    if (!source.linkPattern) {
      const page = await fetchVisibleText(source.url, ctx);
      if (!page) return [];
      return extractEventsFromText(page, source);
    }
    const pages = await fetchIndexPages(
      ctx.fetcher,
      source.url,
      source.extraIndexPages,
    );
    if (pages.length === 0) return [];
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
        const page = await fetchVisibleText(link, ctx);
        if (!page) continue;
        drafts.push(...(await extractEventsFromText(page, source)));
      } catch (error) {
        console.warn(
          `html index skipping ${link}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return drafts;
  },
};
