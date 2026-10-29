import {
  assertWithinBudget,
  releaseInflight,
  reserveInflight,
} from "./budget";
import { cacheKey, readCache, writeCache } from "./cache";
import {
  BASETEN_API_BASE,
  BASETEN_MODEL,
  MIN_MAX_TOKENS,
  PUBLIC_TEXT_TASKS,
  TASK_REASONING,
  modelForTask,
  priceFor,
  resolveConfig,
  type LlmConfig,
} from "./config";
import { appendLedgerRow, mirrorToSupabase } from "./ledger";
import {
  BudgetExceeded,
  ChatCompletionResponseSchema,
  type ChatCompletionResponse,
  type ChatMessage,
  type ChatResult,
  type ChatSuccess,
  type LedgerRow,
  type LlmError,
  type LlmProvider,
  type ReasoningEffort,
  type TaskKind,
  type TokenUsage,
} from "./types";

export interface ChatRequest {
  task: TaskKind;
  messages: ChatMessage[];
  model?: string;
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
  temperature?: number;
  /** Model provider (default "meta"). Baseten is public-text tasks only. */
  provider?: LlmProvider;
}

export interface ChatOptions {
  fetchImpl?: typeof fetch;
  config?: LlmConfig;
  retryDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/** HTTP statuses worth one retry with backoff. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function usageOf(response: ChatCompletionResponse): TokenUsage {
  return {
    promptTokens: response.usage.prompt_tokens,
    completionTokens: response.usage.completion_tokens,
    cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? 0,
    reasoningTokens:
      response.usage.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

/**
 * USD estimate from the config price table. completion_tokens already include
 * reasoning tokens (per the Reasoning docs), so reasoning counts as output
 * tokens with no extra term and no double-counting.
 */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = priceFor(model);
  const uncachedIn = Math.max(0, usage.promptTokens - usage.cachedTokens);
  return (
    (uncachedIn * price.inputPer1M +
      usage.cachedTokens * price.cachedInputPer1M +
      usage.completionTokens * price.outputPer1M) /
    1_000_000
  );
}

async function postChat(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function successOf(data: ChatCompletionResponse, cached: boolean): ChatSuccess {
  const usage = usageOf(data);
  // content only: a provider's reasoning_content (Baseten) is parsed by
  // the schema but never mixed into the answer.
  return {
    content: data.choices[0].message.content ?? "",
    model: data.model,
    finishReason: data.choices[0].finish_reason,
    usage,
    costUsd: cached ? 0 : estimateCostUsd(data.model, usage),
    cached,
  };
}

type LedgerFields = Pick<
  LedgerRow,
  | "tokens_in"
  | "tokens_cached"
  | "tokens_out"
  | "reasoning_tokens"
  | "est_cost_usd"
  | "cached"
  | "outcome"
  | "error_kind"
>;

/**
 * One chat completion (fetch only). The default provider is Baseten for
 * listing_extraction (public text, never household or email content) and
 * Meta otherwise; an explicit request.provider always wins.
 *
 * Baseten failures fall back to the contributor model automatically: any
 * Baseten error, or a reached Baseten cap, retries once on Meta. Gate
 * refusals (non-public tasks) never fall back. Both attempts write ledger
 * rows, so each row's provider+model show what produced it.
 */
export async function chat(
  request: ChatRequest,
  options: ChatOptions = {},
): Promise<ChatResult> {
  const provider: LlmProvider =
    request.provider ??
    (request.task === "listing_extraction" ? "baseten" : "meta");
  if (provider === "meta") {
    return chatWithProvider(request, options, "meta");
  }
  try {
    const result = await chatWithProvider(request, options, "baseten");
    if (result.ok || result.error.kind === "refused") return result;
    warnFallback(`baseten ${result.error.kind}, falling back to contributor`);
    return chatWithProvider(request, options, "meta");
  } catch (error) {
    if (error instanceof BudgetExceeded && error.limit === "baseten_total") {
      warnFallback("baseten cap reached, falling back to contributor");
      return chatWithProvider(request, options, "meta");
    }
    throw error;
  }
}

let warnedConfigFallback = false;

/**
 * Fallback warnings: errors warn every occurrence (rare); config issues
 * (a missing Baseten key fails every call) warn once per process.
 */
function warnFallback(message: string): void {
  if (message.startsWith("baseten config")) {
    if (warnedConfigFallback) return;
    warnedConfigFallback = true;
  }
  console.warn(`llm ${message}`);
}

/**
 * One provider attempt: provider gate -> disk cache (a hit makes zero
 * network calls) -> budget guard -> in-flight cost reservation -> network
 * with one backoff retry for transient failures. A null content with
 * finish_reason "length" is a failed call: logged, recorded as a
 * "length_retry" ledger row with the attempt's real usage, retried once
 * with a doubled limit, then returned as a typed error.
 *
 * Every attempt appends at least one ledger row (local JSONL always,
 * Supabase mirror when configured). Returns a typed error for call
 * failures; throws BudgetExceeded only, when a spend limit is reached.
 */
async function chatWithProvider(
  request: ChatRequest,
  options: ChatOptions,
  provider: LlmProvider,
): Promise<ChatResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = options.config ?? resolveConfig();
  const retryDelayMs = options.retryDelayMs ?? config.retryDelayMs;
  const started = Date.now();

  const model =
    request.model ??
    (provider === "baseten"
      ? BASETEN_MODEL
      : modelForTask(request.task, config.models));
  const effort = request.reasoningEffort ?? TASK_REASONING[request.task];
  const floorMaxTokens = Math.max(
    request.maxTokens ?? MIN_MAX_TOKENS,
    MIN_MAX_TOKENS,
  );
  const basePayload = {
    model,
    messages: request.messages,
    reasoning_effort: effort,
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
  };

  const writeRow = async (fields: LedgerFields): Promise<void> => {
    const row: LedgerRow = {
      ts: new Date().toISOString(),
      run_id: config.runId,
      task: request.task,
      provider,
      model,
      latency_ms: Math.max(0, Date.now() - started),
      ...fields,
    };
    appendLedgerRow(config.ledgerPath, row);
    await mirrorToSupabase(config, row, fetchImpl);
  };

  const finish = async (
    fields: LedgerFields,
    result: ChatResult,
  ): Promise<ChatResult> => {
    await writeRow(fields);
    return result;
  };

  const fail = (error: LlmError, usage?: TokenUsage): Promise<ChatResult> =>
    finish(
      {
        tokens_in: usage?.promptTokens ?? 0,
        tokens_cached: usage?.cachedTokens ?? 0,
        tokens_out: usage?.completionTokens ?? 0,
        reasoning_tokens: usage?.reasoningTokens ?? 0,
        est_cost_usd: usage ? estimateCostUsd(model, usage) : 0,
        cached: false,
        outcome: "error",
        error_kind: error.kind,
      },
      { ok: false, error },
    );

  // 0. Provider gate: Baseten is public-text tasks only, refused in
  // code before cache, budget, or network see the request. Refusals never
  // fall back (kind "refused", not an error worth retrying elsewhere).
  if (provider === "baseten" && !PUBLIC_TEXT_TASKS.has(request.task)) {
    return fail({
      kind: "refused",
      message: `provider "baseten" refused for task "${request.task}": household or email content must not leave Meta hosting`,
    });
  }

  // 1. Content-hash cache: a hit returns with zero network calls.
  // The provider is part of the key: identical messages on two providers
  // are different calls.
  const cachePayload = { provider, ...basePayload, max_tokens: floorMaxTokens };
  const hit = readCache(
    config.cacheDir,
    cacheKey(cachePayload),
    ChatCompletionResponseSchema,
  );
  if (hit) {
    const value = successOf(hit, true);
    return finish(
      {
        tokens_in: 0,
        tokens_cached: 0,
        tokens_out: 0,
        reasoning_tokens: 0,
        est_cost_usd: 0,
        cached: true,
        outcome: "ok",
        error_kind: undefined,
      },
      { ok: true, value },
    );
  }

  // 2. Budget guard (cache misses only; throws BudgetExceeded).
  assertWithinBudget(config, provider);

  // 3. Key check.
  const apiKey =
    provider === "baseten" ? config.basetenApiKey : config.apiKey;
  if (!apiKey) {
    return fail({
      kind: "config",
      message:
        provider === "baseten"
          ? "BASETEN_API_KEY is not set"
          : "MODEL_API_KEY is not set",
    });
  }

  // 4. Network attempts: one backoff retry for transient failures, one
  // doubled-limit retry for length failures. An estimated cost is reserved
  // against the budgets for the whole attempt sequence so parallel calls
  // cannot collectively overshoot.
  const base =
    provider === "baseten" ? BASETEN_API_BASE : config.apiBase;
  const url = `${base.replace(/\/$/, "")}/chat/completions`;
  let maxTokens = floorMaxTokens;
  let transientRetried = false;
  let lengthRetried = false;

  const runAttempts = async (): Promise<ChatResult> => {
    for (;;) {
      const payload = { ...basePayload, max_tokens: maxTokens };
      let response: Response;
      try {
        response = await postChat(
          url,
          apiKey,
          payload,
          config.timeoutMs,
          fetchImpl,
        );
      } catch (error) {
        if (!transientRetried) {
          transientRetried = true;
          await sleep(retryDelayMs);
          continue;
        }
        return isAbort(error)
          ? fail({
              kind: "timeout",
              message: `request timed out after ${config.timeoutMs}ms`,
            })
          : fail({
              kind: "network",
              message: `network error: ${messageOf(error)}`,
            });
      }

      if (isTransientStatus(response.status)) {
        if (!transientRetried) {
          transientRetried = true;
          await sleep(retryDelayMs);
          continue;
        }
        return fail({
          kind: "http",
          status: response.status,
          message: `HTTP ${response.status} after retry`,
        });
      }
      if (!response.ok) {
        return fail({
          kind: "http",
          status: response.status,
          message: `HTTP ${response.status}`,
        });
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return fail({
          kind: "schema",
          status: response.status,
          message: "response was not valid JSON",
        });
      }
      const parsed = ChatCompletionResponseSchema.safeParse(json);
      if (!parsed.success) {
        const details = parsed.error.issues.map((i) => i.message).join("; ");
        return fail({
          kind: "schema",
          status: response.status,
          message: `response failed schema validation: ${details}`,
        });
      }
      const data = parsed.data;
      const choice = data.choices[0];

      if (
        choice.message.content === null &&
        choice.finish_reason === "length"
      ) {
        const usage = usageOf(data);
        console.error(
          `llm length failure: task=${request.task} model=${model} max_tokens=${maxTokens} (content null, finish_reason length)`,
        );
        if (!lengthRetried) {
          lengthRetried = true;
          await writeRow({
            tokens_in: usage.promptTokens,
            tokens_cached: usage.cachedTokens,
            tokens_out: usage.completionTokens,
            reasoning_tokens: usage.reasoningTokens,
            est_cost_usd: estimateCostUsd(model, usage),
            cached: false,
            outcome: "length_retry",
            error_kind: undefined,
          });
          maxTokens = maxTokens * 2;
          continue;
        }
        return fail(
          {
            kind: "length",
            message: `empty content with finish_reason "length" at max_tokens=${maxTokens}`,
          },
          usage,
        );
      }

      writeCache(config.cacheDir, cacheKey({ provider, ...payload }), data);
      const value = successOf(data, false);
      return finish(
        {
          tokens_in: value.usage.promptTokens,
          tokens_cached: value.usage.cachedTokens,
          tokens_out: value.usage.completionTokens,
          reasoning_tokens: value.usage.reasoningTokens,
          est_cost_usd: value.costUsd,
          cached: false,
          outcome: "ok",
          error_kind: undefined,
        },
        { ok: true, value },
      );
    }
  };

  reserveInflight(config.ledgerPath, config.reserveUsdPerCall);
  try {
    const result = await runAttempts();
    return result;
  } finally {
    releaseInflight(config.ledgerPath, config.reserveUsdPerCall);
  }
}
