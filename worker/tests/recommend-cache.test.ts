import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/recommend/cache";
import { RateLimiter } from "../src/recommend/rate-limit";

describe("ttl cache", () => {
  it("serves entries until they expire", () => {
    let now = 1_000_000;
    const cache = new TtlCache<string>({
      ttlMs: 60_000,
      maxEntries: 10,
      now: () => now,
    });
    expect(cache.get("a")).toBeUndefined();
    cache.set("a", "value");
    expect(cache.get("a")).toBe("value");
    expect(cache.size).toBe(1);
    now += 59_999;
    expect(cache.get("a")).toBe("value");
    now += 1;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the oldest entry past capacity", () => {
    const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 2 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });
});

describe("rate limiter", () => {
  it("allows up to the daily cap per key, then denies", () => {
    let now = Date.UTC(2026, 5, 1, 12, 0, 0);
    const limiter = new RateLimiter({ maxPerDay: 2, now: () => now });
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: false, remaining: 0 });
    expect(limiter.check("5.6.7.8")).toEqual({ allowed: true, remaining: 1 });
    // Next UTC day resets every key.
    now += 24 * 3_600_000;
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true, remaining: 1 });
  });
});
