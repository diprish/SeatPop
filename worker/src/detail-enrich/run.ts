import { loadDotenv, BudgetExceeded, type LlmProvider } from "@seatpop/llm";
import { sanitizeText } from "@seatpop/shared";
import { hashContext, processOneCandidate } from "../enrich/process-one";
import {
  listEventSourceNames,
  type EnrichCandidate,
} from "../enrich/store";
import { resolveEnrichConfig, resolveProvider } from "../enrich/config";
import { Fetcher } from "../ingest/fetcher";
import { visibleText } from "../ingest/html";
import { optionsForSource } from "../ingest/source-config";
import type { StoreConfig } from "../ingest/store";
import { isDirectExecution } from "../script-entry";
import {
  clampDetailLimit,
  classifyFetchError,
  detailBeatsFeed,
  MAX_PAGES_PER_RUN,
  needsDetailText,
  sameSite,
  strictDetailFailed,
} from "./plan";
import { DETAIL_SOURCES } from "./sources";

/**
 * Detail-page enrichment: for upcoming events from YES/accepted-DECIDE
 * sources (see DETAIL_SOURCES) whose feed text is empty or under 200
 * characters, fetch the event's own official page, strip it to text,
 * store it as description_source=detail_page, and run the usual
 * enrichment (same verifier, same spend caps). One attempt per event:
 * sourced rows are never re-fetched.
 *
 * Politeness is structural: allowlisted sources only, same-host pages
 * only (checked before the fetch and after redirects), robots.txt
 * enforced (query strings included), 3 s per host floor plus
 * crawl-delay, honest User-Agent, 401/403 recorded as skips — never
 * retried, never bypassed. Skips never fail the run, even --strict;
 * unexpected errors and Meta no-pass events do.
 *
 * --dry-run lists candidates and writes nothing (needs SUPABASE keys
 * for the reads). --limit N fetches fewer than the 150/run cap.
 */

interface Deps {
  url: string;
  serviceKey: string;
}

async function rest<T>(
  deps: Deps,
  tablePath: string,
  query: string,
  init?: { method?: string; body?: unknown; prefer?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: deps.serviceKey,
    Authorization: `Bearer ${deps.serviceKey}`,
  };
  if (init?.prefer) headers["Prefer"] = init.prefer;
  const response = await fetch(
    `${deps.url.replace(/\/$/, "")}/rest/v1/${tablePath}${query}`,
    {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    },
  );
  if (!response.ok) {
    throw new Error(`supabase ${tablePath} failed: HTTP ${response.status}`);
  }
  if (init?.prefer?.includes("return=minimal")) return undefined as T;
  return (await response.json()) as T;
}

interface SourceRow {
  id: string;
  name: string;
  url: string;
  pricing_policy_kind: string | null;
  pricing_policy_quote: string | null;
  pricing_policy_url: string | null;
  pricing_policy_scope: string[] | null;
}

interface CandidateRow {
  id: string;
  title: string;
  description: string | null;
  description_source: string;
  starts_at: string;
  timezone: string;
  category: string | null;
  source_url: string;
  source_id: string;
  venue: { name: string } | null;
  event_enrichment: {
    source_hash: string | null;
    model: string | null;
  } | null;
}

function valueOf(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

/** Events currently priced paid or free (before/after report). */
async function pricedCount(deps: Deps): Promise<number> {
  const rows = await rest<Array<{ price_kind: string }>>(
    deps,
    "event_pricing",
    "?select=price_kind&limit=10000",
  );
  return rows.filter(
    (row) => row.price_kind === "paid" || row.price_kind === "free",
  ).length;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop detail-enrich: fetch thin official pages, then enrich.\n" +
        "usage: npm run detail-enrich --workspace @seatpop/worker [-- --dry-run] [--limit N] [--strict]\n" +
        "  --dry-run    list candidates and price counts; fetch and write nothing.\n" +
        `  --limit N    fetch at most N pages, soonest first (default ${MAX_PAGES_PER_RUN}; never more per run).\n` +
        "  --strict     exit 1 on any unexpected error or Meta no-pass event.",
    );
    return 0;
  }
  const dryRun = args.includes("--dry-run");
  const strict = args.includes("--strict");
  const limitRaw = valueOf(args, "--limit");
  const requested = limitRaw === undefined ? undefined : Number(limitRaw);
  if (
    requested !== undefined &&
    (!Number.isInteger(requested) || requested <= 0)
  ) {
    console.error("--limit needs a positive integer");
    return 2;
  }
  const cap = clampDetailLimit(requested);
  if (requested !== undefined && requested > cap) {
    console.log(`detail-enrich: --limit ${requested} clamped to ${cap}/run cap`);
  }
  loadDotenv();
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error("detail-enrich needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  const contactUrl =
    process.env["INGEST_CONTACT_URL"]?.trim() ||
    "https://github.com/seatpop/seatpop";
  const deps: Deps = { url: supabaseUrl, serviceKey };
  const store: StoreConfig = { url: supabaseUrl, serviceKey };

  const sources = await rest<SourceRow[]>(
    deps,
    "sources",
    `?select=id,name,url,pricing_policy_kind,pricing_policy_quote,pricing_policy_url,pricing_policy_scope&name=in.(${DETAIL_SOURCES.map((name) => encodeURIComponent(`"${name}"`)).join(",")})`,
  );
  const byName = new Map(sources.map((source) => [source.name, source]));
  for (const name of DETAIL_SOURCES) {
    if (!byName.has(name)) {
      console.warn(`detail-enrich: source "${name}" not in sources table — skipped`);
    }
  }
  const allowIds = [...byName.values()].map((source) => source.id);
  const now = new Date();
  const rows =
    allowIds.length === 0
      ? []
      : await rest<CandidateRow[]>(
          deps,
          "events",
          `?select=id,title,description,description_source,starts_at,timezone,category,source_url,source_id,venue:venues(name),event_enrichment(source_hash,model)` +
            `&source_id=in.(${allowIds.map((id) => encodeURIComponent(id)).join(",")})` +
            `&status=not.in.(cancelled,full)&starts_at=gt.${encodeURIComponent(now.toISOString())}` +
            `&order=starts_at.asc&limit=2000`,
        );
  const candidates = rows.filter(
    (row) =>
      row.description_source !== "detail_page" &&
      needsDetailText(row.description),
  );
  const pricedBefore = await pricedCount(deps);
  console.log(
    `detail-enrich: upcoming=${rows.length} short_text=${candidates.length} cap=${cap} priced_paid_free=${pricedBefore}` +
      (dryRun ? " (dry run — no fetches, no writes)" : ""),
  );
  for (const candidate of candidates.slice(0, 20)) {
    const source = [...byName.values()].find((s) => s.id === candidate.source_id);
    console.log(
      `  ${candidate.starts_at.slice(0, 10)} ${source?.name ?? "?"} ${candidate.title.slice(0, 60)}` +
        ` (feed chars=${candidate.description?.length ?? 0})`,
    );
  }
  if (candidates.length > 20) {
    console.log(`  ... and ${candidates.length - 20} more`);
  }
  if (dryRun) return 0;

  const queue = candidates.slice(0, cap);
  const llmConfig = resolveEnrichConfig();
  const provider = resolveProvider(undefined, process.env);
  const modelOverride =
    provider === "spark" ? llmConfig.models.spark : undefined;
  const providerOverride: LlmProvider =
    provider === "baseten" ? "baseten" : "meta";
  const listingSources = await listEventSourceNames(
    store,
    queue.map((candidate) => candidate.id),
  );
  const { facetLabelsFor, hashFor } = hashContext(listingSources);
  const noTrainingFor = (id: string): boolean =>
    [...new Set(listingSources.get(id) ?? [])].some(
      (name) => optionsForSource(name).noTrainingRoute === true,
    );
  const fetcher = new Fetcher({ contactUrl });

  let fetched = 0;
  let enriched = 0;
  let unchanged = 0;
  let skipped = 0;
  const skips: Record<string, number> = {};
  const failures: string[] = [];
  let basetenExhausted = false;
  let stoppedByBudget = false;
  let costUsd = 0;
  const models = new Set<string>();
  const skip = (kind: string, id: string, note: string): void => {
    skips[kind] = (skips[kind] ?? 0) + 1;
    skipped++;
    console.log(`  skip ${kind} ${id} ${note}`);
  };

  for (const candidate of queue) {
    if (stoppedByBudget) break;
    const feedUrl = [...byName.values()].find(
      (s) => s.id === candidate.source_id,
    )?.url;
    if (!feedUrl || !sameSite(feedUrl, candidate.source_url)) {
      skip("off_host", candidate.id, candidate.source_url);
      continue;
    }
    let page: { url: string; text: string };
    try {
      page = await fetcher.fetchText(candidate.source_url);
    } catch (error) {
      const kind = classifyFetchError(error);
      if (kind === "error") {
        failures.push(candidate.id);
        console.warn(
          `  failed ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } else {
        skip(kind, candidate.id, candidate.source_url);
      }
      continue;
    }
    if (!sameSite(feedUrl, page.url)) {
      skip("off_host", candidate.id, `redirect to ${page.url}`);
      continue;
    }
    const text = sanitizeText(visibleText(page.text));
    if (!detailBeatsFeed(text, candidate.description)) {
      skip(
        "thin",
        candidate.id,
        `${candidate.source_url} (detail chars=${text.length}, feed chars=${candidate.description?.length ?? 0})`,
      );
      continue;
    }
    fetched++;
    const venueName = candidate.venue?.name ?? null;
    const sourceRow = [...byName.values()].find(
      (s) => s.id === candidate.source_id,
    );
    const enrichedCandidate: EnrichCandidate = {
      id: candidate.id,
      title: candidate.title,
      description: text,
      starts_at: candidate.starts_at,
      timezone: candidate.timezone,
      category: candidate.category,
      venueName,
      model: candidate.event_enrichment?.model ?? null,
      sourceHash: candidate.event_enrichment?.source_hash ?? null,
      policy:
        sourceRow?.pricing_policy_kind && sourceRow.pricing_policy_quote
          ? {
              kind: sourceRow.pricing_policy_kind,
              quote: sourceRow.pricing_policy_quote,
              url: sourceRow.pricing_policy_url ?? "",
              scope: sourceRow.pricing_policy_scope,
            }
          : null,
    };
    if (text === (candidate.description ?? "")) {
      // Same words, new provenance: mark sourced, skip the model call.
      await rest(deps, "events", `?id=eq.${candidate.id}`, {
        method: "PATCH",
        body: { description_source: "detail_page" },
        prefer: "return=minimal",
      });
      unchanged++;
      continue;
    }
    await rest(deps, "events", `?id=eq.${candidate.id}`, {
      method: "PATCH",
      body: { description: text, description_source: "detail_page" },
      prefer: "return=minimal",
    });
    if (hashFor(enrichedCandidate) === enrichedCandidate.sourceHash) {
      unchanged++;
      continue;
    }
    const noTraining = noTrainingFor(candidate.id);
    try {
      const outcome = await processOneCandidate(enrichedCandidate, {
        store,
        llmConfig,
        modelOverride,
        providerOverride,
        noTraining,
        basetenExhausted,
        now,
        hashFor,
        facetLabelsFor,
      });
      if (outcome.status === "skipped_baseten") {
        skipped++;
        continue;
      }
      if (outcome.status === "no_pass") {
        if (noTraining) {
          skipped++;
        } else {
          failures.push(candidate.id);
          console.warn(`  failed ${candidate.id}: no usable enrichment pass`);
        }
        continue;
      }
      enriched++;
      models.add(outcome.processed.result.model);
      for (const call of outcome.processed.result.calls) {
        costUsd += call.costUsd;
      }
      console.log(`  enriched ${candidate.id} ${candidate.title.slice(0, 50)}`);
    } catch (error) {
      if (error instanceof BudgetExceeded && error.limit === "baseten_total") {
        console.warn(
          "detail-enrich: Baseten cap reached; no-training events skipped for this run",
        );
        basetenExhausted = true;
        skipped++;
        continue;
      }
      if (error instanceof BudgetExceeded) {
        console.error(
          `detail-enrich stopped: budget reached (${error.message}); partial report below`,
        );
        stoppedByBudget = true;
        break;
      }
      throw error;
    }
  }

  const pricedAfter = await pricedCount(deps);
  const skipParts = Object.entries(skips)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(" ");
  console.log(
    `detail-enrich report: fetched=${fetched} enriched=${enriched} unchanged=${unchanged} ` +
      `skipped=${skipped}${skipParts ? ` (${skipParts})` : ""} failed=${failures.length} ` +
      `cost_usd=${costUsd.toFixed(4)} models=${[...models].join(",") || "(none)"}` +
      (stoppedByBudget ? " STOPPED_BY_BUDGET" : ""),
  );
  console.log(
    `detail-enrich: price paid/free: ${pricedBefore} -> ${pricedAfter}`,
  );
  if (failures.length > 0) {
    console.error(`detail-enrich failures: ${failures.join(", ")}`);
  }
  if (strict && strictDetailFailed(failures.length)) {
    console.error(
      `detail-enrich strict: ${failures.length} event(s) errored or produced no usable pass`,
    );
    return 1;
  }
  return stoppedByBudget ? 1 : 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `detail-enrich failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
