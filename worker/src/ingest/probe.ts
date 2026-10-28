import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  Fetcher,
  HttpNoRetry,
  RobotsDisallowed,
  fileEtagStore,
} from "./fetcher";
import { visibleText } from "./html";

/**
 * Access probe for approved sources. Fetches each listing page / feed once
 * with our honest User-Agent and reports what is reachable and what machine-
 * readable evidence it carries. Findings are data, never bypasses: 403s and
 * bot-walls are reported, never retried.
 *
 * Usage: npm run probe --workspace @seatpop/worker
 */

interface ProbeTarget {
  label: string;
  url: string;
  expect: string;
}

const TARGETS: ProbeTarget[] = [
  {
    label: "OPL programs",
    url: "https://biblioottawalibrary.ca/en/program",
    expect: "listing reachable (access check)",
  },
  {
    label: "City courses and camps",
    url: "https://ottawa.ca/en/recreation-and-parks/courses-and-camps/registered-programs-what-you-need-know/browse-and-register-courses-and-camps",
    expect: "listing reachable (access check)",
  },
  {
    label: "OAG calendar",
    url: "https://oaggao.ca/events/?ical=1",
    expect: "ICS feed",
  },
  {
    label: "Nature whats-on",
    url: "https://nature.ca/en/visit-us/whats-on/",
    expect: "JSON-LD or listing links",
  },
  {
    label: "War events",
    url: "https://www.warmuseum.ca/events-and-programming",
    expect: "JSON-LD or listing links",
  },
  {
    label: "Farmers market calendar",
    url: "https://ottawafarmersmarket.ca/events/?ical=1",
    expect: "ICS feed",
  },
  {
    label: "GCTC season",
    url: "https://www.gctc.ca/season",
    expect: "JSON-LD or listing links",
  },
  {
    label: "Chamberfest events",
    url: "https://www.chamberfest.com/event/",
    expect: "JSON-LD or listing links",
  },
  {
    label: "History events",
    url: "https://www.historymuseum.ca/events-and-programming",
    expect: "JSON-LD or listing links",
  },
  {
    label: "OLT calendar",
    url: "https://www.ottawalittletheatre.com/calendar/",
    expect: "JSON-LD or listing links",
  },
  {
    label: "Diefenbunker calendar",
    url: "https://diefenbunker.ca/events/?ical=1",
    expect: "ICS feed",
  },
];

interface ProbeFinding {
  label: string;
  url: string;
  expect: string;
  status: string;
  bytes: number;
  title: string | undefined;
  jsonLdBlocks: number;
  jsonLdEvents: number;
  icsLinks: number;
  rssLinks: number;
  sameHostLinks: number;
  linkSample: string[];
  textChars: number;
}

function sameHostLinks(pageUrl: string, html: string): string[] {
  const found = new Set<string>();
  const base = new URL(pageUrl);
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      const absolute = new URL(match[1] as string, pageUrl);
      if (absolute.host !== base.host) continue;
      if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
        continue;
      }
      found.add(absolute.href);
    } catch {
      // Skip unresolvable hrefs.
    }
  }
  return [...found];
}

function countJsonLdEvents(html: string): { blocks: number; events: number } {
  const re =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let blocks = 0;
  let events = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    blocks++;
    try {
      const doc: unknown = JSON.parse(match[1] as string);
      const nodes = Array.isArray(doc) ? doc : [doc];
      const stack: unknown[] = [...nodes];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node === null || typeof node !== "object") continue;
        const record = node as Record<string, unknown>;
        if (Array.isArray(record["@graph"])) {
          stack.push(...(record["@graph"] as unknown[]));
        }
        const types = Array.isArray(record["@type"])
          ? record["@type"]
          : [record["@type"]];
        if (types.includes("Event")) events++;
      }
    } catch {
      // Unparseable block counts as a block, not an event.
    }
  }
  return { blocks, events };
}

function loadEnvFile(): void {
  let dir = process.cwd();
  const chain: string[] = [];
  for (;;) {
    chain.push(dir);
    if (existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of chain) {
    const file = path.join(d, ".env");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key] === undefined) {
        process.env[key] = trimmed.slice(eq + 1).trim();
      }
    }
  }
}

async function probeOne(
  fetcher: Fetcher,
  target: ProbeTarget,
): Promise<ProbeFinding> {
  const base: ProbeFinding = {
    label: target.label,
    url: target.url,
    expect: target.expect,
    status: "error",
    bytes: 0,
    title: undefined,
    jsonLdBlocks: 0,
    jsonLdEvents: 0,
    icsLinks: 0,
    rssLinks: 0,
    sameHostLinks: 0,
    linkSample: [],
    textChars: 0,
  };
  try {
    const page = await fetcher.fetchText(target.url);
    if (page.notModified) {
      return { ...base, status: "not-modified" };
    }
    const links = sameHostLinks(page.url, page.text);
    const { blocks, events } = countJsonLdEvents(page.text);
    const title = /<title[^>]*>([\s\S]*?)<\/title\s*>/i
      .exec(page.text)?.[1]
      ?.replace(/\s+/g, " ")
      .trim();
    return {
      ...base,
      status: `HTTP ${page.status}`,
      bytes: page.text.length,
      title: title || undefined,
      jsonLdBlocks: blocks,
      jsonLdEvents: events,
      icsLinks: links.filter((l) => /\.ics(\?|#|$)/i.test(l)).length,
      rssLinks: links.filter((l) => /(\/feed\/?|rss|\.xml)$/i.test(l)).length,
      sameHostLinks: links.length,
      linkSample: links.slice(0, 8),
      textChars: visibleText(page.text).length,
    };
  } catch (error) {
    if (error instanceof RobotsDisallowed) {
      return { ...base, status: "robots-disallowed" };
    }
    if (error instanceof HttpNoRetry) {
      return { ...base, status: `BLOCKED http-${error.status}` };
    }
    return {
      ...base,
      status: `error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop probe: access-check approved sources with our User-Agent.\n" +
        "usage: npm run probe --workspace @seatpop/worker",
    );
    return 0;
  }
  loadEnvFile();
  const contactUrl =
    process.env["INGEST_CONTACT_URL"]?.trim() ||
    "https://github.com/seatpop/seatpop";
  if (!process.env["INGEST_CONTACT_URL"]?.trim()) {
    console.warn(
      "warning: INGEST_CONTACT_URL is unset; using a placeholder contact in the User-Agent",
    );
  }
  const stateDir = process.env["INGEST_STATE_DIR"]?.trim() || ".ingest-state";
  const fetcher = new Fetcher({
    contactUrl,
    etagStore: fileEtagStore(path.join(stateDir, "etags.json")),
  });
  const findings = await Promise.all(
    TARGETS.map((target) => probeOne(fetcher, target)),
  );
  findings.sort((a, b) => (a.label < b.label ? -1 : 1));
  for (const f of findings) {
    console.log(
      `--- ${f.label} (expect: ${f.expect})\n` +
        `url: ${f.url}\n` +
        `status: ${f.status} bytes=${f.bytes} title=${JSON.stringify(f.title ?? "")}\n` +
        `jsonld_blocks=${f.jsonLdBlocks} jsonld_events=${f.jsonLdEvents} ` +
        `ics_links=${f.icsLinks} rss_links=${f.rssLinks} same_host_links=${f.sameHostLinks} text_chars=${f.textChars}`,
    );
    for (const link of f.linkSample) {
      console.log(`  link: ${link}`);
    }
  }
  return 0;
}

const exitCode = await main().catch((error: unknown) => {
  console.error(
    `probe failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  return 1;
});
process.exit(exitCode);
