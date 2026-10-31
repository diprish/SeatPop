/**
 * Trust-page parsers: defensive readers for the eval snapshots in
 * public/. Anything missing or misshapen yields null and the page shows
 * "pending" — numbers are never faked or guessed.
 */

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export interface EnrichmentModelSummary {
  key: string;
  model: string;
  provider: string;
  eventsScored: number;
  eventsFailed: number;
  fields: { field: string; accuracy: number | null; nullRate: number | null }[];
  falseFree: number;
  wrongPrice: number;
  hallucinatedFields: number;
  tokensIn: number;
  tokensOut: number;
  costPer1kUsd: number | null;
}

export interface EnrichmentSummary {
  generatedAt: string;
  promptVersion: string;
  goldenEvents: number;
  models: EnrichmentModelSummary[];
}

function parseModel(json: unknown): EnrichmentModelSummary | null {
  const row = obj(json);
  const tokens = obj(row?.["tokens"]);
  const fields = obj(row?.["fields"]);
  const key = str(row?.["key"]);
  const model = str(row?.["model"]);
  const provider = str(row?.["provider"]);
  const eventsScored = num(row?.["eventsScored"]);
  const eventsFailed = num(row?.["eventsFailed"]);
  const falseFree = num(row?.["falseFree"]);
  const wrongPrice = num(row?.["wrongPrice"]);
  const hallucinatedFields = num(row?.["hallucinatedFields"]);
  const tokensIn = tokens ? num(tokens["prompt"]) : null;
  const tokensOut = tokens ? num(tokens["completion"]) : null;
  const costPer1kUsd = num(row?.["costPer1kUsd"]);
  if (
    !key ||
    !model ||
    !provider ||
    eventsScored === null ||
    eventsFailed === null ||
    falseFree === null ||
    wrongPrice === null ||
    hallucinatedFields === null ||
    !fields
  ) {
    return null;
  }
  return {
    key,
    model,
    provider,
    eventsScored,
    eventsFailed,
    fields: Object.entries(fields).map(([field, score]) => {
      const entry = obj(score);
      return {
        field,
        accuracy: entry ? num(entry["accuracy"]) : null,
        nullRate: entry ? num(entry["nullRate"]) : null,
      };
    }),
    falseFree,
    wrongPrice,
    hallucinatedFields,
    tokensIn: tokensIn ?? 0,
    tokensOut: tokensOut ?? 0,
    costPer1kUsd,
  };
}

export function parseEnrichmentReport(json: unknown): EnrichmentSummary | null {
  const root = obj(json);
  const generatedAt = str(root?.["generatedAt"]);
  const promptVersion = str(root?.["promptVersion"]);
  const goldenEvents = num(root?.["goldenEvents"]);
  const models = root?.["models"];
  if (!generatedAt || !promptVersion || goldenEvents === null || !Array.isArray(models)) {
    return null;
  }
  const parsed: EnrichmentModelSummary[] = [];
  for (const model of models) {
    const summary = parseModel(model);
    if (!summary) return null;
    parsed.push(summary);
  }
  return { generatedAt, promptVersion, goldenEvents, models: parsed };
}

export interface RecommendSummary {
  generatedAt: string;
  mode: string;
  grading: string;
  households: number;
  graded: number;
  withCandidates: number;
  violations: number;
  distanceMismatches: number;
  meanNdcgReranked: number | null;
  meanNdcgDate: number | null;
  meanNdcgStage2: number | null;
  policyProbe: { candidates: number; freePerOpl: number; ok: boolean } | null;
}

export function parseRecommendReport(json: unknown): RecommendSummary | null {
  const root = obj(json);
  const generatedAt = str(root?.["generatedAt"]);
  const mode = str(root?.["mode"]);
  const grading = str(root?.["grading"]);
  const households = root?.["households"];
  const totals = obj(root?.["totals"]);
  const probe = obj(root?.["policyProbe"]);
  if (!generatedAt || !mode || !grading || !Array.isArray(households) || !totals) {
    return null;
  }
  const violations = num(totals["violations"]);
  const distanceMismatches = num(totals["distanceMismatches"]);
  if (violations === null || distanceMismatches === null) return null;
  let graded = 0;
  let withCandidates = 0;
  for (const row of households) {
    const entry = obj(row);
    if (!entry || num(entry["candidates"]) === null) return null;
    if (entry["graded"] === true) graded++;
    if ((num(entry["candidates"]) ?? 0) > 0) withCandidates++;
  }
  let policyProbe: RecommendSummary["policyProbe"] = null;
  if (probe) {
    const candidates = num(probe["candidates"]);
    const freePerOpl = num(probe["freePerOpl"]);
    if (candidates === null || freePerOpl === null || typeof probe["ok"] !== "boolean") {
      return null;
    }
    policyProbe = { candidates, freePerOpl, ok: probe["ok"] };
  }
  return {
    generatedAt,
    mode,
    grading,
    households: households.length,
    graded,
    withCandidates,
    violations,
    distanceMismatches,
    meanNdcgReranked: num(totals["meanNdcgReranked"]),
    meanNdcgDate: num(totals["meanNdcgDate"]),
    meanNdcgStage2: num(totals["meanNdcgStage2"]),
    policyProbe,
  };
}

export interface FallbackSummary {
  generatedAt: string;
  households: number;
  orderKept: boolean;
  allTemplated: boolean;
}

export function parseFallbackReport(json: unknown): FallbackSummary | null {
  const root = obj(json);
  const generatedAt = str(root?.["generatedAt"]);
  const proof = obj(root?.["fallbackProof"]);
  const households = proof ? num(proof["households"]) : null;
  if (!generatedAt || !proof || households === null) return null;
  if (typeof proof["orderKept"] !== "boolean" || typeof proof["allTemplated"] !== "boolean") {
    return null;
  }
  return {
    generatedAt,
    households,
    orderKept: proof["orderKept"],
    allTemplated: proof["allTemplated"],
  };
}
