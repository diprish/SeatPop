import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Default floor between requests to one host (CONTEXT rule 6: 3 s). */
export const DEFAULT_MIN_DELAY_MS = 3000;

export function userAgent(contactUrl: string): string {
  return `SeatPopIngest/0.1 (+${contactUrl})`;
}

/** Thrown when robots.txt disallows a URL. Never retried, never bypassed. */
export class RobotsDisallowed extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = "RobotsDisallowed";
  }
}

/** Thrown on HTTP 401/403. The fetcher hard-refuses to retry these. */
export class HttpNoRetry extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`HTTP ${status} for ${url}: not retried`);
    this.name = "HttpNoRetry";
    this.status = status;
  }
}

export interface EtagEntry {
  etag?: string;
  modified?: string;
}

export interface EtagStore {
  get(url: string): EtagEntry | undefined;
  set(url: string, entry: EtagEntry): void;
}

export function memoryEtagStore(): EtagStore {
  const map = new Map<string, EtagEntry>();
  return {
    get: (url) => map.get(url),
    set: (url, entry) => {
      map.set(url, entry);
    },
  };
}

/** File-backed ETag store (JSON object). Failures are swallowed: caching is best-effort. */
export function fileEtagStore(filePath: string): EtagStore {
  const load = (): Record<string, EtagEntry> => {
    try {
      if (!existsSync(filePath)) return {};
      return JSON.parse(readFileSync(filePath, "utf8")) as Record<
        string,
        EtagEntry
      >;
    } catch {
      return {};
    }
  };
  const save = (data: Record<string, EtagEntry>): void => {
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(data), "utf8");
    } catch {
      // Best-effort only.
    }
  };
  return {
    get: (url) => load()[url],
    set: (url, entry) => {
      const data = load();
      data[url] = entry;
      save(data);
    },
  };
}

interface RobotsRules {
  disallows: string[];
  crawlDelayMs: number | undefined;
}

/** Minimal robots.txt parser: our UA group, then the `*` group. */
export function parseRobotsTxt(
  text: string,
  ourAgent = "seatpopingest",
): RobotsRules {
  const groups: Array<{ agents: string[]; rules: RobotsRules }> = [];
  let current: { agents: string[]; rules: RobotsRules } | undefined;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      const agent = value.toLowerCase();
      if (
        current === undefined ||
        current.rules.disallows.length > 0 ||
        current.rules.crawlDelayMs !== undefined
      ) {
        current = {
          agents: [],
          rules: { disallows: [], crawlDelayMs: undefined },
        };
        groups.push(current);
      }
      current.agents.push(agent);
    } else if (current !== undefined && field === "disallow") {
      if (value !== "") current.rules.disallows.push(value);
    } else if (current !== undefined && field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.rules.crawlDelayMs = seconds * 1000;
      }
    }
  }
  const match =
    groups.find((g) => g.agents.some((a) => ourAgent.includes(a) || a === "*")) ??
    groups.find((g) => g.agents.includes("*"));
  return match?.rules ?? { disallows: [], crawlDelayMs: undefined };
}

export function robotsAllows(rules: RobotsRules, urlPath: string): boolean {
  return !rules.disallows.some(
    (prefix) => prefix !== "" && urlPath.startsWith(prefix),
  );
}

export interface FetchResult {
  status: number;
  /** Final URL after redirects. */
  url: string;
  /** Empty when notModified is true. */
  text: string;
  notModified: boolean;
}

export interface FetcherOptions {
  fetchImpl?: typeof fetch;
  contactUrl: string;
  minDelayMs?: number;
  timeoutMs?: number;
  etagStore?: EtagStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Polite shared fetcher: robots.txt enforced and cached per host, at least
 * minDelayMs between requests to one host (plus Crawl-Delay when larger),
 * ETag/If-Modified-Since, timeouts, and a hard refusal to retry 401/403.
 */
export class Fetcher {
  private readonly fetchImpl: typeof fetch;
  private readonly agent: string;
  private readonly minDelayMs: number;
  private readonly timeoutMs: number;
  private readonly etagStore: EtagStore;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly lastFetchAt = new Map<string, number>();
  private readonly robotsCache = new Map<string, RobotsRules>();

  constructor(options: FetcherOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.agent = userAgent(options.contactUrl);
    this.minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.etagStore = options.etagStore ?? memoryEtagStore();
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  private async throttle(host: string, extraDelayMs = 0): Promise<void> {
    const delay = Math.max(this.minDelayMs, extraDelayMs);
    const last = this.lastFetchAt.get(host);
    if (last !== undefined) {
      const wait = delay - (this.now() - last);
      if (wait > 0) await this.sleep(wait);
    }
    this.lastFetchAt.set(host, this.now());
  }

  private async getWithTimeout(
    url: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: { "User-Agent": this.agent, ...headers },
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch and parse robots.txt for a host (cached). Unreachable means allow; hidden (401/403) means deny. */
  async robotsRulesFor(url: string): Promise<RobotsRules> {
    const parsed = new URL(url);
    const host = parsed.host;
    const cached = this.robotsCache.get(host);
    if (cached) return cached;
    const robotsUrl = `${parsed.protocol}//${host}/robots.txt`;
    await this.throttle(host);
    let rules: RobotsRules = { disallows: [], crawlDelayMs: undefined };
    try {
      const response = await this.getWithTimeout(robotsUrl, {});
      if (response.status === 401 || response.status === 403) {
        rules = { disallows: ["/"], crawlDelayMs: undefined };
      } else if (response.ok) {
        rules = parseRobotsTxt(await response.text());
      }
    } catch {
      // Unreachable robots.txt: allow (fail open), rules stay empty.
    }
    this.robotsCache.set(host, rules);
    return rules;
  }

  async robotsOk(url: string): Promise<boolean> {
    const parsed = new URL(url);
    const rules = await this.robotsRulesFor(url);
    return robotsAllows(rules, parsed.pathname);
  }

  async fetchText(url: string): Promise<FetchResult> {
    const parsed = new URL(url);
    const rules = await this.robotsRulesFor(url);
    if (!robotsAllows(rules, parsed.pathname)) {
      throw new RobotsDisallowed(url);
    }
    await this.throttle(parsed.host, rules.crawlDelayMs ?? 0);
    const headers: Record<string, string> = {};
    const entry = this.etagStore.get(url);
    if (entry?.etag) headers["If-None-Match"] = entry.etag;
    if (entry?.modified) headers["If-Modified-Since"] = entry.modified;
    const response = await this.getWithTimeout(url, headers);
    if (response.status === 401 || response.status === 403) {
      throw new HttpNoRetry(url, response.status);
    }
    if (response.status === 304) {
      return { status: 304, url: response.url || url, text: "", notModified: true };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const etag = response.headers.get("etag") ?? undefined;
    const modified = response.headers.get("last-modified") ?? undefined;
    if (etag !== undefined || modified !== undefined) {
      this.etagStore.set(url, { etag, modified });
    }
    return {
      status: response.status,
      url: response.url || url,
      text: await response.text(),
      notModified: false,
    };
  }
}
