import { loadDotenv } from "@seatpop/llm";
import type { StoreConfig } from "../ingest/store";
import { isDirectExecution } from "../script-entry";
import { hashContext } from "../enrich/process-one";
import {
  listCandidates,
  listEnrichmentAges,
  listEventSourceNames,
  patchEnrichmentAges,
} from "../enrich/store";
import {
  findMonthsRanges,
  planMonthsRepair,
  REPAIR_MODEL,
  type MonthsCorrection,
} from "./plan";

/**
 * Deterministic repair for months stored as years (no model calls, no
 * spend, no keys beyond Supabase): events whose listing text states a
 * single months/mois range get age_min/age_max rewritten to converted
 * years, the matched span stamped as the age evidence quotes, the
 * model marked repair-months, and the source hash brought current so
 * the next enrich run treats the row as done instead of re-voting it.
 *
 * Corrected rows carry real ages, so recommend_candidates derives
 * age_fallback=false for them and the "check the age group" flag
 * clears on its own — there is no stored flag to set.
 *
 * Dry run by default; --apply writes. Idempotent: a repaired row
 * plans nothing on re-run. Only rows whose listing text contains a
 * months range are ever touched.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

function valueOf(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function showAge(value: number | null): string {
  return value === null ? "–" : String(value);
}

function printTable(plans: MonthsCorrection[]): void {
  for (const plan of plans) {
    const title =
      plan.title.length > 52 ? `${plan.title.slice(0, 51)}…` : plan.title;
    console.log(
      `  ${plan.eventId.slice(0, 8)} ${showAge(plan.beforeMin)}–${showAge(plan.beforeMax)} → ${plan.afterMin}–${plan.afterMax} [${plan.quote}] ${title}`,
    );
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop repair:months: fix months stored as years (deterministic).\n" +
        "usage: npm run repair:months --workspace @seatpop/worker [-- --apply] [--limit N]\n" +
        "  (no flags)   dry run: print every planned correction; write nothing.\n" +
        "  --apply      write the planned corrections to event_enrichment.\n" +
        "  --limit N    apply to at most N events (soonest first).",
    );
    return 0;
  }
  if (valueOf(args, "--provider") !== undefined || args.includes("--dry-run")) {
    // The old model re-enrichment took --provider/--dry-run; the
    // deterministic repair is always a dry run unless --apply is set.
    console.error(
      "repair:months is deterministic now: drop --provider/--dry-run (dry run is the default; --apply writes)",
    );
    return 2;
  }
  const apply = args.includes("--apply");
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

  const candidates = await listCandidates(store);
  const ages = await listEnrichmentAges(store);
  const listingSources = await listEventSourceNames(
    store,
    candidates.map((c) => c.id),
  );
  const { hashFor } = hashContext(listingSources);

  let monthText = 0;
  let unenriched = 0;
  const plans = planMonthsRepair(
    candidates.flatMap((candidate) => {
      const stored = ages.get(candidate.id);
      if (!stored) {
        unenriched++;
        return [];
      }
      if (
        findMonthsRanges(`${candidate.title}\n${candidate.description ?? ""}`)
          .length > 0
      ) {
        monthText++;
      }
      return [
        {
          eventId: candidate.id,
          title: candidate.title,
          description: candidate.description,
          ageMin: stored.ageMin,
          ageMax: stored.ageMax,
          model: stored.model,
        },
      ];
    }),
  );
  console.log(
    `repair:months: events=${candidates.length} enriched=${ages.size} ` +
      `month_text=${monthText} planned=${plans.length} unenriched=${unenriched}` +
      (apply ? "" : " (dry run — no writes; re-run with --apply)"),
  );
  printTable(plans);
  if (!apply) return 0;

  const queue =
    limit === undefined ? plans : plans.slice(0, limit as number);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  let repaired = 0;
  for (const plan of queue) {
    const candidate = byId.get(plan.eventId);
    const stored = ages.get(plan.eventId);
    if (!candidate || !stored) continue;
    const evidence = JSON.parse(JSON.stringify(stored.evidence ?? {})) as Record<
      string,
      { value: unknown; quote: unknown }
    >;
    evidence["age_min"] = { value: plan.afterMin, quote: plan.quote };
    evidence["age_max"] = { value: plan.afterMax, quote: plan.quote };
    await patchEnrichmentAges(store, plan.eventId, {
      age_min: plan.afterMin,
      age_max: plan.afterMax,
      evidence,
      model: REPAIR_MODEL,
      source_hash: hashFor(candidate),
    });
    repaired++;
    console.log(`repair:months repaired ${plan.eventId} ${plan.title}`);
  }
  console.log(`repair:months: repaired=${repaired} failed=0`);
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
