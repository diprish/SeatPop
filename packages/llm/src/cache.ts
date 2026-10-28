import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";

/** Deterministic JSON with sorted keys so equal requests hash equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}}`;
}

/** Content hash of the canonical request payload. */
export function cacheKey(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function cachePath(cacheDir: string, key: string): string {
  return path.join(cacheDir, `${key}.json`);
}

/**
 * Read a cached response. Returns null on a miss, unreadable file or
 * schema mismatch (a corrupt entry must never break a call).
 */
export function readCache<T>(
  cacheDir: string,
  key: string,
  schema: z.ZodType<T>,
): T | null {
  const file = cachePath(cacheDir, key);
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Persist a successful response. A cache write failure never fails the call. */
export function writeCache(
  cacheDir: string,
  key: string,
  value: unknown,
): void {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath(cacheDir, key), JSON.stringify(value), "utf8");
  } catch (error) {
    console.warn(`llm cache write failed for ${cacheDir}: ${String(error)}`);
  }
}
