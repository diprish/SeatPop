import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BudgetExceeded,
  ENRICHED_FIELDS,
  ENRICH_PROMPT_VERSION,
} from "@seatpop/llm";
import type { StoreConfig } from "../ingest/store";
import { isDirectExecution } from "../script-entry";
import { resolveEnrichConfig, resolveProvider } from "./config";
import { zonedLocalToUtc } from "../ingest/tz";
import {
  embedTextFor,
  localEmbed,
  startsWithinDays,
  toVectorLiteral,
} from "./embed";
import {
  listCandidates,
  listMissingEmbeddings,
  reportTallies,
  updateEmbedding,
  upsertEnrichment,
  upsertPricing,
} from "./store";
import {
  REVIEW_CONFIDENCE_BELOW,
  sourceHashFor,
  voteEnrichment,
  type VerifiedValue,
  type VoteResult,
} from "./vote";

/**
 * Phase-2 enrichment runner: new or changed events only (by source_hash),
 * soonest first, resumable and idempotent (every event commits before the
 * next starts, so re-running picks up where a run stopped).
 *
 * Model spend is capped at $5 per run; exhaustion stops the run loudly
 * with a partial report. Local bge-small embeddings cover events starting
 * within 30 days.
 */

export const ENRICH_EMBED_BATCH = 32;

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

function regOpensAtUtc(
  value: VerifiedValue,
  timezone: string,
): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  try {
    return zonedLocalToUtc(
      {
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
        hour: 0,
        minute: 0,
        second: 0,
      },
      timezone,
    );
  } catch {
    return null;
  }
}

const numOrNull = (v: VerifiedValue): number | null =>
  typeof v === "number" ? v : null;
const strOrNull = (v: VerifiedValue): string | null =>
  typeof v === "string" ? v : null;
const boolOrNull = (v: VerifiedValue): boolean | null =>
  typeof v === "boolean" ? v : null;
const listOrEmpty = (v: VerifiedValue): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

interface RunStats {
  processed: number;
  failed: number;
  fullyCached: number;
  livePasses: number;
  cachedPasses: number;
  tokensIn: number;
  tokensOut: number;
  reasoning: number;
  costUsd: number;
  /** Nulls per field; price_kind counts "unknown" as its null bucket. */
  nulls: Record<string, number>;
  review: Array<{ id: string; title: string; confidence: number }>;
  models: Set<string>;
}

function freshStats(): RunStats {
  const nulls: Record<string, number> = {};
  for (const field of ENRICHED_FIELDS) nulls[field] = 0;
  nulls["summary_short"] = 0;
  nulls["tags"] = 0;
  return {
    processed: 0,
    failed: 0,
    fullyCached: 0,
    livePasses: 0,
    cachedPasses: 0,
    tokensIn: 0,
    tokensOut: 0,
    reasoning: 0,
    costUsd: 0,
    nulls,
    review: [],
    models: new Set(),
  };
}

function printUsage(): void {
  console.log(`seatpop enrich: model enrichment + pricing + embeddings.
usage: npm run enrich --workspace @seatpop/worker -- [options]
  --provider contributor|spark  model for the task (default: ENRICH_PROVIDER
                                or contributor). spark runs the same task on
                                muse-spark-1.3 for phase-3 comparison.
  --limit N            enrich at most N pending events (soonest first).
  --dry-run            list what would be enriched; make no model calls.
  --skip-embeddings    skip the local embedding sweep.`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return 0;
  }
  loadEnvFile();
  const providerFlag = valueOf(args, "--provider");
  const limitRaw = valueOf(args, "--limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limitRaw !== undefined && (!Number.isInteger(limit) || (limit as number) <= 0)) {
    console.error("--limit needs a positive integer");
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  const skipEmbeddings = args.includes("--skip-embeddings");
  const provider = resolveProvider(providerFlag);
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error("enrich needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  const store: StoreConfig = { url: supabaseUrl, serviceKey };
  const llmConfig = resolveEnrichConfig();
  const modelOverride =
    provider === "spark" ? llmConfig.models.spark : undefined;

  const candidates = await listCandidates(store);
  const pending = candidates.filter(
    (c) =>
      sourceHashFor({
        title: c.title,
        description: c.description,
        venueName: c.venueName,
      }) !== c.sourceHash,
  );
  const now = new Date();
  if (dryRun) {
    const missing = await listMissingEmbeddings(store);
    const inWindow = missing.filter((m) =>
      startsWithinDays(m.starts_at, now.getTime()),
    ).length;
    console.log(
      `enrich dry-run: events=${candidates.length} pending=${pending.length} ` +
        `up_to_date=${candidates.length - pending.length} ` +
        `embeddings_missing=${missing.length} embeddings_in_window=${inWindow}`,
    );
    for (const c of pending.slice(0, 20)) {
      console.log(`  pending ${c.starts_at.slice(0, 10)} ${c.title}`);
    }
    if (pending.length > 20) console.log(`  ... and ${pending.length - 20} more`);
    return 0;
  }
  const queue =
    limit === undefined ? pending : pending.slice(0, limit as number);
  const stats = freshStats();
  let stoppedByBudget = false;

  for (const candidate of queue) {
    let result: VoteResult | null;
    try {
      result = await voteEnrichment(
        {
          id: candidate.id,
          title: candidate.title,
          description: candidate.description,
          venueName: candidate.venueName,
        },
        {
          config: llmConfig,
          model: modelOverride,
          now,
        },
      );
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        console.error(
          `enrich stopped: budget reached (${error.message}); partial report below`,
        );
        stoppedByBudget = true;
        break;
      }
      throw error;
    }
    if (!result) {
      stats.failed++;
      console.warn(`enrich: ${candidate.id} produced no usable pass; skipped`);
      continue;
    }
    const evidence: Record<string, { value: unknown; quote: string | null }> = {};
    for (const field of ENRICHED_FIELDS) {
      evidence[field] = {
        value: result.values[field],
        quote: result.quotes[field],
      };
    }
    evidence["summary_short"] = { value: result.summary, quote: null };
    evidence["tags"] = { value: result.tags, quote: null };
    await upsertEnrichment(store, {
      event_id: candidate.id,
      age_min: numOrNull(result.values.age_min),
      age_max: numOrNull(result.values.age_max),
      needs_adult: boolOrNull(result.values.needs_adult),
      setting: strOrNull(result.values.setting),
      energy: strOrNull(result.values.energy),
      crowd: strOrNull(result.values.crowd),
      duration_min: numOrNull(result.values.duration_min),
      language: strOrNull(result.values.language),
      accessibility: listOrEmpty(result.values.accessibility),
      registration_hint: strOrNull(result.values.registration_hint),
      registration_opens_at: regOpensAtUtc(
        result.values.registration_opens_at,
        candidate.timezone,
      ),
      summary_short: result.summary,
      tags: result.tags,
      evidence,
      model: result.model,
      prompt_version: ENRICH_PROMPT_VERSION,
      source_hash: sourceHashFor({
        title: candidate.title,
        description: candidate.description,
        venueName: candidate.venueName,
      }),
      confidence: result.confidence,
    });
    const priceKind =
      typeof result.values.price_kind === "string"
        ? result.values.price_kind
        : "unknown";
    await upsertPricing(store, {
      event_id: candidate.id,
      price_kind: priceKind,
      amount_min_cents: numOrNull(result.values.amount_min_cents),
      amount_max_cents: numOrNull(result.values.amount_max_cents),
      currency: strOrNull(result.values.currency),
      price_text: strOrNull(result.values.price_text),
      evidence_quote: result.quotes.price_kind,
      fee_notes: strOrNull(result.values.fee_notes),
    });
    stats.processed++;
    stats.models.add(result.model);
    if (result.calls.every((c) => c.cached)) stats.fullyCached++;
    for (const call of result.calls) {
      if (call.cached) stats.cachedPasses++;
      else stats.livePasses++;
      stats.tokensIn += call.promptTokens;
      stats.tokensOut += call.completionTokens;
      stats.reasoning += call.reasoningTokens;
      stats.costUsd += call.costUsd;
    }
    for (const field of ENRICHED_FIELDS) {
      const value = result.values[field];
      const isNull =
        field === "price_kind"
          ? value === "unknown"
          : value === null ||
            (Array.isArray(value) && value.length === 0);
      if (isNull) stats.nulls[field] = (stats.nulls[field] ?? 0) + 1;
    }
    if (result.summary === null) stats.nulls["summary_short"] = (stats.nulls["summary_short"] ?? 0) + 1;
    if (result.tags.length === 0) stats.nulls["tags"] = (stats.nulls["tags"] ?? 0) + 1;
    if (result.confidence < REVIEW_CONFIDENCE_BELOW) {
      stats.review.push({
        id: candidate.id,
        title: candidate.title,
        confidence: result.confidence,
      });
    }
    if (stats.processed % 25 === 0) {
      console.log(
        `enrich progress: ${stats.processed}/${queue.length} (failed=${stats.failed})`,
      );
    }
  }

  // Embedding sweep: fresh rows plus any earlier embedding failures.
  let embedded = 0;
  let embedSkipped = 0;
  let embedFailed = 0;
  if (!skipEmbeddings && !stoppedByBudget) {
    const missing = await listMissingEmbeddings(store);
    const sweepNow = Date.now();
    const due = missing.filter((m) =>
      startsWithinDays(m.starts_at, sweepNow),
    );
    embedSkipped = missing.length - due.length;
    for (let i = 0; i < due.length; i += ENRICH_EMBED_BATCH) {
      const batch = due.slice(i, i + ENRICH_EMBED_BATCH);
      let vectors: number[][];
      try {
        vectors = await localEmbed(
          batch.map((m) => embedTextFor(m.summary_short, m.tags, m.title)),
        );
      } catch (error) {
        embedFailed += batch.length;
        console.warn(
          `enrich: embedding batch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      for (let j = 0; j < batch.length; j++) {
        try {
          await updateEmbedding(
            store,
            (batch[j] as (typeof batch)[number]).event_id,
            toVectorLiteral((vectors[j] as number[])),
          );
          embedded++;
        } catch (error) {
          embedFailed++;
          console.warn(
            `enrich: embedding store failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  const tallies = await reportTallies(store);
  const costPer1k =
    stats.processed > 0 ? (stats.costUsd / stats.processed) * 1000 : 0;
  console.log(
    `enrich report (provider=${provider} model=${[...stats.models].join(",") || "(none)"} prompt=${ENRICH_PROMPT_VERSION}):`,
  );
  console.log(
    `  events: candidates=${candidates.length} pending=${pending.length} ` +
      `processed=${stats.processed} failed=${stats.failed} ` +
      `up_to_date=${candidates.length - pending.length}` +
      (stoppedByBudget ? " STOPPED_BY_BUDGET" : ""),
  );
  console.log(
    `  passes: live=${stats.livePasses} cached=${stats.cachedPasses} ` +
      `events_fully_cached=${stats.fullyCached}`,
  );
  console.log(
    `  spend: tokens_in=${stats.tokensIn} tokens_out=${stats.tokensOut} ` +
      `reasoning=${stats.reasoning} cost_usd=${stats.costUsd.toFixed(4)} ` +
      `cost_per_1k_events=${costPer1k.toFixed(2)}`,
  );
  const nullParts: string[] = [];
  for (const field of [...ENRICHED_FIELDS, "summary_short", "tags"] as string[]) {
    const rate =
      stats.processed > 0
        ? ((stats.nulls[field] ?? 0) / stats.processed).toFixed(2)
        : "n/a";
    nullParts.push(`${field}=${rate}`);
  }
  console.log(`  null_rate: ${nullParts.join(" ")}`);
  console.log(
    `  review_list(conf<${REVIEW_CONFIDENCE_BELOW}): ${stats.review.length} event(s)`,
  );
  for (const item of stats.review.slice(0, 20)) {
    console.log(`    ${item.confidence.toFixed(2)} ${item.id} ${item.title}`);
  }
  if (stats.review.length > 20) {
    console.log(`    ... and ${stats.review.length - 20} more`);
  }
  console.log(
    `  embeddings: embedded=${embedded} skipped_outside_window=${embedSkipped} failed=${embedFailed}`,
  );
  const cats = [...tallies.byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`  categories: ${cats}`);
  console.log(
    `  price_kind unknown: ${tallies.priceUnknown}/${tallies.priceTotal}`,
  );
  return stoppedByBudget ? 1 : 0;
}

function valueOf(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `enrich failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
