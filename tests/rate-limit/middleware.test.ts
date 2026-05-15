import { describe, expect, it, vi } from "vitest";
import { withRateLimit } from "@/lib/rate-limit/middleware";
import type { RateLimiter, RateLimitResult } from "@/lib/rate-limit/types";

function makeLimiter(result: RateLimitResult): {
  limiter: RateLimiter;
  check: ReturnType<typeof vi.fn>;
} {
  const check = vi.fn(async () => result);
  return { limiter: { check }, check };
}

describe("withRateLimit", () => {
  it("blocked → 429 + Retry-After + X-RateLimit-* headers, handler never called", async () => {
    const now = 9_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const { limiter, check } = makeLimiter({
        success: false,
        limit: 5,
        remaining: 0,
        reset: now + 10_000,
      });
      const handler = vi.fn(async () => new Response("ok"));
      const wrapped = withRateLimit(limiter, () => "ip:1.2.3.4", handler);

      const res = await wrapped(new Request("https://x/api/foo"));

      expect(res.status).toBe(429);
      expect(handler).not.toHaveBeenCalled();
      expect(check).toHaveBeenCalledWith("ip:1.2.3.4");
      expect(res.headers.get("Retry-After")).toBe("10");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
      const body = await res.json();
      expect(body.error).toBe("rate_limited");
      expect(body.limit).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allowed → handler response passes through with rate-limit headers injected", async () => {
    const { limiter } = makeLimiter({
      success: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60_000,
    });
    const handler = vi.fn(async () =>
      new Response(JSON.stringify({ data: "v" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Custom": "keep" },
      }),
    );
    const wrapped = withRateLimit(limiter, () => "user:42", handler);

    const res = await wrapped(new Request("https://x/api/foo"));

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.headers.get("X-Custom")).toBe("keep");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
    expect(res.headers.get("Retry-After")).toBeNull();
    const body = await res.json();
    expect(body).toEqual({ data: "v" });
  });

  it("keyFn called exactly once per request", async () => {
    const { limiter } = makeLimiter({
      success: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 1000,
    });
    const handler = vi.fn(async () => new Response("ok"));
    const keyFn = vi.fn((_: Request) => "k");
    const wrapped = withRateLimit(limiter, keyFn, handler);
    await wrapped(new Request("https://x/api/foo"));
    expect(keyFn).toHaveBeenCalledTimes(1);
  });
});
