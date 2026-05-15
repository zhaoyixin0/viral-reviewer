import { rateLimitHeaders } from "./headers";
import type { RateLimiter } from "./types";

/**
 * route handler wrapper:
 *   const limiter = createRateLimiter({ identifier: "x", limit: 10, window: "1 m" });
 *   export const GET = withRateLimit(limiter, (req) => clientIp(req), originalGET);
 *
 * 不强制 route 必须用这个 helper —— 也可直接 `limiter.check(key)` 手动注入 headers。
 * keyFn 留给 caller —— W2 不默认按 IP(Vercel x-forwarded-for trust chain 是 phase 2 W1 边界)。
 */
export function withRateLimit<Req extends Request>(
  limiter: RateLimiter,
  keyFn: (req: Req) => string,
  handler: (req: Req) => Promise<Response> | Response,
): (req: Req) => Promise<Response> {
  return async (req: Req) => {
    const key = keyFn(req);
    const result = await limiter.check(key);
    const headers = rateLimitHeaders(result);

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: "rate_limited", limit: result.limit }),
        {
          status: 429,
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const response = await handler(req);
    return injectHeaders(response, headers);
  };
}

function injectHeaders(
  response: Response,
  headers: Record<string, string>,
): Response {
  const merged = new Headers(response.headers);
  for (const [k, v] of Object.entries(headers)) {
    merged.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
