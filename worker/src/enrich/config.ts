import { resolveConfig, type LlmConfig } from "@seatpop/llm";

/** Hard per-run model-spend cap for enrichment (USD). */
export const ENRICH_RUN_BUDGET_USD = 5;

export type EnrichProvider = "contributor" | "spark";

export function resolveEnrichConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlmConfig {
  return resolveConfig(env, { budgets: { perRun: ENRICH_RUN_BUDGET_USD } });
}

/** CLI flag wins, then ENRICH_PROVIDER, then contributor. */
export function resolveProvider(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): EnrichProvider {
  const raw = (flag ?? env["ENRICH_PROVIDER"] ?? "contributor")
    .trim()
    .toLowerCase();
  if (raw === "spark") return "spark";
  if (raw !== "contributor") {
    console.warn(
      `unknown ENRICH_PROVIDER ${JSON.stringify(raw)}; using contributor`,
    );
  }
  return "contributor";
}
