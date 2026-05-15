import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";
import { _resetBackendForTests } from "@/lib/rate-limit/backend";

describe("createRateLimiter — entry validation + memory dispatch", () => {
  const origUrl = process.env.UPSTASH_REDIS_REST_URL;
  const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    _resetBackendForTests();
  });

  afterEach(() => {
    if (origUrl) process.env.UPSTASH_REDIS_REST_URL = origUrl;
    else delete process.env.UPSTASH_REDIS_REST_URL;
    if (origToken) process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
    else delete process.env.UPSTASH_REDIS_REST_TOKEN;
    _resetBackendForTests();
    vi.restoreAllMocks();
  });

  it("rejects invalid opts (empty identifier)", () => {
    expect(() =>
      createRateLimiter({ identifier: "", limit: 1, window: "1 s" }),
    ).toThrow();
  });

  it("rejects invalid opts (zero limit)", () => {
    expect(() =>
      createRateLimiter({ identifier: "x", limit: 0, window: "1 s" }),
    ).toThrow();
  });

  it("enforces limit via in-memory backend fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rl = createRateLimiter({
      identifier: "fb-test",
      limit: 1,
      window: "10 s",
    });
    const a = await rl.check("u1");
    const b = await rl.check("u1");
    expect(a.success).toBe(true);
    expect(b.success).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("warns only once across multiple createRateLimiter calls in same process", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rl1 = createRateLimiter({
      identifier: "warn-1",
      limit: 1,
      window: "10 s",
    });
    const rl2 = createRateLimiter({
      identifier: "warn-2",
      limit: 1,
      window: "10 s",
    });
    await rl1.check("u");
    await rl2.check("u");
    const rateLimitWarns = warn.mock.calls.filter((c) =>
      String(c[0]).includes("[rate-limit]"),
    );
    expect(rateLimitWarns).toHaveLength(1);
  });
});
