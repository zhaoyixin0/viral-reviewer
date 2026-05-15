import type { RateLimitResult } from "./types";

/**
 * IETF draft `RateLimit-*` 与传统 `X-RateLimit-*` 双写,兼容老客户端。
 * blocked 多写 `Retry-After`(秒,整数,RFC 7231)。
 */
export function rateLimitHeaders(
  result: RateLimitResult,
  now: number = Date.now(),
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((result.reset - now) / 1000))),
  };
  if (!result.success) {
    const retryAfter = Math.max(0, Math.ceil((result.reset - now) / 1000));
    headers["Retry-After"] = String(retryAfter);
  }
  return headers;
}
