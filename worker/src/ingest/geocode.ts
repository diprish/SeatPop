import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { userAgent } from "./fetcher";

/** Nominatim usage policy: at most 1 request per second. */
export const NOMINATIM_MIN_DELAY_MS = 1000;

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** 0–1: Nominatim importance, or 1 for file overrides. */
  confidence: number;
}

export interface GeocodeCache {
  get(address: string): GeocodeResult | undefined;
  set(address: string, result: GeocodeResult): void;
}

export function memoryGeocodeCache(): GeocodeCache {
  const map = new Map<string, GeocodeResult>();
  return {
    get: (address) => map.get(address),
    set: (address, result) => {
      map.set(address, result);
    },
  };
}

/** File-backed cache (JSON object). Best-effort: failures are swallowed. */
export function fileGeocodeCache(filePath: string): GeocodeCache {
  const load = (): Record<string, GeocodeResult> => {
    try {
      if (!existsSync(filePath)) return {};
      return JSON.parse(readFileSync(filePath, "utf8")) as Record<
        string,
        GeocodeResult
      >;
    } catch {
      return {};
    }
  };
  const save = (data: Record<string, GeocodeResult>): void => {
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(data), "utf8");
    } catch {
      // Best-effort only.
    }
  };
  return {
    get: (address) => load()[address],
    set: (address, result) => {
      const data = load();
      data[address] = result;
      save(data);
    },
  };
}

const OverridesSchema = z.record(
  z.string(),
  z.object({ lat: z.number(), lng: z.number() }),
);

/**
 * Load address overrides ({address: {lat, lng}}). Keys starting with "_"
 * are comments and ignored. A missing file means no overrides.
 */
export function loadOverrides(
  filePath: string,
): Record<string, { lat: number; lng: number }> {
  try {
    if (!existsSync(filePath)) return {};
    const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      ([key]) => !key.startsWith("_"),
    );
    const parsed = OverridesSchema.safeParse(Object.fromEntries(entries));
    if (!parsed.success) return {};
    return parsed.data;
  } catch {
    return {};
  }
}

const NominatimResponseSchema = z.array(
  z.object({
    lat: z.string(),
    lon: z.string(),
    importance: z.number().optional(),
  }),
);

export interface GeocoderOptions {
  fetchImpl?: typeof fetch;
  contactUrl: string;
  cache?: GeocodeCache;
  overrides?: Record<string, { lat: number; lng: number }>;
  minDelayMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Nominatim geocoder: file overrides first (confidence 1), then cache, then
 * one throttled network lookup per address. Misses and errors resolve to
 * null (with a warning) rather than throwing, so one bad address cannot
 * stop ingestion.
 */
export class Geocoder {
  private readonly fetchImpl: typeof fetch;
  private readonly agent: string;
  private readonly cache: GeocodeCache;
  private readonly overrides: Record<string, { lat: number; lng: number }>;
  private readonly minDelayMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastFetchAt: number | undefined;

  constructor(options: GeocoderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.agent = userAgent(options.contactUrl);
    this.cache = options.cache ?? memoryGeocodeCache();
    this.overrides = options.overrides ?? {};
    this.minDelayMs = options.minDelayMs ?? NOMINATIM_MIN_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async geocode(query: string): Promise<GeocodeResult | null> {
    const address = query.trim();
    if (address === "") return null;
    const override = this.overrides[address];
    if (override) {
      return { lat: override.lat, lng: override.lng, confidence: 1 };
    }
    const cached = this.cache.get(address);
    if (cached) return cached;
    if (this.lastFetchAt !== undefined) {
      const wait = this.minDelayMs - (this.now() - this.lastFetchAt);
      if (wait > 0) await this.sleep(wait);
    }
    this.lastFetchAt = this.now();
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2` +
      `&q=${encodeURIComponent(address)}&limit=1&countrycodes=ca`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { "User-Agent": this.agent, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn(`geocode failed for ${address}: HTTP ${response.status}`);
        return null;
      }
      const parsed = NominatimResponseSchema.safeParse(
        (await response.json()) as unknown,
      );
      const first = parsed.success ? parsed.data[0] : undefined;
      if (!first) return null;
      const result: GeocodeResult = {
        lat: Number(first.lat),
        lng: Number(first.lon),
        confidence: first.importance ?? 0.5,
      };
      if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) {
        return null;
      }
      this.cache.set(address, result);
      return result;
    } catch (error) {
      console.warn(
        `geocode failed for ${address}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
