import { z } from "zod";
import { SCORED_FIELDS, type ModelScore } from "./score";

/**
 * Eval report I/O for phase 3 (worker/eval).
 *
 * `npm run eval` writes three views of the same report: worker/eval/
 * report.json (source of truth, committed), docs/eval-report.md (human
 * tables), and apps/web/public/eval-report.json (the copy the web app
 * renders). `npm run eval:check` (a CI step) fails the build when any
 * recorded run shows false-free > 0 or wrong-price > 0.
 */

export const EvalModelKeySchema = z.enum(["contributor", "spark", "baseten"]);
export type EvalModelKey = z.infer<typeof EvalModelKeySchema>;

const FieldScoreSchema = z.object({
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  modelNulls: z.number().int().nonnegative(),
  nullRate: z.number().min(0).max(1),
});

const fieldRecord = z.object({
  age_min: FieldScoreSchema,
  age_max: FieldScoreSchema,
  price_kind: FieldScoreSchema,
  amount: FieldScoreSchema,
  setting: FieldScoreSchema,
  language: FieldScoreSchema,
  registration_hint: FieldScoreSchema,
  accessibility: FieldScoreSchema,
});

export const EvalModelReportSchema = z.object({
  key: EvalModelKeySchema,
  provider: z.enum(["meta", "baseten"]),
  model: z.string().min(1),
  eventsScored: z.number().int().nonnegative(),
  eventsFailed: z.number().int().nonnegative(),
  fields: fieldRecord,
  falseFree: z.number().int().nonnegative(),
  wrongPrice: z.number().int().nonnegative(),
  hallucinatedFields: z.number().int().nonnegative(),
  tokens: z.object({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
    reasoning: z.number().int().nonnegative(),
    livePasses: z.number().int().nonnegative(),
    cachedPasses: z.number().int().nonnegative(),
  }),
  costUsd: z.number().nonnegative(),
  costPer1kUsd: z.number().nonnegative(),
});
export type EvalModelReport = z.infer<typeof EvalModelReportSchema>;

export const EvalReportSchema = z.object({
  generatedAt: z.string().datetime(),
  promptVersion: z.string().min(1),
  goldenPath: z.string().min(1),
  goldenEvents: z.number().int().nonnegative(),
  models: z.array(EvalModelReportSchema),
});
export type EvalReport = z.infer<typeof EvalReportSchema>;

export function modelReportFor(
  key: EvalModelKey,
  provider: "meta" | "baseten",
  model: string,
  score: ModelScore,
): EvalModelReport {
  return {
    key,
    provider,
    model,
    eventsScored: score.eventsScored,
    eventsFailed: score.eventsFailed,
    fields: { ...score.fields },
    falseFree: score.falseFree,
    wrongPrice: score.wrongPrice,
    hallucinatedFields: score.hallucinatedFields,
    tokens: { ...score.tokens },
    costUsd: score.costUsd,
    costPer1kUsd: score.costPer1kUsd,
  };
}

export interface GateOffender {
  key: EvalModelKey;
  falseFree: number;
  wrongPrice: number;
}

/**
 * The CI quality gate: any recorded model run with a false "free" or a
 * wrong price fails the build. Price errors are the eval's load-bearing
 * metric (CONTEXT rule 2: never state "free" or a price without signal).
 */
export function checkReportGate(report: EvalReport): {
  ok: boolean;
  offenders: GateOffender[];
} {
  const offenders: GateOffender[] = [];
  for (const model of report.models) {
    if (model.falseFree > 0 || model.wrongPrice > 0) {
      offenders.push({
        key: model.key,
        falseFree: model.falseFree,
        wrongPrice: model.wrongPrice,
      });
    }
  }
  return { ok: offenders.length === 0, offenders };
}

const MODEL_TITLES: Record<EvalModelKey, string> = {
  contributor: "Muse Spark 1.3 contributor (Meta API)",
  spark: "Muse Spark 1.3 (Meta API)",
  baseten: "Muse Spark Open (Baseten)",
};

const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

/** Render the Markdown report: one accuracy table per model. */
export function renderMarkdownReport(report: EvalReport): string {
  const lines: string[] = [
    "# Enrichment eval report",
    "",
    `Generated ${report.generatedAt} · prompt ${report.promptVersion} · ` +
      `golden ${report.goldenPath} (${report.goldenEvents} events).`,
    "",
    "Accuracy is exact-match per field against human labels (label only",
    "what the text says; blank means the text does not say). Cost is",
    "live spend only — cached passes cost $0 but keep their stored token",
    "counts. Events with no usable model pass are excluded from every",
    "denominator and counted as failed.",
    "",
  ];
  for (const model of report.models) {
    lines.push(`## ${MODEL_TITLES[model.key]}`);
    lines.push("");
    lines.push(
      `Model \`${model.model}\` · scored ${model.eventsScored}` +
        ` · failed ${model.eventsFailed}.`,
    );
    lines.push("");
    lines.push("| field | accuracy | null rate |");
    lines.push("| --- | --- | --- |");
    for (const field of SCORED_FIELDS) {
      const score = model.fields[field];
      lines.push(
        `| ${field} | ${pct(score.accuracy)} (${score.correct}/${score.total}) | ${pct(score.nullRate)} |`,
      );
    }
    lines.push("");
    lines.push(`- false-"free": ${model.falseFree}`);
    lines.push(`- wrong-price: ${model.wrongPrice}`);
    lines.push(`- hallucinated fields: ${model.hallucinatedFields}`);
    lines.push(
      `- tokens: in ${model.tokens.prompt}, out ${model.tokens.completion}, ` +
        `reasoning ${model.tokens.reasoning} ` +
        `(live passes ${model.tokens.livePasses}, cached ${model.tokens.cachedPasses})`,
    );
    lines.push(
      `- cost: $${model.costUsd.toFixed(4)} total, ` +
        `$${model.costPer1kUsd.toFixed(2)} per 1,000 events`,
    );
    lines.push("");
  }
  return lines.join("\n");
}
