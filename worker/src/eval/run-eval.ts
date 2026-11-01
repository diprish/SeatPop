import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BudgetExceeded,
  ENRICH_PROMPT_VERSION,
  loadDotenv,
  type LlmConfig,
  type LlmProvider,
} from "@seatpop/llm";
import { isDirectExecution } from "../script-entry";
import { resolveEnrichConfig } from "../enrich/config";
import { voteEnrichment, type VoteResult } from "../enrich/vote";
import { parseGoldenJsonl } from "./golden";
import {
  docsReportPath,
  evalReportPath,
  goldenEventsPath,
  webReportPath,
} from "./paths";
import {
  modelReportFor,
  renderMarkdownReport,
  type EvalModelKey,
  type EvalReport,
} from "./report";
import { scoreModel } from "./score";

/**
 * `npm run eval`: run voted enrichment over golden/events.jsonl on each of
 * the three public-text models — contributor, standard Spark, Baseten
 * Spark Open — then score and report. Production-identical voting (same
 * passes, same verifier); Baseten runs with fallback "none" so a Baseten
 * outage scores as failed events, never as silent contributor output.
 */

interface EvalModelConfig {
  key: EvalModelKey;
  provider: LlmProvider;
  /** Model id override; undefined means the client's task default. */
  model: (config: LlmConfig) => string | undefined;
  fallback: "contributor" | "none";
}

const MODEL_CONFIGS: EvalModelConfig[] = [
  {
    key: "contributor",
    provider: "meta",
    model: (config) => config.models.sparkContributor,
    fallback: "contributor",
  },
  {
    key: "spark",
    provider: "meta",
    model: (config) => config.models.spark,
    fallback: "contributor",
  },
  {
    key: "baseten",
    provider: "baseten",
    model: () => undefined,
    fallback: "none",
  },
];

function usage(): void {
  console.log(
    "seatpop eval: score voted enrichment on the golden set, three models.\n" +
      "usage: npm run eval --workspace @seatpop/worker [-- --limit N]\n" +
      "  --limit N    score at most N golden events (cheapest smoke pass).",
  );
}

function valueOf(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }
  loadDotenv();
  const limitRaw = valueOf(args, "--limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (
    limitRaw !== undefined &&
    (!Number.isInteger(limit) || (limit as number) <= 0)
  ) {
    console.error("--limit needs a positive integer");
    return 2;
  }
  const goldenPath = goldenEventsPath();
  if (!existsSync(goldenPath)) {
    console.error(
      `no golden set at ${goldenPath}; run eval:export, label every row, then eval:import`,
    );
    return 2;
  }
  let goldens;
  try {
    goldens = parseGoldenJsonl(readFileSync(goldenPath, "utf8"));
  } catch (error) {
    console.error(
      `eval: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
  if (goldens.length === 0) {
    console.error(`eval: golden set at ${goldenPath} is empty; nothing to score`);
    return 2;
  }
  const queue =
    limit === undefined ? goldens : goldens.slice(0, limit as number);
  // Same $5/run cap as enrichment: 60 events x 3 models stays under it.
  const config = resolveEnrichConfig();
  const now = new Date();

  const report: EvalReport = {
    generatedAt: now.toISOString(),
    promptVersion: ENRICH_PROMPT_VERSION,
    goldenPath: "worker/eval/golden/events.jsonl",
    goldenEvents: queue.length,
    models: [],
    excluded: queue
      .filter((golden) => golden.excluded)
      .map((golden) => ({
        event_id: golden.event_id,
        reason: golden.exclude_reason ?? "(no reason recorded)",
      })),
  };

  for (const modelConfig of MODEL_CONFIGS) {
    const outputs = new Map<string, VoteResult | null>();
    let modelSeen = "";
    for (let i = 0; i < queue.length; i++) {
      const golden = queue[i] as (typeof queue)[number];
      if (golden.excluded) continue;
      let result: VoteResult | null;
      try {
        result = await voteEnrichment(
          {
            id: golden.event_id,
            title: golden.title,
            description: golden.description,
            venueName: golden.venue_name,
          },
          {
            config,
            model: modelConfig.model(config),
            provider: modelConfig.provider,
            fallback:
              modelConfig.fallback === "none" ? "none" : undefined,
            now,
          },
        );
      } catch (error) {
        if (error instanceof BudgetExceeded) {
          console.error(
            `eval stopped: budget reached (${error.message}); writing no report (partial scores would mislead the gate)`,
          );
          return 1;
        }
        throw error;
      }
      if (result && modelSeen === "") modelSeen = result.model;
      outputs.set(golden.event_id, result);
      if ((i + 1) % 10 === 0 || i + 1 === queue.length) {
        console.log(
          `eval progress: ${modelConfig.key} ${i + 1}/${queue.length}`,
        );
      }
    }
    const score = scoreModel(queue, outputs);
    report.models.push(
      modelReportFor(
        modelConfig.key,
        modelConfig.provider,
        modelSeen === "" ? "(no successful calls)" : modelSeen,
        score,
      ),
    );
    console.log(
      `eval: ${modelConfig.key}: scored=${score.eventsScored} ` +
        `failed=${score.eventsFailed} false_free=${score.falseFree} ` +
        `wrong_price=${score.wrongPrice} cost_usd=${score.costUsd.toFixed(4)}`,
    );
  }

  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdownReport(report);
  const reportPath = evalReportPath();
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, json, "utf8");
  const docsPath = docsReportPath();
  mkdirSync(path.dirname(docsPath), { recursive: true });
  writeFileSync(docsPath, markdown, "utf8");
  const webPath = webReportPath();
  mkdirSync(path.dirname(webPath), { recursive: true });
  writeFileSync(webPath, json, "utf8");
  console.log(`eval: wrote ${reportPath}`);
  console.log(`eval: wrote ${docsPath}`);
  console.log(`eval: wrote ${webPath}`);
  return 0;
}

if (isDirectExecution(import.meta.url)) {
  const exitCode = await main().catch((error: unknown) => {
    console.error(
      `eval failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  });
  process.exit(exitCode);
}
