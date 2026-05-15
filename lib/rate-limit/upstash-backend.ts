import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type {
  BackendCheckInput,
  RateLimitBackend,
  RateLimitResult,
} from "./types";

/**
 * Upstash REST 后端 —— 生产路径。
 *
 * 实例缓存 per (identifier, limit, window, algorithm),Ratelimit 内部 sliding 窗口算法
 * 已被多家生产使用。Phase 1 测试不走真实 Upstash(那是 phase 2 集成测试范围)。
 */
export function createUpstashBackend(): RateLimitBackend {
  const redis = Redis.fromEnv();
  const cache = new Map<string, Ratelimit>();

  return {
    async check(input: BackendCheckInput): Promise<RateLimitResult> {
      const cacheKey = [
        input.identifier,
        input.limit,
        input.windowSpec,
        input.algorithm,
      ].join("|");

      let rl = cache.get(cacheKey);
      if (!rl) {
        const duration = input.windowSpec as Duration;
        const limiter =
          input.algorithm === "fixed"
            ? Ratelimit.fixedWindow(input.limit, duration)
            : Ratelimit.slidingWindow(input.limit, duration);
        rl = new Ratelimit({
          redis,
          limiter,
          prefix: `rl:${input.identifier}`,
        });
        cache.set(cacheKey, rl);
      }

      const res = await rl.limit(input.key);
      return {
        success: res.success,
        limit: res.limit,
        remaining: res.remaining,
        reset: res.reset,
      };
    },
  };
}
