import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReasoningEffort, TaskKind } from "./types";

export const DEFAULT_API_BASE = "https://api.meta.ai/v1";

/** Floor for max_tokens on every task: Spark spends part of it on reasoning. */
export const MIN_MAX_TOKENS = 512;

export interface ModelIds {
  spark: string;
  sparkContributor: string;
  wonder: string;
  image: string;
  voice: string;
}

export const DEFAULT_MODELS: ModelIds = {
  spark: "muse-spark-1.3",
  sparkContributor: "muse-spark-1.3-contributor",
  wonder: "muse-wonder-1.0",
  image: "muse-image-1.0",
  voice: "muse-voice-transcribe-1.0",
};

/** USD per 1M tokens, from https://dev.meta.ai/docs/pricing-rate-limits. */
export interface ModelPrice {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}

export const PRICE_TABLE: Record<string, ModelPrice> = {
  "muse-wonder-1.0": { inputPer1M: 4.0, cachedInputPer1M: 0.2, outputPer1M: 20.0 },
  "muse-spark-1.3": { inputPer1M: 1.25, cachedInputPer1M: 0.15, outputPer1M: 4.25 },
  "muse-spark-1.2": { inputPer1M: 1.25, cachedInputPer1M: 0.15, outputPer1M: 4.25 },
  "muse-spark-1.1": { inputPer1M: 1.25, cachedInputPer1M: 0.15, outputPer1M: 4.25 },
  "muse-spark-1.3-contributor": {
    inputPer1M: 0.1,
    cachedInputPer1M: 0.002,
    outputPer1M: 0.2,
  },
  "muse-spark-1.2-contributor": {
    inputPer1M: 0.1,
    cachedInputPer1M: 0.002,
    outputPer1M: 0.2,
  },
};

const FALLBACK_SPARK_STANDARD: ModelPrice = {
  inputPer1M: 1.25,
  cachedInputPer1M: 0.15,
  outputPer1M: 4.25,
};

/** Price lookup by model id, with family fallback for ids added later. */
export function priceFor(model: string): ModelPrice {
  const exact = PRICE_TABLE[model];
  if (exact) return exact;
  if (model.includes("contributor")) {
    return PRICE_TABLE["muse-spark-1.3-contributor"] ?? FALLBACK_SPARK_STANDARD;
  }
  if (model.includes("wonder")) {
    return PRICE_TABLE["muse-wonder-1.0"] ?? FALLBACK_SPARK_STANDARD;
  }
  return FALLBACK_SPARK_STANDARD;
}

/**
 * Reasoning effort per task. Lowest usable level (`minimal`) by default;
 * higher only for the plan agent and the Wonder judge.
 * See https://dev.meta.ai/docs/reasoning
 */
export const TASK_REASONING: Record<TaskKind, ReasoningEffort> = {
  extraction: "minimal",
  classification: "minimal",
  parsing: "minimal",
  listing_extraction: "minimal",
  plan: "high",
  judge: "max",
  smoke: "minimal",
  custom: "minimal",
};

/**
 * Model per task. Only listing_extraction (public event text, never household
 * or email content) uses the contributor model; everything else that touches
 * potentially sensitive input uses standard models.
 */
export function modelForTask(
  task: TaskKind,
  models: ModelIds = DEFAULT_MODELS,
): string {
  switch (task) {
    case "listing_extraction":
      return models.sparkContributor;
    case "judge":
      return models.wonder;
    case "extraction":
    case "classification":
    case "parsing":
    case "plan":
    case "smoke":
    case "custom":
      return models.spark;
  }
}

export interface BudgetLimits {
  total?: number;
  perRun?: number;
  dailyLive?: number;
}

/** Default budget limits in USD when the LLM_MAX_USD_* vars are unset. */
export const DEFAULT_BUDGETS: Required<BudgetLimits> = {
  total: 135,
  perRun: 10,
  dailyLive: 5,
};

/** Default USD held against budgets while one call is in flight. */
export const DEFAULT_RESERVE_USD_PER_CALL = 0.05;

export interface LlmConfig {
  apiBase: string;
  apiKey: string | undefined;
  models: ModelIds;
  timeoutMs: number;
  retryDelayMs: number;
  cacheDir: string;
  ledgerPath: string;
  runId: string;
  budgets: BudgetLimits;
  /** Estimated cost reserved against budgets for the duration of one call. */
  reserveUsdPerCall: number;
  supabaseUrl: string | undefined;
  supabaseServiceKey: string | undefined;
}

const PROCESS_RUN_ID = randomUUID();

function nonEmpty(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === "" || trimmed === undefined ? undefined : trimmed;
}

function parsePositiveNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = parsePositiveNumber(raw);
  if (value === undefined) return fallback;
  return Math.floor(value);
}

function parseDotenvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  let text: string;
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Minimal .env loader: fills unset vars only, never overwrites real env.
 * Searches upward from cwd to the repo root (nearest .env wins).
 * Values are never logged or printed.
 */
export function loadDotenv(cwd: string = process.cwd()): void {
  // Nearest first so deeper files take precedence under fill-unset semantics.
  const dirs: string[] = [];
  let dir = path.resolve(cwd);
  for (;;) {
    dirs.push(dir);
    if (existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of dirs) {
    parseDotenvFile(path.join(d, ".env"));
  }
}

export type ConfigOverrides = Omit<Partial<LlmConfig>, "models" | "budgets"> & {
  models?: Partial<ModelIds>;
  budgets?: BudgetLimits;
};

/** Resolve client config from env (with code defaults), plus optional overrides. */
export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ConfigOverrides = {},
): LlmConfig {
  loadDotenv();
  const models: ModelIds = {
    spark:
      nonEmpty(overrides.models?.spark) ??
      nonEmpty(env["MODEL_SPARK"]) ??
      DEFAULT_MODELS.spark,
    sparkContributor:
      nonEmpty(overrides.models?.sparkContributor) ??
      nonEmpty(env["MODEL_SPARK_CONTRIBUTOR"]) ??
      DEFAULT_MODELS.sparkContributor,
    wonder:
      nonEmpty(overrides.models?.wonder) ??
      nonEmpty(env["MODEL_WONDER"]) ??
      DEFAULT_MODELS.wonder,
    image:
      nonEmpty(overrides.models?.image) ??
      nonEmpty(env["MODEL_IMAGE"]) ??
      DEFAULT_MODELS.image,
    voice:
      nonEmpty(overrides.models?.voice) ??
      nonEmpty(env["MODEL_VOICE"]) ??
      DEFAULT_MODELS.voice,
  };
  const budgets: BudgetLimits = {
    total:
      overrides.budgets?.total ??
      parsePositiveNumber(env["LLM_MAX_USD_TOTAL"]) ??
      DEFAULT_BUDGETS.total,
    perRun:
      overrides.budgets?.perRun ??
      parsePositiveNumber(env["LLM_MAX_USD_PER_RUN"]) ??
      DEFAULT_BUDGETS.perRun,
    dailyLive:
      overrides.budgets?.dailyLive ??
      parsePositiveNumber(env["LLM_MAX_USD_DAILY_LIVE"]) ??
      DEFAULT_BUDGETS.dailyLive,
  };
  return {
    apiBase:
      nonEmpty(overrides.apiBase) ??
      nonEmpty(env["MODEL_API_BASE"]) ??
      DEFAULT_API_BASE,
    apiKey: nonEmpty(overrides.apiKey) ?? nonEmpty(env["MODEL_API_KEY"]),
    models,
    timeoutMs:
      overrides.timeoutMs ?? parsePositiveInt(env["LLM_TIMEOUT_MS"], 60_000),
    retryDelayMs:
      overrides.retryDelayMs ??
      parsePositiveInt(env["LLM_RETRY_DELAY_MS"], 500),
    cacheDir:
      nonEmpty(overrides.cacheDir) ??
      nonEmpty(env["LLM_CACHE_DIR"]) ??
      ".llm-cache",
    ledgerPath:
      nonEmpty(overrides.ledgerPath) ??
      nonEmpty(env["LLM_LEDGER_PATH"]) ??
      ".llm-ledger/llm-calls.jsonl",
    runId:
      nonEmpty(overrides.runId) ??
      nonEmpty(env["LLM_RUN_ID"]) ??
      PROCESS_RUN_ID,
    budgets,
    reserveUsdPerCall:
      overrides.reserveUsdPerCall ??
      parsePositiveNumber(env["LLM_RESERVE_USD_PER_CALL"]) ??
      DEFAULT_RESERVE_USD_PER_CALL,
    supabaseUrl:
      nonEmpty(overrides.supabaseUrl) ?? nonEmpty(env["SUPABASE_URL"]),
    supabaseServiceKey:
      nonEmpty(overrides.supabaseServiceKey) ??
      nonEmpty(env["SUPABASE_SERVICE_ROLE_KEY"]),
  };
}
