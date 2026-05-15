import { describe, expect, it } from "vitest";
import { createUrlAllowlist, VERCEL_BLOB_PRESET } from "@/lib/url-allowlist";

describe("createUrlAllowlist — opts validation (Zod throws on misconfigure)", () => {
  it("throws when allowedHosts is empty array", () => {
    expect(() =>
      createUrlAllowlist({ allowedHosts: [] }),
    ).toThrow();
  });

  it("throws when allowedHosts contains empty string", () => {
    expect(() =>
      createUrlAllowlist({ allowedHosts: [""] }),
    ).toThrow();
  });

  it("throws when allowedHosts contains malformed { suffix } (empty)", () => {
    expect(() =>
      createUrlAllowlist({ allowedHosts: [{ suffix: "" }] }),
    ).toThrow();
  });

  it("throws when allowedSchemes is empty array (explicit empty disallowed)", () => {
    expect(() =>
      createUrlAllowlist({
        allowedSchemes: [],
        allowedHosts: ["example.com"],
      }),
    ).toThrow();
  });

  it("throws when allowedSchemes contains empty string", () => {
    expect(() =>
      createUrlAllowlist({
        allowedSchemes: [""],
        allowedHosts: ["example.com"],
      }),
    ).toThrow();
  });

  it("accepts well-formed opts and returns a UrlAllowlist", () => {
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    expect(typeof allow.check).toBe("function");
  });
});

describe("createUrlAllowlist — defaults (https-only + blockPrivateIps=true)", () => {
  it("default allowedSchemes = ['https:'] — http denied without explicit opt-in", () => {
    const allow = createUrlAllowlist({ allowedHosts: ["example.com"] });
    const result = allow.check("http://example.com/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scheme_denied");
  });

  it("default blockPrivateIps = true — loopback denied even if host-listed", () => {
    const allow = createUrlAllowlist({ allowedHosts: ["127.0.0.1"] });
    const result = allow.check("https://127.0.0.1/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("private_ip");
  });
});

describe("VERCEL_BLOB_PRESET — 等价 isVercelBlobUrl 旧实现（含 root/subdomain 升级）", () => {
  const allow = createUrlAllowlist(VERCEL_BLOB_PRESET);

  it("accepts subdomain https URL (旧实现也通过)", () => {
    const result = allow.check(
      "https://abc123.public.blob.vercel-storage.com/file.pdf",
    );
    expect(result.ok).toBe(true);
  });

  it("accepts root domain https URL (新 lib suffix pattern 允许,旧 endsWith 不允许)", () => {
    // spec 行为：suffix pattern host === sfx.slice(1) || endsWith(sfx)
    const result = allow.check("https://public.blob.vercel-storage.com/file.pdf");
    expect(result.ok).toBe(true);
  });

  it("denies non-Vercel host (旧实现也拒绝)", () => {
    const result = allow.check("https://attacker.test/exfil");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("host_denied");
  });

  it("denies http scheme (升级:旧实现未校验 scheme,新 preset 强制 https)", () => {
    const result = allow.check(
      "http://abc.public.blob.vercel-storage.com/file.pdf",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("scheme_denied");
  });

  it("denies invalid URL (旧实现 catch return false → 新 lib invalid_url)", () => {
    const result = allow.check("not-a-url");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_url");
  });

  it("denies substring-suffix false positive (旧 endsWith 行为保留)", () => {
    const result = allow.check(
      "https://x.public.blob.vercel-storage.com.attacker.test/y",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("host_denied");
  });
});
