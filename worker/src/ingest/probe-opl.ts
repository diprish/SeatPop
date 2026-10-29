import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDirectExecution } from "../script-entry";
import {
  Fetcher,
  HttpNoRetry,
  RobotsDisallowed,
  memoryEtagStore,
  parseRobotsTxt,
  robotsAllows,
} from "./fetcher";
import { decodeEntities, visibleText } from "./html";

/**
 * OPL filter experiment (2026-10-28). The program listing paginates behind
 * session state, but robots allow the listing path and query strings, so
 * single-filter URLs (branch, age group, ...) may return different page-1
 * slices to a stateless fetch. This probe tries a bounded few and reports
 * which ones differ. Findings are data: robots refusals and bot-walls are
 * reported, never bypassed.
 *
 * Usage: npm run probe:opl --workspace @seatpop/worker
 */

const LISTING_URL = "https://biblioottawalibrary.ca/en/program";
const BOOKING_ROBOTS_URL = "https://booking.biblioottawalibrary.ca/robots.txt";
/** Bounded work: booking crawl-delay is 10 s, so 4 tries take ~1 minute. */
const MAX_FILTER_TRIES = 4;

export interface Displaying {
  from: number;
  to: number;
  of: number;
}

/** "Displaying 1 - 20 of 565" from the listing's visible text. */
export function parseDisplaying(text: string): Displaying | null {
  const m = /Displaying\s+([\d,]+)\s*-\s*([\d,]+)\s+of\s+([\d,]+)/i.exec(text);
  if (!m) return null;
  const num = (s: string | undefined): number => Number((s ?? "").replace(/,/g, ""));
  return { from: num(m[1]), to: num(m[2]), of: num(m[3]) };
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSelect {
  name: string;
  options: FilterOption[];
}

export interface FilterForm {
  method: string;
  action: string;
  selects: FilterSelect[];
}

/** First form on the page that carries at least one select. */
export function parseFilterForm(html: string): FilterForm | null {
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi;
  let formMatch: RegExpExecArray | null;
  while ((formMatch = formRe.exec(html)) !== null) {
    const attrs = formMatch[1] ?? "";
    const body = formMatch[2] ?? "";
    const method =
      /method\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? "get";
    const action = /action\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
    const selects: FilterSelect[] = [];
    const selectRe =
      /<select\b[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select\s*>/gi;
    let selectMatch: RegExpExecArray | null;
    while ((selectMatch = selectRe.exec(body)) !== null) {
      const name = selectMatch[1] as string;
      const options: FilterOption[] = [];
      const optionRe =
        /<option\b[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option\s*>/gi;
      let optionMatch: RegExpExecArray | null;
      while ((optionMatch = optionRe.exec(selectMatch[2] ?? "")) !== null) {
        options.push({
          value: decodeEntities(optionMatch[1] ?? ""),
          label: decodeEntities(
            (optionMatch[2] ?? "").replace(/<[^>]*>/g, " "),
          )
            .replace(/\s+/g, " ")
            .trim(),
        });
      }
      selects.push({ name, options });
    }
    if (selects.length > 0) return { method, action, selects };
  }
  return null;
}

/** Event titles from per-event links (/en/event/<slug>), in page order. */
export function parseEventLinkTitles(html: string, limit = 25): string[] {
  const titles: string[] = [];
  const re =
    /<a\b[^>]*href\s*=\s*["']([^"']*\/en\/event\/[^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null && titles.length < limit) {
    const title = decodeEntities((match[2] ?? "").replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (title !== "") titles.push(title);
  }
  return titles;
}

export interface FilterCandidate {
  select: string;
  value: string;
  label: string;
}

const ANY_LABEL = /any|all|choose|select|^\s*-/i;

/**
 * Pick single-filter tries: branch/audience-flavoured selects first, then
 * the rest; skip "any" options and empty values.
 */
export function pickFilterCandidates(
  form: FilterForm,
  maxTries: number = MAX_FILTER_TRIES,
): FilterCandidate[] {
  const preferred = (name: string): boolean =>
    /loc|branch|librar|audience|age/i.test(name);
  const ordered = [...form.selects].sort(
    (a, b) => Number(preferred(b.name)) - Number(preferred(a.name)),
  );
  const out: FilterCandidate[] = [];
  for (const select of ordered) {
    for (const option of select.options) {
      if (out.length >= maxTries) return out;
      if (option.value === "" || ANY_LABEL.test(option.label)) continue;
      out.push({ select: select.name, value: option.value, label: option.label });
      break;
    }
  }
  return out;
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

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop probe:opl: try OPL single-filter listing URLs with our User-Agent.\n" +
        "usage: npm run probe:opl --workspace @seatpop/worker",
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
  // Memory ETags: a probe must not warm the real run's file cache.
  const fetcher = new Fetcher({ contactUrl, etagStore: memoryEtagStore() });

  // 1. Robots first: display + machine verdict for the listing and a filter.
  try {
    const robotsRes = await fetch(BOOKING_ROBOTS_URL, {
      headers: { "User-Agent": `SeatPopIngest/0.1 (+${contactUrl})` },
    });
    const robotsText = robotsRes.ok ? await robotsRes.text() : "";
    console.log(`--- robots ${BOOKING_ROBOTS_URL} (HTTP ${robotsRes.status})`);
    const rules = parseRobotsTxt(robotsText);
    console.log(
      `crawl-delay=${rules.crawlDelayMs === undefined ? "none" : `${rules.crawlDelayMs / 1000}s`} ` +
        `listing=${robotsAllows(rules, "/en/program") ? "allow" : "DISALLOW"} ` +
        `filtered=${robotsAllows(rules, "/en/program") ? "allow" : "DISALLOW"}`,
    );
  } catch (error) {
    console.log(
      `robots fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 2. Baseline listing.
  let baselineHtml: string;
  let baselineUrl: string;
  try {
    const page = await fetcher.fetchText(LISTING_URL);
    baselineHtml = page.text;
    baselineUrl = page.url;
  } catch (error) {
    if (error instanceof RobotsDisallowed || error instanceof HttpNoRetry) {
      console.log(`baseline BLOCKED: ${error.message}; leaving OPL as is.`);
      return 0;
    }
    throw error;
  }
  const baselineShowing = parseDisplaying(visibleText(baselineHtml));
  const baselineTitles = parseEventLinkTitles(baselineHtml);
  console.log(
    `--- baseline ${baselineUrl}\n` +
      `displaying=${baselineShowing ? `${baselineShowing.from}-${baselineShowing.to} of ${baselineShowing.of}` : "unknown"} ` +
      `event_links=${baselineTitles.length}`,
  );
  for (const t of baselineTitles.slice(0, 5)) console.log(`  title: ${t}`);

  // 3. Filter form discovery.
  const form = parseFilterForm(baselineHtml);
  if (!form) {
    console.log("no filter form found; leaving OPL as is.");
    return 0;
  }
  console.log(`--- filter form method=${form.method} action=${form.action || "(same page)"}`);
  for (const s of form.selects) {
    console.log(
      `  select ${s.name}: ${s.options.length} options (e.g. ${s.options
        .slice(0, 3)
        .map((o) => JSON.stringify(o.label))
        .join(", ")})`,
    );
  }
  if (form.method !== "get") {
    console.log(`form needs ${form.method.toUpperCase()}; fetcher is GET-only, leaving OPL as is.`);
    return 0;
  }

  // 4. Bounded single-filter tries against the baseline.
  const candidates = pickFilterCandidates(form);
  if (candidates.length === 0) {
    console.log("no usable filter options; leaving OPL as is.");
    return 0;
  }
  const winners: string[] = [];
  for (const c of candidates) {
    const url = new URL(baselineUrl);
    url.search = "";
    url.searchParams.set(c.select, c.value);
    try {
      const page = await fetcher.fetchText(url.href);
      const showing = parseDisplaying(visibleText(page.text));
      const titles = parseEventLinkTitles(page.text);
      const differs =
        titles.length !== baselineTitles.length ||
        titles.some((t, i) => t !== baselineTitles[i]);
      console.log(
        `--- filter ${c.select}=${JSON.stringify(c.label)}\n` +
          `url: ${url.href}\n` +
          `displaying=${showing ? `${showing.from}-${showing.to} of ${showing.of}` : "unknown"} ` +
          `event_links=${titles.length} ${differs ? "DIFFERS" : "same-as-baseline"}`,
      );
      for (const t of titles.slice(0, 3)) console.log(`  title: ${t}`);
      if (differs && titles.length > 0) winners.push(url.href);
    } catch (error) {
      if (error instanceof RobotsDisallowed || error instanceof HttpNoRetry) {
        console.log(`--- filter ${c.select}=${JSON.stringify(c.label)} BLOCKED: ${error.message}`);
        continue;
      }
      throw error;
    }
  }
  console.log(
    winners.length > 0
      ? `winners (${winners.length}):\n${winners.map((w) => `  ${w}`).join("\n")}`
      : "no filter returned different results; leaving OPL as is.",
  );
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `probe:opl failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
