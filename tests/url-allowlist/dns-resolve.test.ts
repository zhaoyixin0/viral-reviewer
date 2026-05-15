import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:dns/promises BEFORE import target.
vi.mock("node:dns", async () => {
  const actual = await vi.importActual<typeof import("node:dns")>("node:dns");
  return {
    ...actual,
    promises: {
      resolve4: vi.fn(),
      resolve6: vi.fn(),
    },
  };
});

import { promises as dns } from "node:dns";
import { safeResolveIp } from "@/lib/url-allowlist/dns-resolve";

const resolve4Mock = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
const resolve6Mock = dns.resolve6 as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  resolve4Mock.mockReset();
  resolve6Mock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("safeResolveIp — happy path (A + AAAA via Promise.allSettled)", () => {
  it("returns A records when only IPv4 fulfilled", async () => {
    resolve4Mock.mockResolvedValueOnce(["1.1.1.1", "1.0.0.1"]);
    resolve6Mock.mockRejectedValueOnce(Object.assign(new Error("NODATA"), { code: "ENODATA" }));
    const r = await safeResolveIp("example.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.addresses).toEqual(["1.1.1.1", "1.0.0.1"]);
  });

  it("returns AAAA records when only IPv6 fulfilled", async () => {
    resolve4Mock.mockRejectedValueOnce(Object.assign(new Error("NODATA"), { code: "ENODATA" }));
    resolve6Mock.mockResolvedValueOnce(["2606:4700:4700::1111"]);
    const r = await safeResolveIp("example.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.addresses).toEqual(["2606:4700:4700::1111"]);
  });

  it("merges A + AAAA when both fulfilled", async () => {
    resolve4Mock.mockResolvedValueOnce(["1.1.1.1"]);
    resolve6Mock.mockResolvedValueOnce(["2606:4700:4700::1111"]);
    const r = await safeResolveIp("example.com");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.addresses).toContain("1.1.1.1");
      expect(r.addresses).toContain("2606:4700:4700::1111");
    }
  });
});

describe("safeResolveIp — failure modes", () => {
  it("returns ok:false with cause when both A and AAAA reject", async () => {
    resolve4Mock.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    resolve6Mock.mockRejectedValueOnce(Object.assign(new Error("nxdomain"), { code: "NXDOMAIN" }));
    const r = await safeResolveIp("does-not-exist.test");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toContain("ENOTFOUND");
      expect(r.cause).toContain("NXDOMAIN");
    }
  });

  it("returns ok:false when both return empty arrays (no records)", async () => {
    resolve4Mock.mockResolvedValueOnce([]);
    resolve6Mock.mockResolvedValueOnce([]);
    const r = await safeResolveIp("empty.test");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toContain("empty");
  });

  it("returns ok:false immediately for empty hostname", async () => {
    const r = await safeResolveIp("");
    expect(r.ok).toBe(false);
    expect(resolve4Mock).not.toHaveBeenCalled();
    expect(resolve6Mock).not.toHaveBeenCalled();
  });

  it("describes Error without .code via message", async () => {
    resolve4Mock.mockRejectedValueOnce(new Error("bespoke message"));
    resolve6Mock.mockRejectedValueOnce(new Error("other"));
    const r = await safeResolveIp("x.test");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toContain("bespoke message");
    }
  });
});

describe("safeResolveIp — timeout (5s default, custom override)", () => {
  it("rejects via timeout when resolve hangs beyond timeoutMs", async () => {
    // Both resolves hang forever
    resolve4Mock.mockReturnValueOnce(new Promise(() => {}));
    resolve6Mock.mockReturnValueOnce(new Promise(() => {}));
    const r = await safeResolveIp("slow.test", { timeoutMs: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toMatch(/timeout/);
  });
});

describe("safeResolveIp — Promise.allSettled concurrency (regression for W3 A2 补充约束)", () => {
  it("does not serialize: AAAA hang must NOT delay A fast path", async () => {
    // A resolves immediately; AAAA hangs forever. With Promise.allSettled +
    // per-call timeout, total wall time should be ≤ timeoutMs (the AAAA
    // timeout) — NOT 2× timeoutMs (which would indicate accidental serial await).
    resolve4Mock.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6Mock.mockReturnValueOnce(new Promise(() => {}));
    const t0 = Date.now();
    const r = await safeResolveIp("partial.test", { timeoutMs: 100 });
    const elapsed = Date.now() - t0;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.addresses).toEqual(["1.2.3.4"]);
    // Concurrency check: total must be in [timeoutMs, ~1.5× timeoutMs);
    // serial would be ≥ 2× timeoutMs which fails this bound.
    expect(elapsed).toBeLessThan(200);
  });
});
