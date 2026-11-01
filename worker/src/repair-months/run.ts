import {
  BudgetExceeded,
  loadDotenv,
  type LlmProvider,
} from "@seatpop/llm";
import { optionsForSource } from "../ingest/source-config";
import type { StoreConfig } from "../ingest/store";
import { isDirectExecution } from "../script-entry";
import { resolveEnrichConfig, resolveProvider } from "../enrich/config";
import { hashContext, processOneCandidate } from "../enrich/process-one";
import {
  listAgeQuotes,
  listCandidates,
  listEventSourceNames,
} from "../enrich/store";
import { planMonthsRepair } from "./plan";

/**
 * Fast-track re-enrichment for month-stated ages (enrich.v4).
 *
 * The v4 prompt bump queues every row for lazy re-enrichment via the
 * source hash; this script repairs the actually-broken rows now: events
 * whose stored age quote contains "month" and whose hash is stale. Each
 * planned row runs the SAME vote → facet/policy → upsert assembly as a
 * normal enrich (processOneCandidate), so repair rows are shaped
 * identically. Rows without month quotes are never touched.
 *
 * Idempotent: a repaired row's hash matches afterwards, so re-running
 * plans nothing. Spends model budget like enrich (same $5/run cap);
 * a budget stop ends loudly with a partial report (exit 1).
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and model keys.
 */

function valueOf(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop repair:months: re-enrich month-quoted ages under enrich.v4.\n" +
        "usage: npm run repair:months --workspace @seatpop/worker [-- --dry-run] [--limit N] [--provider P]\n" +
        "  --dry-run    list what would be re-enriched; make no model calls.\n" +
        "  --limit N    re-enrich at most N events (soonest first).\n" +
        "  --provider P contributor|spark|baseten (default: baseten).",
    );
    return 0;
  }
  const dryRun = args.includes("--dry-run");
  const limitRaw = valueOf(args, "--limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limitRaw !== undefined && (!Number.isInteger(limit) || (limit as number) <= 0)) {
    console.error("--limit needs a positive integer");
    return 2;
  }
  loadDotenv();
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error("repair:months needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  const store: StoreConfig = { url: supabaseUrl, serviceKey };
  const provider = resolveProvider(valueOf(args, "--provider"));
  const llmConfig = resolveEnrichConfig();
  const modelOverride =
    provider === "spark" ? llmConfig.models.spark : undefined;
  const providerOverride: LlmProvider =
    provider === "baseten" ? "baseten" : "meta";

  const candidates = await listCandidates(store);
  const quotes = await listAgeQuotes(store);
  const listingSources = await listEventSourceNames(
    store,
    candidates.map((c) => c.id),
  );
  const { facetLabelsFor, hashFor } = hashContext(listingSources);
  const planned = planMonthsRepair(
    candidates.map((candidate) => {
      const quote = quotes.get(candidate.id);
      return {
        candidate,
        ageMinQuote: quote?.ageMinQuote ?? null,
        ageMaxQuote: quote?.ageMaxQuote ?? null,
        currentHash: hashFor(candidate),
      };
    }),
  );
  console.log(
    `repair:months: events=${candidates.length} ` +
      `month_rows=${planned.length}${dryRun ? " (dry run — no writes)" : ""}`,
  );
  for (const candidate of planned.slice(0, 20)) {
    const quote = quotes.get(candidate.id);
    console.log(
      `  planned ${candidate.starts_at.slice(0, 10)} ${candidate.title} ` +
        `[${quote?.ageMinQuote ?? "–"} / ${quote?.ageMaxQuote ?? "–"}]`,
    );
  }
  if (planned.length > 20) {
    console.log(`  ... and ${planned.length - 20} more`);
  }
  if (dryRun) return 0;

  const queue =
    limit === undefined ? planned : planned.slice(0, limit as number);
  const noTrainingFor = (id: string): boolean =>
    [...new Set(listingSources.get(id) ?? [])].some(
      (name) => optionsForSource(name).noTrainingRoute === true,
    );
  const now = new Date();
  let basetenExhausted = false;
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let costUsd = 0;
  for (const candidate of queue) {
    const noTraining = noTrainingFor(candidate.id);
    let outcome: Awaited<ReturnType<typeof processOneCandidate>>;
    try {
      outcome = await processOneCandidate(candidate, {
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
    } catch (error) {
      if (error instanceof BudgetExceeded && error.limit === "baseten_total") {
        console.warn(
          "repair:months: Baseten cap reached; no-training events skipped for this run",
        );
        basetenExhausted = true;
        skipped++;
        continue;
      }
      if (error instanceof BudgetExceeded) {
        console.error(
          `repair:months stopped: budget reached (${error.message}); partial report below`,
        );
        console.log(
          `repair:months: processed=${processed} failed=${failed} skipped=${skipped} ` +
            `cost_usd=${costUsd.toFixed(4)} STOPPED_BY_BUDGET`,
        );
        return 1;
      }
      throw error;
    }
    if (outcome.status === "skipped_baseten") {
      skipped++;
      continue;
    }
    if (outcome.status === "no_pass") {
      failed++;
      continue;
    }
    processed++;
    for (const call of outcome.processed.result.calls) {
      costUsd += call.costUsd;
    }
    console.log(`repair:months enriched ${candidate.id} ${candidate.title}`);
  }
  console.log(
    `repair:months: processed=${processed} failed=${failed} skipped=${skipped} ` +
      `cost_usd=${costUsd.toFixed(4)}`,
  );
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `repair:months failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
