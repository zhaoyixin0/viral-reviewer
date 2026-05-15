import { getBackend } from "./backend";
import { windowToMs } from "./parse-window";
import {
  RateLimiterOptsSchema,
  type RateLimiter,
  type RateLimiterOpts,
} from "./types";

/**
 * Public entry —— 路由层只调这个 + middleware/headers/presets。
 *
 * createRateLimiter(opts):
 *   - 用 Zod 校验 opts(防 misconfigure;开发期就抛而不是运行时静默)
 *   - 通过 backend.ts dispatch 拿到 Upstash 或 memory backend(由 env 决定)
 *   - 返回 RateLimiter,内部把 caller key 加 identifier prefix 后落到 backend
 */
export function createRateLimiter(opts: RateLimiterOpts): RateLimiter {
  const parsed = RateLimiterOptsSchema.parse(opts);
  const algorithm = parsed.algorithm ?? "sliding";
  const windowMs = windowToMs(parsed.window);

  return {
    async check(key: string) {
      const backend = getBackend();
      return backend.check({
        identifier: parsed.identifier,
        key,
        limit: parsed.limit,
        windowMs,
        windowSpec: parsed.window,
        algorithm,
      });
    },
  };
}

export { rateLimitHeaders } from "./headers";
export { withRateLimit } from "./middleware";
export {
  STRICT_PER_IP,
  GENEROUS_AUTHENTICATED,
  WRITE_HEAVY,
  type RateLimitPreset,
} from "./presets";
export type {
  RateLimiter,
  RateLimiterOpts,
  RateLimitResult,
  RateLimitWindow,
  RateLimitAlgorithm,
  RateLimitBackend,
  BackendCheckInput,
} from "./types";
