import { describe, expect, it } from "vitest";
import { createMemoryBackend } from "@/lib/rate-limit/memory-backend";
import type { BackendCheckInput, RateLimitAlgorithm } from "@/lib/rate-limit/types";

function input(
  overrides: Partial<BackendCheckInput> & { algorithm?: RateLimitAlgorithm } = {},
): BackendCheckInput {
  return {
    identifier: "test",
    key: "user-a",
    limit: 3,
    windowMs: 1000,
    windowSpec: "1 s",
    algorithm: "sliding",
    ...overrides,
  };
}

function makeBackendAt(start: number) {
  let now = start;
  const backend = createMemoryBackend(() => now);
  return {
    backend,
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

describe("memory-backend / sliding window", () => {
  it("isolates state per (identifier, key)", async () => {
    const { backend } = makeBackendAt(1_000_000);
    const r1a = await backend.check(input({ identifier: "ns1", key: "x", limit: 1 }));
    const r1b = await backend.check(input({ identifier: "ns1", key: "x", limit: 1 }));
    const r2a = await backend.check(input({ identifier: "ns1", key: "y", limit: 1 }));
    const r3a = await backend.check(input({ identifier: "ns2", key: "x", limit: 1 }));
    expect(r1a.success).toBe(true);
    expect(r1b.success).toBe(false);
    expect(r2a.success).toBe(true); // different key
    expect(r3a.success).toBe(true); // different identifier
  });

  it("rolls over once oldest timestamp falls outside the window", async () => {
    const env = makeBackendAt(1_000_000);
    const opts = input({ limit: 2, windowMs: 1000 });

    const a = await env.backend.check(opts);
    const b = await env.backend.check(opts);
    const c = await env.backend.check(opts);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(c.success).toBe(false); // 2/2 used, blocked
    expect(c.remaining).toBe(0);

    env.advance(1001); // entire window slides past first two timestamps
    const d = await env.backend.check(opts);
    expect(d.success).toBe(true);
    expect(d.remaining).toBe(1);
  });

  it("remaining count reflects live timestamps inside the window", async () => {
    const env = makeBackendAt(1_000_000);
    const opts = input({ limit: 5, windowMs: 1000 });
    const r1 = await env.backend.check(opts);
    expect(r1.remaining).toBe(4);
    env.advance(100);
    const r2 = await env.backend.check(opts);
    expect(r2.remaining).toBe(3);
  });

  it("blocked result's reset equals oldest live timestamp + windowMs", async () => {
    const env = makeBackendAt(1_000_000);
    const opts = input({ limit: 1, windowMs: 1000 });
    const a = await env.backend.check(opts);
    expect(a.success).toBe(true);
    env.advance(200);
    const b = await env.backend.check(opts);
    expect(b.success).toBe(false);
    expect(b.reset).toBe(1_000_000 + 1000); // first ts (1_000_000) + window
  });
});

describe("memory-backend / fixed window", () => {
  it("uses one shared bucket until the window expires", async () => {
    const env = makeBackendAt(2_000_000);
    const opts = input({ algorithm: "fixed", limit: 2, windowMs: 1000 });
    const a = await env.backend.check(opts);
    env.advance(200);
    const b = await env.backend.check(opts);
    env.advance(200);
    const c = await env.backend.check(opts);
    expect(a.success).toBe(true);
    expect(a.remaining).toBe(1);
    expect(b.success).toBe(true);
    expect(b.remaining).toBe(0);
    expect(c.success).toBe(false);
    expect(c.remaining).toBe(0);
    expect(c.reset).toBe(2_000_000 + 1000);

    env.advance(700); // total elapsed = 1100ms → window expired, next call opens new window
    const d = await env.backend.check(opts);
    expect(d.success).toBe(true);
    expect(d.remaining).toBe(1);
  });

  it("isolates per identifier across same key", async () => {
    const env = makeBackendAt(3_000_000);
    const a = await env.backend.check(
      input({ identifier: "ns1", algorithm: "fixed", limit: 1 }),
    );
    const b = await env.backend.check(
      input({ identifier: "ns1", algorithm: "fixed", limit: 1 }),
    );
    const c = await env.backend.check(
      input({ identifier: "ns2", algorithm: "fixed", limit: 1 }),
    );
    expect(a.success).toBe(true);
    expect(b.success).toBe(false);
    expect(c.success).toBe(true);
  });
});
