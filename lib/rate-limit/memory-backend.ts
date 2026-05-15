import type {
  BackendCheckInput,
  RateLimitBackend,
  RateLimitResult,
} from "./types";

/**
 * 单进程 in-memory backend —— dev / 单实例 fallback。
 *
 * 不适合 Vercel 多实例生产(每个 worker 各算各的,limit 实际上 ×N)。
 * Phase 2 在路由层启用 Upstash 后,这条只在 env 缺失时兜底,并 console.warn 提示。
 */

type SlidingState = { timestamps: number[] };
type FixedState = { windowStart: number; count: number };

export function createMemoryBackend(now: () => number = Date.now): RateLimitBackend {
  const slidingStore = new Map<string, SlidingState>();
  const fixedStore = new Map<string, FixedState>();

  return {
    async check(input: BackendCheckInput): Promise<RateLimitResult> {
      if (input.algorithm === "fixed") {
        return checkFixed(fixedStore, input, now());
      }
      return checkSliding(slidingStore, input, now());
    },
  };
}

function bucketKey(identifier: string, key: string): string {
  return `${identifier}|${key}`;
}

function checkSliding(
  store: Map<string, SlidingState>,
  input: BackendCheckInput,
  nowMs: number,
): RateLimitResult {
  const k = bucketKey(input.identifier, input.key);
  const cutoff = nowMs - input.windowMs;
  const prev = store.get(k);
  const live = prev ? prev.timestamps.filter((t) => t > cutoff) : [];

  if (live.length >= input.limit) {
    store.set(k, { timestamps: live });
    const oldest = live[0] ?? nowMs;
    return {
      success: false,
      limit: input.limit,
      remaining: 0,
      reset: oldest + input.windowMs,
    };
  }

  const next = [...live, nowMs];
  store.set(k, { timestamps: next });
  return {
    success: true,
    limit: input.limit,
    remaining: input.limit - next.length,
    reset: (next[0] ?? nowMs) + input.windowMs,
  };
}

function checkFixed(
  store: Map<string, FixedState>,
  input: BackendCheckInput,
  nowMs: number,
): RateLimitResult {
  const k = bucketKey(input.identifier, input.key);
  const prev = store.get(k);
  if (!prev || nowMs >= prev.windowStart + input.windowMs) {
    store.set(k, { windowStart: nowMs, count: 1 });
    return {
      success: true,
      limit: input.limit,
      remaining: input.limit - 1,
      reset: nowMs + input.windowMs,
    };
  }
  if (prev.count >= input.limit) {
    return {
      success: false,
      limit: input.limit,
      remaining: 0,
      reset: prev.windowStart + input.windowMs,
    };
  }
  const next: FixedState = { windowStart: prev.windowStart, count: prev.count + 1 };
  store.set(k, next);
  return {
    success: true,
    limit: input.limit,
    remaining: input.limit - next.count,
    reset: prev.windowStart + input.windowMs,
  };
}
