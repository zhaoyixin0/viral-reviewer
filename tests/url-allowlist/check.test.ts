import { describe, expect, it } from "vitest";
import { createUrlAllowlist } from "@/lib/url-allowlist";

describe("createUrlAllowlist().check — happy path", () => {
  const allow = createUrlAllowlist({
    allowedHosts: [{ suffix: ".example.com" }],
  });

  it("accepts https + allowed host (suffix match, root domain)", () => {
    const result = allow.check("https://example.com/path?q=1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.hostname).toBe("example.com");
      expect(result.parsed.protocol).toBe("https:");
    }
  });

  it("accepts https + allowed host (suffix match, subdomain)", () => {
    const result = allow.check("https://api.example.com/v1");
    expect(result.ok).toBe(true);
  });
});

describe("createUrlAllowlist().check — scheme denial", () => {
  const allow = createUrlAllowlist({
    allowedHosts: [{ suffix: ".example.com" }],
  });

  it("denies http (default schemes = [https:])", () => {
    const result = allow.check("http://example.com/path");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scheme_denied");
  });

  it("denies file://", () => {
    const result = allow.check("file:///etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scheme_denied");
  });

  it("denies gopher://", () => {
    const result = allow.check("gopher://example.com:70/1foo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scheme_denied");
  });

  it("denies javascript: pseudo-scheme", () => {
    const result = allow.check("javascript:alert(1)");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scheme_denied");
  });
});

describe("createUrlAllowlist().check — host denial", () => {
  const allow = createUrlAllowlist({
    allowedHosts: [{ suffix: ".example.com" }],
  });

  it("denies unrelated host", () => {
    const result = allow.check("https://attacker.test/exfil");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("host_denied");
  });

  it("denies host that only contains suffix as substring (not real suffix)", () => {
    // "evil.example.com.attacker.test" 不以 ".example.com" 结尾
    const result = allow.check("https://evil.example.com.attacker.test/x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("host_denied");
  });
});

describe("createUrlAllowlist().check — RegExp host pattern", () => {
  const allow = createUrlAllowlist({
    allowedHosts: [/^(.+\.)?cdn\.example\.com$/i],
  });

  it("accepts host matching anchored regex", () => {
    const result = allow.check("https://a.cdn.example.com/asset.mp4");
    expect(result.ok).toBe(true);
  });

  it("denies host not matching regex", () => {
    const result = allow.check("https://other.cdn.test/x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("host_denied");
  });
});

describe("createUrlAllowlist().check — invalid URL", () => {
  const allow = createUrlAllowlist({
    allowedHosts: ["example.com"],
  });

  it("returns invalid_url for garbage strings (no throw)", () => {
    const result = allow.check("not a url");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_url");
  });

  it("returns invalid_url for empty string", () => {
    const result = allow.check("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_url");
  });
});

describe("createUrlAllowlist().check — private IP blocking", () => {
  const allow = createUrlAllowlist({
    allowedHosts: ["127.0.0.1", "::1", { suffix: ".example.com" }],
  });

  it("denies https://127.0.0.1 even when host is in allowlist (private_ip wins)", () => {
    const result = allow.check("https://127.0.0.1/admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("private_ip");
  });

  it("denies cloud metadata 169.254.169.254", () => {
    const allow2 = createUrlAllowlist({
      allowedHosts: [/.*/], // 即便 host allowlist 是通配,private IP 也优先拒绝
    });
    const result = allow2.check("https://169.254.169.254/latest/meta-data/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("private_ip");
  });

  it("denies IPv6 [::1] form (URL hostname strips brackets)", () => {
    const result = allow.check("https://[::1]/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("private_ip");
  });

  it("allows public IP when host pattern matches (no private_ip false positive)", () => {
    const allow2 = createUrlAllowlist({
      allowedHosts: ["8.8.8.8"],
    });
    const result = allow2.check("https://8.8.8.8/x");
    expect(result.ok).toBe(true);
  });

  it("opt-out: blockPrivateIps=false allows loopback (e.g. dev env)", () => {
    const allow2 = createUrlAllowlist({
      allowedHosts: ["127.0.0.1"],
      blockPrivateIps: false,
    });
    const result = allow2.check("https://127.0.0.1/");
    expect(result.ok).toBe(true);
  });
});

describe("createUrlAllowlist().check — custom allowedSchemes", () => {
  it("accepts http when caller opts in", () => {
    const allow = createUrlAllowlist({
      allowedSchemes: ["http:", "https:"],
      allowedHosts: ["example.com"],
    });
    expect(allow.check("http://example.com/").ok).toBe(true);
    expect(allow.check("https://example.com/").ok).toBe(true);
  });

  it("normalizes scheme without trailing colon ('https' → 'https:')", () => {
    const allow = createUrlAllowlist({
      allowedSchemes: ["https"],
      allowedHosts: ["example.com"],
    });
    expect(allow.check("https://example.com/").ok).toBe(true);
  });
});
