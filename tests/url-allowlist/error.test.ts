import { describe, expect, it } from "vitest";
import { UrlAllowlistError } from "@/lib/url-allowlist";

describe("UrlAllowlistError — phase 2 backward-compatible constructor (2-arg)", () => {
  it("constructs with reason + url, no extra fields populated", () => {
    const e = new UrlAllowlistError("host_denied", "https://attacker.test/");
    expect(e.name).toBe("UrlAllowlistError");
    expect(e.reason).toBe("host_denied");
    expect(e.url).toBe("https://attacker.test/");
    expect(e.resolvedIp).toBeUndefined();
    expect(e.cause).toBeUndefined();
    expect(e.message).toContain("host_denied");
  });

  it("is an instance of Error", () => {
    const e = new UrlAllowlistError("scheme_denied", "http://x/");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(UrlAllowlistError);
  });
});

describe("UrlAllowlistError — phase 3 extension fields (resolvedIp + cause)", () => {
  it("populates resolvedIp when extra.resolvedIp passed", () => {
    const e = new UrlAllowlistError("resolved_private_ip", "https://evil.test/", {
      resolvedIp: "127.0.0.1",
    });
    expect(e.reason).toBe("resolved_private_ip");
    expect(e.resolvedIp).toBe("127.0.0.1");
    expect(e.cause).toBeUndefined();
  });

  it("populates cause when extra.cause passed (dns_resolve_failed case)", () => {
    const e = new UrlAllowlistError("dns_resolve_failed", "https://nx.test/", {
      cause: "A=NXDOMAIN;AAAA=NXDOMAIN",
    });
    expect(e.reason).toBe("dns_resolve_failed");
    expect(e.cause).toBe("A=NXDOMAIN;AAAA=NXDOMAIN");
    expect(e.resolvedIp).toBeUndefined();
  });

  it("supports both extra fields simultaneously", () => {
    const e = new UrlAllowlistError("resolved_private_ip", "https://x.test/", {
      resolvedIp: "10.0.0.1",
      cause: "diag-marker",
    });
    expect(e.resolvedIp).toBe("10.0.0.1");
    expect(e.cause).toBe("diag-marker");
  });

  it("undefined extra fields do not leak into instance (no spurious properties)", () => {
    const e = new UrlAllowlistError("resolved_private_ip", "https://x.test/", {
      resolvedIp: undefined,
      cause: undefined,
    });
    expect(e.resolvedIp).toBeUndefined();
    expect(e.cause).toBeUndefined();
  });
});

describe("UrlAllowlistError — accepts all phase 3 deny reasons (type-safe smoke)", () => {
  it("type-checks against all UrlAllowlistDenyReason variants", () => {
    // Pure compile-time check; runtime is just constructor invocation
    const reasons = [
      "invalid_url",
      "scheme_denied",
      "host_denied",
      "private_ip",
      "dns_resolve_failed",
      "resolved_private_ip",
    ] as const;
    for (const r of reasons) {
      const e = new UrlAllowlistError(r, "https://x/");
      expect(e.reason).toBe(r);
    }
  });
});
