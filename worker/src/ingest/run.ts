import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LlmConfig } from "@seatpop/llm";
import { isDirectExecution } from "../script-entry";
import { resolveExtractionConfig } from "./extract";
import {
  Fetcher,
  HttpNoRetry,
  RobotsDisallowed,
  fileEtagStore,
  memoryEtagStore,
} from "./fetcher";
import { fileGeocodeCache, Geocoder, loadOverrides } from "./geocode";
import { HtmlAdapter } from "./html";
import { IcsAdapter } from "./ics";
import { JsonLdAdapter } from "./jsonld";
import { RssAdapter } from "./rss";
import { UserSubmittedAdapter } from "./user";
import { dedupeKey, rawHash } from "./dedupe";
import { optionsForSource } from "./source-config";
import {
  findEventsByDedupeKeys,
  findEventsByRawHashes,
  findVenueByName,
  insertEvent,
  insertVenue,
  linkEventSource,
  listEnabledSources,
  recordSourceRun,
  type SourceRow,
  type StoreConfig,
} from "./store";
import {
  SourceKindSchema,
  type Adapter,
  type EventDraft,
  type SourceConfig,
} from "./types";

const ADAPTERS: Record<string, Adapter> = {
  ics: IcsAdapter,
  jsonld: JsonLdAdapter,
  rss: RssAdapter,
  html: HtmlAdapter,
  user_submitted: UserSubmittedAdapter,
};

export interface SourceReport {
  name: string;
  kind: string;
  fetched: number;
  upcoming: number;
  inserted: number;
  linked: number;
  skippedUnchanged: number;
  status: string;
}

export interface IngestReport {
  dryRun: boolean;
  sources: SourceReport[];
}

interface RunOptions {
  dryRun: boolean;
  full: boolean;
  sourceFilter: string | undefined;
  contactUrl: string;
  stateDir: string;
  store: StoreConfig | undefined;
  fetchImpl?: typeof fetch;
  now?: Date;
  llmConfig?: LlmConfig;
}

function loadEnvFile(): void {
  // Minimal .env fill-unset (mirrors packages/llm; no shared runtime dep).
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

function upcomingOnly(drafts: EventDraft[], nowMs: number): EventDraft[] {
  return drafts.filter((d) => {
    const endMs = Date.parse(d.endsAtUtc ?? d.startsAtUtc);
    return endMs >= nowMs;
  });
}

async function ingestSource(
  source: SourceRow,
  options: RunOptions,
  fetcher: Fetcher,
  geocoder: Geocoder,
): Promise<SourceReport> {
  const report: SourceReport = {
    name: source.name,
    kind: source.kind,
    fetched: 0,
    upcoming: 0,
    inserted: 0,
    linked: 0,
    skippedUnchanged: 0,
    status: "ok",
  };
  const fail = async (status: string): Promise<SourceReport> => {
    report.status = status;
    if (!options.dryRun && options.store) {
      await recordSourceRun(options.store, source.id, {
        lastStatus: status,
        robotsOk: null,
      });
    }
    return report;
  };
  const kind = SourceKindSchema.safeParse(source.kind);
  if (!kind.success) return fail(`unknown kind: ${source.kind}`);
  const adapter = ADAPTERS[kind.data];
  if (!adapter) return fail(`no adapter for kind: ${source.kind}`);
  const sourceConfig: SourceConfig = {
    id: source.id,
    name: source.name,
    kind: kind.data,
    url: source.url,
    city: source.city,
    ...optionsForSource(source.name),
  };
  const now = options.now ?? new Date();
  let drafts: EventDraft[];
  try {
    drafts = await adapter.collect(sourceConfig, {
      fetcher,
      now,
      windowDays: 90,
      ...(options.llmConfig ? { llm: { config: options.llmConfig } } : {}),
    });
  } catch (error) {
    if (error instanceof RobotsDisallowed) {
      if (!options.dryRun && options.store) {
        await recordSourceRun(options.store, source.id, {
          lastStatus: "robots-disallowed",
          robotsOk: false,
        });
      }
      report.status = "robots-disallowed";
      return report;
    }
    if (error instanceof HttpNoRetry) {
      return fail(`http-${error.status}-no-retry`);
    }
    return fail(`error: ${error instanceof Error ? error.message : String(error)}`);
  }
  report.fetched = drafts.length;
  const upcoming = upcomingOnly(drafts, now.getTime());
  report.upcoming = upcoming.length;

  if (options.dryRun || !options.store) {
    report.status = options.dryRun ? "dry-run" : "no-store";
    return report;
  }
  const store = options.store;

  // Within-source dedupe: skip listings whose raw text already exists.
  const hashes = new Map<string, EventDraft>();
  for (const draft of upcoming) {
    hashes.set(rawHash(draft.rawText), draft);
  }
  const existing = await findEventsByRawHashes(
    store,
    source.id,
    [...hashes.keys()],
  );
  const fresh = [...hashes.entries()].filter(([h]) => !existing.has(h));
  report.skippedUnchanged = upcoming.length - fresh.length;

  // Cross-source dedupe: link to the canonical event or insert it.
  const keys = fresh.map(
    ([, draft]) =>
      [
        dedupeKey({
          title: draft.title,
          startsAtUtc: draft.startsAtUtc,
          venue: draft.venueName ?? draft.venueAddress,
        }),
        draft,
      ] as const,
  );
  const canonical = await findEventsByDedupeKeys(
    store,
    keys.map(([k]) => k),
  );
  for (const [key, draft] of keys) {
    const hit = canonical.get(key);
    if (hit) {
      await linkEventSource(store, hit.id, source.id, draft.sourceUrl);
      report.linked++;
      continue;
    }
    let venueId: string | undefined;
    const venueLabel = draft.venueName ?? draft.venueAddress;
    if (venueLabel) {
      const venueQuery = draft.venueAddress ?? draft.venueName ?? "";
      const found = await findVenueByName(store, venueLabel);
      if (found) {
        venueId = found.id;
      } else {
        const geo = venueQuery
          ? await geocoder.geocode(`${venueQuery}, Ottawa, ON`)
          : null;
        const created = await insertVenue(store, {
          name: venueLabel,
          address: draft.venueAddress,
          lat: geo?.lat,
          lng: geo?.lng,
          geocode_confidence: geo?.confidence,
        });
        venueId = created.id;
      }
    }
    const inserted = await insertEvent(store, {
      source_id: source.id,
      source_url: draft.sourceUrl,
      title: draft.title,
      description: draft.description,
      starts_at: draft.startsAtUtc,
      ends_at: draft.endsAtUtc,
      timezone: draft.timezone,
      venue_id: venueId,
      raw_text: draft.rawText,
      raw_hash: rawHash(draft.rawText),
      dedupe_key: key,
      category: draft.category,
      status: draft.status,
    });
    await linkEventSource(store, inserted.id, source.id, draft.sourceUrl);
    canonical.set(key, inserted);
    report.inserted++;
  }

  await recordSourceRun(store, source.id, {
    lastStatus: "ok",
    robotsOk: true,
  });
  return report;
}

export async function runIngest(options: RunOptions): Promise<IngestReport> {
  const fetcher = new Fetcher({
    fetchImpl: options.fetchImpl,
    contactUrl: options.contactUrl,
    // Dry runs always fetch fresh (truthful counts, zero state writes);
    // real runs use the file cache unless --full asks for a re-crawl.
    etagStore:
      options.dryRun || options.full
        ? memoryEtagStore()
        : fileEtagStore(path.join(options.stateDir, "etags.json")),
  });
  const geocoder = new Geocoder({
    fetchImpl: options.fetchImpl,
    contactUrl: options.contactUrl,
    cache: fileGeocodeCache(path.join(options.stateDir, "geocode.json")),
    overrides: loadOverrides(
      path.join(options.stateDir, "geocode-overrides.json"),
    ),
  });
  if (!options.store) {
    throw new Error("ingestion needs a store; pass --dry-run for a rehearsal");
  }
  const sources = (await listEnabledSources(options.store)).filter(
    (s) => !options.sourceFilter || s.name === options.sourceFilter,
  );
  const report: IngestReport = { dryRun: options.dryRun, sources: [] };
  for (const source of sources) {
    report.sources.push(await ingestSource(source, options, fetcher, geocoder));
  }
  return report;
}

function printUsage(): void {
  console.log(`seatpop ingest: fetch enabled sources into the events tables.
usage: npm run ingest --workspace @seatpop/worker -- [--dry-run] [--full] [--source NAME]
  --dry-run     fetch and parse only; print counts, write nothing to the
                database (html extraction still runs and may spend model
                budget up to $2 on cache misses).
  --full        ignore the ETag cache and re-crawl everything.
  --source NAME ingest one source by name.`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return 0;
  }
  loadEnvFile();
  const dryRun = args.includes("--dry-run");
  const full = args.includes("--full");
  const sourceIdx = args.indexOf("--source");
  const sourceFilter =
    sourceIdx >= 0 ? args[sourceIdx + 1] : undefined;
  if (sourceIdx >= 0 && !sourceFilter) {
    console.error("--source needs a name");
    return 2;
  }
  const contactUrl =
    process.env["INGEST_CONTACT_URL"]?.trim() ||
    "https://github.com/seatpop/seatpop";
  const stateDir = process.env["INGEST_STATE_DIR"]?.trim() || ".ingest-state";
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!dryRun && (!supabaseUrl || !serviceKey)) {
    console.error(
      "ingestion needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or --dry-run)",
    );
    return 2;
  }
  // Dry runs still list sources from the database; without Supabase there is
  // nothing to rehearse against.
  if (!supabaseUrl || !serviceKey) {
    console.error("dry-run needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to list sources");
    return 2;
  }
  // Tier-2 extraction runs in dry-runs too (counts need it) with the same
  // $2 budget and the same content-hash cache, so a dry-run warms the cache
  // and the real run after it makes zero new model calls.
  const report = await runIngest({
    dryRun,
    full,
    sourceFilter,
    contactUrl,
    stateDir,
    store: { url: supabaseUrl, serviceKey },
    llmConfig: resolveExtractionConfig(),
  });
  const totals = report.sources.reduce(
    (acc, s) => ({
      fetched: acc.fetched + s.fetched,
      upcoming: acc.upcoming + s.upcoming,
      inserted: acc.inserted + s.inserted,
      linked: acc.linked + s.linked,
      skippedUnchanged: acc.skippedUnchanged + s.skippedUnchanged,
    }),
    { fetched: 0, upcoming: 0, inserted: 0, linked: 0, skippedUnchanged: 0 },
  );
  for (const s of report.sources) {
    console.log(
      `${s.name} [${s.kind}] fetched=${s.fetched} upcoming=${s.upcoming} ` +
        `inserted=${s.inserted} linked=${s.linked} unchanged=${s.skippedUnchanged} status=${s.status}`,
    );
  }
  console.log(
    `${dryRun ? "dry-run" : "run"} totals: sources=${report.sources.length} ` +
      `fetched=${totals.fetched} upcoming=${totals.upcoming} inserted=${totals.inserted} ` +
      `linked=${totals.linked} unchanged=${totals.skippedUnchanged}`,
  );
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(`ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  });
  process.exit(exitCode);
}
