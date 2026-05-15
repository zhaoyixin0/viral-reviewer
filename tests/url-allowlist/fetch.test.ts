import { beforeEach, describe, expect, it, vi } from "vitest";

// Share Pool spy state between mock factory and test file via vi.hoisted.
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

// Mock node:dns/promises so checkAsync can be driven from tests
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
import { fetchWithAllowlist } from "@/lib/url-allowlist/fetch";
import { createUrlAllowlist, UrlAllowlistError } from "@/lib/url-allowlist";

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

describe("fetchWithAllowlist — happy path (Pool dispatcher with SNI)", () => {
  it("returns underlying fetch response when allowlist + DNS pass", async () => {
    resolve4Mock.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6Mock.mockResolvedValueOnce([]);
    fetchSpy.mockResolvedValueOnce(new Response("hi", { status: 200 }));
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    const res = await fetchWithAllowlist("https://example.com/", allow);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("Pool constructed with `https://<ip>:443` origin", async () => {
    resolve4Mock.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6Mock.mockResolvedValueOnce([]);
    fetchSpy.mockResolvedValueOnce(new Response("ok"));
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    await fetchWithAllowlist("https://example.com/path", allow);
    expect(mockPoolCtor).toHaveBeenCalledTimes(1);
    expect(mockPoolCtor.mock.calls[0]?.[0]).toBe("https://1.2.3.4:443");
  });

  it("Pool connect.servername = original hostname (TLS SNI preserved)", async () => {
    resolve4Mock.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6Mock.mockResolvedValueOnce([]);
    fetchSpy.mockResolvedValueOnce(new Response("ok"));
    const allow = createUrlAllowlist({ allowedHosts: ["api.example.com"] });
    await fetchWithAllowlist("https://api.example.com/v1", allow);
    expect(mockPoolCtor.mock.calls[0]?.[1]).toMatchObject({
      connect: { servername: "api.example.com" },
    });
  });

  it("explicit port in URL is preserved in Pool origin", async () => {
    resolve4Mock.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6Mock.mockResolvedValueOnce([]);
    fetchSpy.mockResolvedValueOnce(new Response("ok"));
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    await fetchWithAllowlist("https://example.com:8443/", allow);
    expect(mockPoolCtor.mock.calls[0]?.[0]).toBe("https://1.2.3.4:8443");
  });
});

describe("fetchWithAllowlist — Pool.close (W3 verdict regression guard for resource leak)", () => {
  it("Pool.close is called after successful fetch", async () => {
    resolve4Mock.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6Mock.mockResolvedValueOnce([]);
    fetchSpy.mockResolvedValueOnce(new Response("ok"));
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    await fetchWithAllowlist("https://example.com/", allow);
    expect(mockPoolInstances).toHaveLength(1);
    expect(mockPoolInstances[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("Pool.close is called even when fetch rejects (finally block)", async () => {
    resolve4Mock.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6Mock.mockResolvedValueOnce([]);
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    await expect(fetchWithAllowlist("https://example.com/", allow)).rejects.toThrow("network down");
    expect(mockPoolInstances[0]?.close).toHaveBeenCalledTimes(1);
  });
});

describe("fetchWithAllowlist — deny paths throw UrlAllowlistError", () => {
  it("invalid_url → UrlAllowlistError", async () => {
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    await expect(fetchWithAllowlist("not-a-url", allow)).rejects.toBeInstanceOf(UrlAllowlistError);
  });

  it("scheme_denied → UrlAllowlistError with reason", async () => {
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    try {
      await fetchWithAllowlist("http://example.com/", allow);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UrlAllowlistError);
      expect((e as UrlAllowlistError).reason).toBe("scheme_denied");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("host_denied → UrlAllowlistError, no DNS resolve, no Pool", async () => {
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    await expect(
      fetchWithAllowlist("https://attacker.test/", allow),
    ).rejects.toBeInstanceOf(UrlAllowlistError);
    expect(resolve4Mock).not.toHaveBeenCalled();
    expect(mockPoolCtor).not.toHaveBeenCalled();
  });

  it("resolved_private_ip → UrlAllowlistError, no Pool, no fetch", async () => {
    resolve4Mock.mockResolvedValueOnce(["127.0.0.1"]);
    resolve6Mock.mockResolvedValueOnce([]);
    const allow = createUrlAllowlist({ allowedHosts: ["evil.test"] });
    try {
      await fetchWithAllowlist("https://evil.test/", allow);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UrlAllowlistError);
      expect((e as UrlAllowlistError).reason).toBe("resolved_private_ip");
    }
    expect(mockPoolCtor).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dns_resolve_failed → UrlAllowlistError, no Pool", async () => {
    resolve4Mock.mockRejectedValueOnce(Object.assign(new Error("nx"), { code: "NXDOMAIN" }));
    resolve6Mock.mockRejectedValueOnce(Object.assign(new Error("nx"), { code: "NXDOMAIN" }));
    const allow = createUrlAllowlist({ allowedHosts: ["nx.test"] });
    try {
      await fetchWithAllowlist("https://nx.test/", allow);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UrlAllowlistError);
      expect((e as UrlAllowlistError).reason).toBe("dns_resolve_failed");
    }
    expect(mockPoolCtor).not.toHaveBeenCalled();
  });
});

describe("fetchWithAllowlist — IP preference (v4 over v6) + IPv6 bracket wrap", () => {
  it("prefers IPv4 when both A and AAAA returned", async () => {
    resolve4Mock.mockResolvedValueOnce(["1.2.3.4"]);
    resolve6Mock.mockResolvedValueOnce(["2606:4700:4700::1111"]);
    fetchSpy.mockResolvedValueOnce(new Response("ok"));
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    await fetchWithAllowlist("https://example.com/", allow);
    expect(mockPoolCtor.mock.calls[0]?.[0]).toBe("https://1.2.3.4:443");
  });

  it("uses IPv6 with [] bracket when only AAAA returned", async () => {
    resolve4Mock.mockResolvedValueOnce([]);
    resolve6Mock.mockResolvedValueOnce(["2606:4700:4700::1111"]);
    fetchSpy.mockResolvedValueOnce(new Response("ok"));
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    await fetchWithAllowlist("https://example.com/", allow);
    expect(mockPoolCtor.mock.calls[0]?.[0]).toBe("https://[2606:4700:4700::1111]:443");
  });
});

describe("fetchWithAllowlist — blockPrivateIps=false fallback (no Pool)", () => {
  it("plain fetch without Pool when blockPrivateIps=false", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("ok"));
    const allow = createUrlAllowlist({
      allowedHosts: ["example.com"],
      blockPrivateIps: false,
    });
    await fetchWithAllowlist("https://example.com/", allow);
    expect(mockPoolCtor).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/", undefined);
  });
});
