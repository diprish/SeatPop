import { tmpdir } from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";
import { resolveConfig, type LlmConfig } from "@seatpop/llm";
import { RateLimiter, TtlCache } from "@seatpop/worker/recommend";

/**
 * Shared server plumbing for the recommend API routes (web-only).
 * LLM cache/ledger default to the OS temp dir (serverless filesystems
 * are read-only outside it; explicit LLM_* env vars still win).
 */

export function serverLlmConfig(): LlmConfig {
  return resolveConfig(process.env, {
    cacheDir:
      process.env["LLM_CACHE_DIR"] ?? path.join(tmpdir(), "seatpop-llm-cache"),
    ledgerPath:
      process.env["LLM_LEDGER_PATH"] ??
      path.join(tmpdir(), "seatpop-ledger", "llm-calls.jsonl"),
  });
}

export function publicSupabase(): { url: string; anonKey: string } | null {
  const url = process.env["SUPABASE_URL"]?.trim();
  const anonKey = process.env["SUPABASE_ANON_KEY"]?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first !== "" ? first : "unknown";
}

function dailyCap(): number {
  const raw = Number(process.env["RECOMMEND_MAX_PER_IP_PER_DAY"] ?? "100");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
}

/** Per-route limiter instance (module scope = one per server process). */
export function routeLimiter(): RateLimiter {
  return new RateLimiter({ maxPerDay: dailyCap() });
}

/** Guest recommendation cache: 5 minutes, 200 entries, per process. */
export const recommendCache = new TtlCache<unknown>({
  ttlMs: 5 * 60_000,
  maxEntries: 200,
});

export function bearerJwt(request: NextRequest): string | undefined {
  const header = request.headers.get("authorization");
  const match = /^Bearer (.+)$/i.exec(header?.trim() ?? "");
  return match?.[1];
}
