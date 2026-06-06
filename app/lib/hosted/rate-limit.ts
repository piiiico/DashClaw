interface RateLimiterOptions {
  max: number;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

type TakeResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number };

export interface RateLimiter {
  take(ip: string | null | undefined): TakeResult;
}

export function createRateLimiter({ max, windowMs }: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, RateLimitEntry>();

  function prune(now: number): void {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return {
    take(ip) {
      if (!ip) return { ok: true, remaining: max };
      const now = Date.now();
      prune(now);
      const entry = hits.get(ip) ?? { count: 0, resetAt: now + windowMs };
      if (entry.count >= max) {
        return { ok: false, retryAfterMs: Math.max(0, entry.resetAt - now) };
      }
      entry.count += 1;
      hits.set(ip, entry);
      return { ok: true, remaining: max - entry.count };
    },
  };
}
