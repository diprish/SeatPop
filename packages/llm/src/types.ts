import { z } from "zod";

/** Task kinds the client knows. Each maps to a model and a reasoning effort in config. */
export type TaskKind =
  | "extraction"
  | "classification"
  | "parsing"
  | "listing_extraction"
  | "plan"
  | "judge"
  | "smoke"
  | "custom";

/** Model providers the client can route to. */
export type LlmProvider = "meta" | "baseten";

/** Reasoning depths from https://dev.meta.ai/docs/reasoning (`none` 400s on Spark/Wonder). */
export type ReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** OpenAI-compatible chat completion response (unknown fields are stripped). */
export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.string(),
          content: z.string().nullable(),
          // Baseten reasoning models answer here AND in content; the
          // client reads content only and never mixes the two.
          reasoning_content: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable(),
      }),
    )
    .min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    prompt_tokens_details: z
      .object({ cached_tokens: z.number().int().nonnegative().optional() })
      .optional(),
    completion_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative().optional() })
      .optional(),
  }),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

/** One row of the cost ledger: one row per chat() call, cached or live, ok or error. */
export const LedgerRowSchema = z.object({
  ts: z.string().datetime(),
  run_id: z.string().min(1),
  task: z.string().min(1),
  provider: z.enum(["meta", "baseten"]),
  model: z.string().min(1),
  tokens_in: z.number().int().nonnegative(),
  tokens_cached: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  reasoning_tokens: z.number().int().nonnegative(),
  est_cost_usd: z.number().nonnegative(),
  cached: z.boolean(),
  outcome: z.enum(["ok", "error", "length_retry"]),
  error_kind: z.string().optional(),
  latency_ms: z.number().int().nonnegative(),
});
export type LedgerRow = z.infer<typeof LedgerRowSchema>;

export type LlmErrorKind =
  | "config"
  | "http"
  | "timeout"
  | "network"
  | "schema"
  | "length";

export interface LlmError {
  kind: LlmErrorKind;
  message: string;
  /** HTTP status when the failure came from an HTTP response. */
  status?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

export interface ChatSuccess {
  content: string;
  model: string;
  finishReason: string | null;
  usage: TokenUsage;
  /** USD estimate from the config price table (0 when served from cache). */
  costUsd: number;
  cached: boolean;
}

export type ChatResult =
  | { ok: true; value: ChatSuccess }
  | { ok: false; error: LlmError };

export type BudgetLimit = "total" | "per_run" | "daily_live" | "baseten_total";

/** Thrown when a spend limit from the environment is reached. Totals come from the ledger. */
export class BudgetExceeded extends Error {
  readonly limit: BudgetLimit;
  readonly current: number;
  readonly max: number;

  constructor(limit: BudgetLimit, current: number, max: number) {
    super(
      `LLM budget exceeded (${limit}): spent $${current.toFixed(4)} of $${max.toFixed(4)} limit`,
    );
    this.name = "BudgetExceeded";
    this.limit = limit;
    this.current = current;
    this.max = max;
  }
}
