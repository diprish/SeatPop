/**
 * Index discovery shared by adapters: extract same-host links from a listing
 * page whose href matches a configured pattern, for per-event detail pages.
 */
import type { Fetcher } from "./fetcher";

export interface LinkIndexOptions {
  allowSubdomains?: boolean;
}

export function sameSite(host: string, base: string, allowSubdomains: boolean): boolean {
  return host === base || (allowSubdomains && host.endsWith(`.${base}`));
}

/** Extract absolute same-host http(s) links matching includePattern. */
export function extractMatchingLinks(
  indexUrl: string,
  html: string,
  includePattern: string,
  options: LinkIndexOptions = {},
): string[] {
  let include: RegExp;
  try {
    include = new RegExp(includePattern);
  } catch {
    throw new Error(`invalid linkPattern: ${includePattern}`);
  }
  const found = new Set<string>();
  const base = new URL(indexUrl);
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = match[1] as string;
    try {
      const absolute = new URL(href, indexUrl);
      if (!sameSite(absolute.host, base.host, options.allowSubdomains ?? false)) {
        continue;
      }
      if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
        continue;
      }
      if (!include.test(absolute.href)) continue;
      found.add(absolute.href);
    } catch {
      // Skip unresolvable hrefs.
    }
  }
  return [...found];
}

export interface IndexPage {
  /** Final URL after redirects: the base for resolving relative links. */
  url: string;
  text: string;
}

/**
 * Fetch an index page plus configured extra pages (pagination). Per-page
 * failures are logged and skipped; an unmodified index yields no pages.
 */
export async function fetchIndexPages(
  fetcher: Fetcher,
  indexUrl: string,
  extra?: { template: string; from: number; to: number },
): Promise<IndexPage[]> {
  const pages: IndexPage[] = [];
  const first = await fetcher.fetchText(indexUrl);
  if (!first.notModified) pages.push({ url: first.url, text: first.text });
  if (extra) {
    for (let n = extra.from; n <= extra.to; n++) {
      const url = extra.template.replace("{n}", String(n));
      try {
        const page = await fetcher.fetchText(url);
        if (!page.notModified) pages.push({ url: page.url, text: page.text });
      } catch (error) {
        console.warn(
          `index skipping page ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return pages;
}
