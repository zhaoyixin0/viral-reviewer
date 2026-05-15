import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:dns/promises BEFORE importing index → safeResolveIp 间接使用 dns
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
import { createUrlAllowlist } from "@/lib/url-allowlist";

const resolve4Mock = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
const resolve6Mock = dns.resolve6 as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  resolve4Mock.mockReset();
  resolve6Mock.mockReset();
});

describe("checkAsync — happy path", () => {
  it("resolves public IP and returns ok with resolvedAddresses", async () => {
    resolve4Mock.mockResolvedValueOnce(["8.8.8.8"]);
    resolve6Mock.mockResolvedValueOnce([]);
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    const r = await allow.checkAsync("https://example.com/x");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolvedAddresses).toContain("8.8.8.8");
      expect(r.parsed.hostname).toBe("example.com");
    }
  });
});

describe("checkAsync — sync deny short-circuit (no DNS resolve)", () => {
  it("invalid URL → invalid_url without DNS call", async () => {
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    const r = await allow.checkAsync("not-a-url");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_url");
    expect(resolve4Mock).not.toHaveBeenCalled();
    expect(resolve6Mock).not.toHaveBeenCalled();
  });

  it("scheme denied → scheme_denied without DNS call", async () => {
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    const r = await allow.checkAsync("http://example.com/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("scheme_denied");
    expect(resolve4Mock).not.toHaveBeenCalled();
  });

  it("host denied → host_denied without DNS call", async () => {
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    const r = await allow.checkAsync("https://attacker.test/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("host_denied");
    expect(resolve4Mock).not.toHaveBeenCalled();
  });

  it("sync private_ip literal → private_ip without DNS call", async () => {
    const allow = createUrlAllowlist({ allowedHosts: ["127.0.0.1"] });
    const r = await allow.checkAsync("https://127.0.0.1/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("private_ip");
    expect(resolve4Mock).not.toHaveBeenCalled();
  });
});

describe("checkAsync — DNS resolve failure", () => {
  it("returns dns_resolve_failed with cause when DNS fails", async () => {
    resolve4Mock.mockRejectedValueOnce(Object.assign(new Error("nxdomain"), { code: "NXDOMAIN" }));
    resolve6Mock.mockRejectedValueOnce(Object.assign(new Error("nxdomain"), { code: "NXDOMAIN" }));
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    const r = await allow.checkAsync("https://example.com/");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("dns_resolve_failed");
      expect(r.cause).toContain("NXDOMAIN");
    }
  });
});

describe("checkAsync — DNS rebinding (resolved_private_ip)", () => {
  it("returns resolved_private_ip with the offending IP when A resolves to loopback", async () => {
    resolve4Mock.mockResolvedValueOnce(["127.0.0.1"]);
    resolve6Mock.mockResolvedValueOnce([]);
    const allow = createUrlAllowlist({ allowedHosts: ["evil.test"] });
    const r = await allow.checkAsync("https://evil.test/");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("resolved_private_ip");
      expect(r.resolvedIp).toBe("127.0.0.1");
    }
  });

  it("returns resolved_private_ip when AAAA resolves to fc00::/7 ULA", async () => {
    resolve4Mock.mockResolvedValueOnce([]);
    resolve6Mock.mockResolvedValueOnce(["fc00::1"]);
    const allow = createUrlAllowlist({ allowedHosts: ["evil.test"] });
    const r = await allow.checkAsync("https://evil.test/");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("resolved_private_ip");
      expect(r.resolvedIp).toBe("fc00::1");
    }
  });

  it("returns resolved_private_ip for AWS metadata 169.254.169.254 via DNS rebinding", async () => {
    resolve4Mock.mockResolvedValueOnce(["169.254.169.254"]);
    resolve6Mock.mockResolvedValueOnce([]);
    const allow = createUrlAllowlist({ allowedHosts: ["evil.test"] });
    const r = await allow.checkAsync("https://evil.test/");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("resolved_private_ip");
      expect(r.resolvedIp).toBe("169.254.169.254");
    }
  });

  it("rejects on first private IP even if subsequent IPs are public", async () => {
    resolve4Mock.mockResolvedValueOnce(["127.0.0.1", "8.8.8.8"]);
    resolve6Mock.mockResolvedValueOnce([]);
    const allow = createUrlAllowlist({ allowedHosts: ["evil.test"] });
    const r = await allow.checkAsync("https://evil.test/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resolvedIp).toBe("127.0.0.1");
  });
});

describe("checkAsync — blockPrivateIps=false skips DNS resolve (dev opt-out)", () => {
  it("returns ok without DNS resolve when blockPrivateIps=false", async () => {
    const allow = createUrlAllowlist({
      allowedHosts: ["example.com"],
      blockPrivateIps: false,
    });
    const r = await allow.checkAsync("https://example.com/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolvedAddresses).toEqual([]);
    expect(resolve4Mock).not.toHaveBeenCalled();
    expect(resolve6Mock).not.toHaveBeenCalled();
  });
});

describe("checkAsync — IP literal host short-circuit (no DNS resolve)", () => {
  it("public IPv4 literal host returns ok with itself as resolvedAddress", async () => {
    const allow = createUrlAllowlist({ allowedHosts: ["8.8.8.8"] });
    const r = await allow.checkAsync("https://8.8.8.8/x");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolvedAddresses).toEqual(["8.8.8.8"]);
    expect(resolve4Mock).not.toHaveBeenCalled();
  });

  it("public IPv6 literal host (bracket form) returns ok with itself", async () => {
    const allow = createUrlAllowlist({ allowedHosts: [/.*/] });
    const r = await allow.checkAsync("https://[2606:4700:4700::1111]/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolvedAddresses).toEqual(["2606:4700:4700::1111"]);
    expect(resolve6Mock).not.toHaveBeenCalled();
  });
});
