import { describe, expect, it } from "vitest";
import { matchHost } from "@/lib/url-allowlist/host-match";

describe("matchHost — string pattern (exact, case-insensitive)", () => {
  it("matches lowercase exact host", () => {
    expect(matchHost("example.com", "example.com")).toBe(true);
  });

  it("matches mixed-case host (DNS is case-insensitive)", () => {
    expect(matchHost("Example.COM", "example.com")).toBe(true);
    expect(matchHost("example.com", "EXAMPLE.com")).toBe(true);
  });

  it("rejects subdomain (string pattern is exact, not suffix)", () => {
    expect(matchHost("a.example.com", "example.com")).toBe(false);
  });

  it("rejects different host", () => {
    expect(matchHost("evil.com", "example.com")).toBe(false);
  });
});

describe("matchHost — RegExp pattern (caller controls anchoring/flags)", () => {
  it("matches anchored regex", () => {
    expect(matchHost("api.example.com", /^api\.example\.com$/)).toBe(true);
  });

  it("respects caller-chosen non-anchored regex (substring match allowed)", () => {
    // Caller responsibility: 不锚定 = 子串匹配。lib 不强加 ^...$。
    expect(matchHost("evil-api.example.com.attacker.test", /example\.com/)).toBe(true);
  });

  it("rejects non-matching regex", () => {
    expect(matchHost("other.com", /^api\.example\.com$/)).toBe(false);
  });

  it("regex case-sensitivity follows caller flags (no implicit /i)", () => {
    expect(matchHost("Example.com", /^example\.com$/)).toBe(false);
    expect(matchHost("Example.com", /^example\.com$/i)).toBe(true);
  });
});

describe("matchHost — { suffix } pattern (root + subdomain both allowed)", () => {
  it("matches root domain (host === suffix.slice(1))", () => {
    expect(matchHost("foo.com", { suffix: ".foo.com" })).toBe(true);
  });

  it("matches subdomain", () => {
    expect(matchHost("a.foo.com", { suffix: ".foo.com" })).toBe(true);
    expect(matchHost("deep.nested.foo.com", { suffix: ".foo.com" })).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchHost("FOO.COM", { suffix: ".foo.com" })).toBe(true);
    expect(matchHost("Sub.Foo.Com", { suffix: ".FOO.COM" })).toBe(true);
  });

  it("rejects unrelated domain", () => {
    expect(matchHost("evil.com", { suffix: ".foo.com" })).toBe(false);
  });

  it("rejects host that only contains suffix as substring (not real suffix)", () => {
    // "x.foo.com.attacker.test" 不以 ".foo.com" 结尾 → 拒绝
    expect(matchHost("x.foo.com.attacker.test", { suffix: ".foo.com" })).toBe(false);
  });
});
