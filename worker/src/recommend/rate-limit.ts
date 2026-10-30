/**
 * Demo-grade per-key daily rate limiter for live web paths
 * (worker/recommend). CONTEXT rule 11 needs per-IP + global daily caps:
 * this is the per-IP half (the route keys by client IP); global spend
 * stays guarded by the LLM budgets. Counts reset on UTC-day rollover.
 * Pure apart from the injected clock.
 */

export interface RateLimiterOptions {
  maxPerDay: number;
  now?: () => number;
}

interface Bucket {
  day: string;
  count: number;
}

export class RateLimiter {
  private readonly maxPerDay: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions) {
    this.maxPerDay = options.maxPerDay;
    this.now = options.now ?? Date.now;
  }

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  /**
   * Record one attempt for key. Returns whether it is allowed plus the
   * remaining quota (0 when denied). Denied attempts do not consume
   * quota beyond the cap.
   */
  check(key: string): { allowed: boolean; remaining: number } {
    const day = this.today();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.day !== day) {
      this.buckets.set(key, { day, count: 1 });
      return { allowed: true, remaining: this.maxPerDay - 1 };
    }
    if (bucket.count >= this.maxPerDay) {
      return { allowed: false, remaining: 0 };
    }
    bucket.count++;
    return { allowed: true, remaining: this.maxPerDay - bucket.count };
  }
}
