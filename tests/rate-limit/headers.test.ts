import { describe, expect, it } from "vitest";
import { rateLimitHeaders } from "@/lib/rate-limit/headers";

describe("rateLimitHeaders", () => {
  it("on success emits X-RateLimit-* + RateLimit-* and no Retry-After", () => {
    const now = 5_000_000;
    const headers = rateLimitHeaders(
      { success: true, limit: 10, remaining: 7, reset: now + 30_000 },
      now,
    );
    expect(headers["X-RateLimit-Limit"]).toBe("10");
    expect(headers["X-RateLimit-Remaining"]).toBe("7");
    expect(headers["X-RateLimit-Reset"]).toBe(String(Math.ceil((now + 30_000) / 1000)));
    expect(headers["RateLimit-Limit"]).toBe("10");
    expect(headers["RateLimit-Remaining"]).toBe("7");
    expect(headers["RateLimit-Reset"]).toBe("30"); // delta seconds
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("on blocked emits Retry-After (seconds) and remaining=0", () => {
    const now = 6_000_000;
    const headers = rateLimitHeaders(
      { success: false, limit: 10, remaining: 0, reset: now + 12_500 },
      now,
    );
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["Retry-After"]).toBe("13"); // ceil(12.5)
    expect(headers["RateLimit-Reset"]).toBe("13");
  });

  it("clamps negative reset delta to 0 (clock skew safety)", () => {
    const now = 7_000_000;
    const headers = rateLimitHeaders(
      { success: false, limit: 1, remaining: 0, reset: now - 5_000 },
      now,
    );
    expect(headers["Retry-After"]).toBe("0");
    expect(headers["RateLimit-Reset"]).toBe("0");
  });
});
