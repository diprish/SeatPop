import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadDotenv } from "@seatpop/llm";
import { isDirectExecution } from "../script-entry";
import { toCsv } from "./csv";
import { LABELING_COLUMNS, LABELING_RULE } from "./golden";
import { labelingCsvPath } from "./paths";
import { eventText, hasPriceSignal, sampleEvalSet } from "./sample";
import { listEvalPool } from "./store";

/**
 * `npm run eval:export`: sample 60 events across sources and categories
 * (at least 20 non-library, every price/free-text event included) and
 * write the labeling CSV. Listing text only — enrichment rows are never
 * selected, so no model answer can leak into the golden set.
 */

function instructions(priceIncluded: number): string[] {
  return [
    "# SeatPop enrichment eval — labeling instructions",
    `# RULE: ${LABELING_RULE}.`,
    "# Label columns only (context columns are read-only): age_min, age_max",
    "# (whole years, blank when unstated), price_kind (blank = unknown, or",
    "# free|paid|pay_what_you_can|donation|member_only), amount (blank, or",
    '# dollars like 25, $25.00, or a range 10-20), setting, language,',
    '# registration_hint, accessibility (";"-separated, blank when unstated).',
    '# Put x in labeled when the row is done; notes are free text.',
    `# ${priceIncluded} row(s) below mention a price or the word "free" and`,
    "# were force-included; the rest stratify sources x categories.",
    "# Validate with: npm run eval:import --workspace @seatpop/worker",
  ];
}

function contextCells(
  row: { id: string; title: string; description: string | null; venueName: string | null; source: string; category: string | null },
): string[] {
  return [
    row.id,
    row.title,
    row.description ?? "",
    row.venueName ?? "",
    row.source,
    row.category ?? "",
  ];
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "seatpop eval:export: sample 60 events and write worker/eval/labeling.csv.\n" +
        "usage: npm run eval:export --workspace @seatpop/worker [-- --force]\n" +
        "  --force    overwrite an existing labeling.csv (default refuses).",
    );
    return 0;
  }
  loadDotenv();
  const out = labelingCsvPath();
  if (existsSync(out) && !args.includes("--force")) {
    console.error(
      `refusing to overwrite ${out} (labeling work may exist); pass --force to resample`,
    );
    return 2;
  }
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error("eval:export needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  const pool = await listEvalPool({ url: supabaseUrl, serviceKey });
  const { sample, stats } = sampleEvalSet(pool);
  const rows: string[][] = [
    [...LABELING_COLUMNS],
    ...sample.map((row) => [...contextCells(row), "", "", "", "", "", "", "", "", "", ""]),
  ];
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${instructions(stats.priceIncluded).join("\n")}\n${toCsv(rows)}`,
    "utf8",
  );
  const cats = Object.entries(stats.perCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(
    `eval:export: pool=${pool.length} sampled=${stats.total} ` +
      `non_library=${stats.nonLibrary} price_included=${stats.priceIncluded}`,
  );
  if (stats.priceDropped > 0) {
    console.warn(
      `eval:export: WARNING: ${stats.priceDropped} price/free-text event(s) ` +
        `did not fit in 60 rows (non-library price kept first, then room ` +
        `held for the 20 non-library floor); the "include every" rule is ` +
        `unsatisfiable at this volume — narrow the pool or raise the total ` +
        `before trusting price coverage`,
    );
  }
  if (!stats.floorMet) {
    console.warn(
      `eval:export: WARNING: non-library floor missed ` +
        `(non_library=${stats.nonLibrary}, need 20): the pool holds too few ` +
        `non-library events to satisfy it`,
    );
  }
  if (stats.total < 60) {
    console.warn(
      `eval:export: WARNING: pool holds ${pool.length} events; sampled ${stats.total}, short of 60`,
    );
  }
  const flagged = sample.filter((row) => hasPriceSignal(eventText(row))).length;
  console.log(`  price_or_free_rows=${flagged} categories: ${cats}`);
  console.log(`  wrote ${out}`);
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `eval:export failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
