import {
  extractEventsFromPage,
  type ExtractionPage,
} from "./extract";
import { extractMatchingLinks, fetchIndexPages } from "./linkindex";
import {
  type Adapter,
  type AdapterContext,
  type AdapterLlm,
  type EventDraft,
  type SourceConfig,
} from "./types";

/**
 * Tier 2: generic HTML page adapter. Fetches a page, sends its visible text
 * to the listing_extraction task (contributor model, evidence-checked), and
 * returns the extracted drafts. Without LLM access in the context, yields
 * nothing.
 */

/** Decode the entities our adapters care about (shared with probes). */
export function decodeEntities(value: string): string {
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

export type HtmlPage = ExtractionPage;

/**
 * Same-host anchor links (text + absolute URL), in page order. The model
 * picks per-event official links from this set; membership is validated.
 */
export function extractPageLinks(html: string, baseUrl: string): { text: string; url: string }[] {
  const links: { text: string; url: string }[] = [];
  const seen = new Set<string>();
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return links;
  }
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1] as string;
    if (raw.startsWith("#")) continue;
    let absolute: URL;
    try {
      absolute = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (absolute.host !== base.host) continue;
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
      continue;
    }
    if (seen.has(absolute.href)) continue;
    seen.add(absolute.href);
    const text = decodeEntities(
      (match[2] ?? "").replace(/<[^>]*>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim();
    links.push({ text, url: absolute.href });
  }
  return links;
}

/** Fetch a page through the polite fetcher: visible text + same-host links. */
export async function fetchVisibleText(
  url: string,
  ctx: AdapterContext,
): Promise<HtmlPage | null> {
  const page = await ctx.fetcher.fetchText(url);
  if (page.notModified) {
    console.log(`html: ${url} not modified since last fetch`);
    return null;
  }
  return {
    url: page.url,
    text: visibleText(page.text),
    links: extractPageLinks(page.text, page.url),
  };
}

/**
 * Tier-2 extraction over one page: public listing text to the
 * listing_extraction task (contributor model), evidence-checked.
 */
export async function extractEventsFromText(
  page: HtmlPage,
  source: SourceConfig,
  llm: AdapterLlm,
  now?: Date,
): Promise<EventDraft[]> {
  return extractEventsFromPage(page, source, {
    config: llm.config,
    fetchImpl: llm.fetchImpl,
    chatFn: llm.chatFn,
    now,
  });
}

export const HtmlAdapter: Adapter = {
  kind: "html",
  async collect(
    source: SourceConfig,
    ctx: AdapterContext,
  ): Promise<EventDraft[]> {
    const llm = ctx.llm;
    if (!llm) {
      console.warn(
        `html: no LLM access for ${source.url}; skipping extraction`,
      );
      return [];
    }
    if (!source.linkPattern) {
      const page = await fetchVisibleText(source.url, ctx);
      if (!page) return [];
      return extractEventsFromText(page, source, llm, ctx.now);
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
        drafts.push(...(await extractEventsFromText(page, source, llm, ctx.now)));
      } catch (error) {
        console.warn(
          `html index skipping ${link}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return drafts;
  },
};
