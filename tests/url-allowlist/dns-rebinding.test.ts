import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P3 #2 phase 3 commit 5/6 — end-to-end DNS rebinding 防御集成测试。
 *
 * 与 commit 2-4 单 lib 单测互补，本套件断言"完整防御链"的安全属性：
 * - 第一次调用 fetchWithAllowlist：checkAsync 拿到 public IP → Pool origin = public IP → fetch OK
 * - 第二次调用（模拟攻击者已 rebind DNS）：checkAsync 再次 resolve → 命中 127.0.0.1 → reject 在 Pool 构造**之前**
 * - 关键性质：第二次调用**没有** Pool ctor → 没有任何连接尝试发到 rebound IP（即使是 public/private 比较）
 *
 * 这套测试用 vi.mock 隔离 dns / undici，不依赖网络,CI 100% 可重复
 * （PoC 真实 DNS 验证保留在 `lib/url-allowlist/__demo__/dns-rebinding-poc.ts`,
 * 跑法见该 file 注释）。
 */

const { mockPoolInstances, mockPoolCtor } = vi.hoisted(() => {
  type MockPoolInstance = {
    origin: string;
    connect: { servername?: string };
    close: ReturnType<typeof vi.fn>;
  };
  const instances: MockPoolInstance[] = [];
  const ctor = vi.fn();
  return { mockPoolInstances: instances, mockPoolCtor: ctor };
});

vi.mock("undici", () => {
  class MockPool {
    origin: string;
    connect: { servername?: string };
    close = vi.fn().mockResolvedValue(undefined);
    constructor(origin: string, opts: { connect?: { servername?: string } }) {
      this.origin = origin;
      this.connect = opts.connect ?? {};
      mockPoolCtor(origin, opts);
      mockPoolInstances.push(this);
    }
  }
  return { Pool: MockPool };
});

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
import {
  createUrlAllowlist,
  fetchWithAllowlist,
  UrlAllowlistError,
} from "@/lib/url-allowlist";

const resolve4Mock = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
const resolve6Mock = dns.resolve6 as unknown as ReturnType<typeof vi.fn>;

let originalFetch: typeof globalThis.fetch;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resolve4Mock.mockReset();
  resolve6Mock.mockReset();
  mockPoolInstances.length = 0;
  mockPoolCtor.mockReset();
  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
});

describe("DNS rebinding integration — first call public, second call rebound private", () => {
  it("rejects second fetchWithAllowlist call after attacker rebinds DNS to 127.0.0.1", async () => {
    let dnsCallCount = 0;
    resolve4Mock.mockImplementation(() => {
      dnsCallCount += 1;
      // First resolve: attacker stages public IP (passes initial sniff)
      // Second resolve: attacker rebinds DNS, returns loopback
      return Promise.resolve(dnsCallCount === 1 ? ["1.1.1.1"] : ["127.0.0.1"]);
    });
    resolve6Mock.mockResolvedValue([]);
    fetchSpy.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const allow = createUrlAllowlist({ allowedHosts: ["evil.test"] });

    // First call: legitimate-looking, public IP → Pool routes to 1.1.1.1
    const r1 = await fetchWithAllowlist("https://evil.test/page", allow);
    expect(r1.status).toBe(200);
    expect(mockPoolCtor).toHaveBeenCalledTimes(1);
    expect(mockPoolCtor.mock.calls[0]?.[0]).toBe("https://1.1.1.1:443");

    // Second call: DNS now returns private IP → rejection BEFORE Pool construction
    let caught: unknown;
    try {
      await fetchWithAllowlist("https://evil.test/page", allow);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UrlAllowlistError);
    expect((caught as UrlAllowlistError).reason).toBe("resolved_private_ip");
    expect((caught as UrlAllowlistError).resolvedIp).toBe("127.0.0.1");
    // Critical: NO new Pool ctor on second call → zero connection attempt to rebound IP
    expect(mockPoolCtor).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("when DNS oscillates between public IPs, both fetches go through with respective IPs", async () => {
    // Sanity check: oscillation between public IPs should NOT be flagged as rebinding
    let dnsCallCount = 0;
    resolve4Mock.mockImplementation(() => {
      dnsCallCount += 1;
      return Promise.resolve(dnsCallCount === 1 ? ["1.1.1.1"] : ["8.8.8.8"]);
    });
    resolve6Mock.mockResolvedValue([]);
    fetchSpy.mockResolvedValue(new Response("ok"));

    const allow = createUrlAllowlist({ allowedHosts: ["cdn.example.com"] });

    const r1 = await fetchWithAllowlist("https://cdn.example.com/a", allow);
    const r2 = await fetchWithAllowlist("https://cdn.example.com/b", allow);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(mockPoolCtor).toHaveBeenCalledTimes(2);
    expect(mockPoolCtor.mock.calls[0]?.[0]).toBe("https://1.1.1.1:443");
    expect(mockPoolCtor.mock.calls[1]?.[0]).toBe("https://8.8.8.8:443");
  });

  it("cloud metadata rebinding (169.254.169.254) is rejected with informative error", async () => {
    let dnsCallCount = 0;
    resolve4Mock.mockImplementation(() => {
      dnsCallCount += 1;
      return Promise.resolve(
        dnsCallCount === 1 ? ["1.1.1.1"] : ["169.254.169.254"],
      );
    });
    resolve6Mock.mockResolvedValue([]);
    fetchSpy.mockResolvedValueOnce(new Response("ok"));

    const allow = createUrlAllowlist({ allowedHosts: ["api.evil.test"] });

    // Warm up: first fetch passes
    await fetchWithAllowlist("https://api.evil.test/v1", allow);

    // Attack: rebind to AWS metadata
    let caught: unknown;
    try {
      await fetchWithAllowlist("https://api.evil.test/v1", allow);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UrlAllowlistError);
    expect((caught as UrlAllowlistError).reason).toBe("resolved_private_ip");
    expect((caught as UrlAllowlistError).resolvedIp).toBe("169.254.169.254");
    expect((caught as UrlAllowlistError).url).toBe("https://api.evil.test/v1");
  });

  it("IPv6 rebinding (fc00::/7 ULA) is rejected", async () => {
    let dnsCallCount = 0;
    resolve4Mock.mockResolvedValue([]);
    resolve6Mock.mockImplementation(() => {
      dnsCallCount += 1;
      return Promise.resolve(
        dnsCallCount === 1 ? ["2606:4700:4700::1111"] : ["fc00::1"],
      );
    });
    fetchSpy.mockResolvedValueOnce(new Response("ok"));

    const allow = createUrlAllowlist({ allowedHosts: ["ipv6-only.test"] });

    await fetchWithAllowlist("https://ipv6-only.test/", allow);
    expect(mockPoolCtor.mock.calls[0]?.[0]).toBe("https://[2606:4700:4700::1111]:443");

    let caught: unknown;
    try {
      await fetchWithAllowlist("https://ipv6-only.test/", allow);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UrlAllowlistError);
    expect((caught as UrlAllowlistError).reason).toBe("resolved_private_ip");
    expect((caught as UrlAllowlistError).resolvedIp).toBe("fc00::1");
  });
});

describe("DNS rebinding integration — transient DNS failure handling", () => {
  it("transient NXDOMAIN error throws dns_resolve_failed (caller may retry)", async () => {
    resolve4Mock.mockRejectedValueOnce(Object.assign(new Error("nx"), { code: "NXDOMAIN" }));
    resolve6Mock.mockRejectedValueOnce(Object.assign(new Error("nx"), { code: "NXDOMAIN" }));

    const allow = createUrlAllowlist({ allowedHosts: ["dead.test"] });

    let caught: unknown;
    try {
      await fetchWithAllowlist("https://dead.test/", allow);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UrlAllowlistError);
    expect((caught as UrlAllowlistError).reason).toBe("dns_resolve_failed");
    expect((caught as UrlAllowlistError).cause).toContain("NXDOMAIN");
    // No Pool, no fetch
    expect(mockPoolCtor).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
