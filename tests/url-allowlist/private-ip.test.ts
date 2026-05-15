import { describe, expect, it } from "vitest";
import { isPrivateIpString } from "@/lib/url-allowlist/private-ip";

describe("isPrivateIpString — IPv4 private/loopback/link-local/edge ranges", () => {
  it("detects 10.0.0.0/8 (private)", () => {
    expect(isPrivateIpString("10.0.0.1")).toBe(true);
    expect(isPrivateIpString("10.255.255.255")).toBe(true);
  });

  it("detects 172.16.0.0/12 (private, only 172.16-172.31)", () => {
    expect(isPrivateIpString("172.16.0.1")).toBe(true);
    expect(isPrivateIpString("172.31.255.254")).toBe(true);
    // 172.15.x 和 172.32.x 不在私有段
    expect(isPrivateIpString("172.15.0.1")).toBe(false);
    expect(isPrivateIpString("172.32.0.1")).toBe(false);
  });

  it("detects 192.168.0.0/16 (private)", () => {
    expect(isPrivateIpString("192.168.0.1")).toBe(true);
    expect(isPrivateIpString("192.168.255.255")).toBe(true);
  });

  it("detects 127.0.0.0/8 (loopback)", () => {
    expect(isPrivateIpString("127.0.0.1")).toBe(true);
    expect(isPrivateIpString("127.255.255.255")).toBe(true);
  });

  it("detects 169.254.0.0/16 (link-local, includes cloud metadata 169.254.169.254)", () => {
    expect(isPrivateIpString("169.254.0.1")).toBe(true);
    expect(isPrivateIpString("169.254.169.254")).toBe(true);
  });

  it("detects 0.0.0.0/8 (unspecified)", () => {
    expect(isPrivateIpString("0.0.0.0")).toBe(true);
    expect(isPrivateIpString("0.1.2.3")).toBe(true);
  });

  it("detects 255.255.255.255 (broadcast)", () => {
    expect(isPrivateIpString("255.255.255.255")).toBe(true);
  });

  it("does NOT flag public IPv4 (8.8.8.8 / 1.1.1.1 / 142.250.x.x)", () => {
    expect(isPrivateIpString("8.8.8.8")).toBe(false);
    expect(isPrivateIpString("1.1.1.1")).toBe(false);
    expect(isPrivateIpString("142.250.80.46")).toBe(false);
  });

  it("rejects malformed IPv4 (octet > 255 / too few parts) as not-private", () => {
    expect(isPrivateIpString("10.0.0.256")).toBe(false);
    expect(isPrivateIpString("10.0.0")).toBe(false);
  });
});

describe("isPrivateIpString — IPv6 private/loopback/link-local ranges", () => {
  it("detects ::1 (loopback)", () => {
    expect(isPrivateIpString("::1")).toBe(true);
  });

  it("detects :: (unspecified)", () => {
    expect(isPrivateIpString("::")).toBe(true);
  });

  it("detects fc00::/7 (ULA — fc/fd start)", () => {
    expect(isPrivateIpString("fc00::1")).toBe(true);
    expect(isPrivateIpString("fd00::abcd")).toBe(true);
    expect(isPrivateIpString("FD12:3456:789a::1")).toBe(true); // case-insensitive
  });

  it("detects fe80::/10 (link-local — fe80~febf)", () => {
    expect(isPrivateIpString("fe80::1")).toBe(true);
    expect(isPrivateIpString("febf::dead:beef")).toBe(true);
    // fec0 不在 fe80::/10 范围（fec0::/10 是历史 site-local,已废弃,不算）
    expect(isPrivateIpString("fec0::1")).toBe(false);
  });

  it("does NOT flag public IPv6 (2001:db8::1 / 2606:4700:...)", () => {
    expect(isPrivateIpString("2001:db8::1")).toBe(false);
    expect(isPrivateIpString("2606:4700:4700::1111")).toBe(false);
  });

  it("strips brackets if caller passes [ipv6] form", () => {
    expect(isPrivateIpString("[::1]")).toBe(true);
    expect(isPrivateIpString("[fc00::1]")).toBe(true);
  });
});

describe("isPrivateIpString — IPv4-mapped IPv6 dotted-quad (phase 1 nit cleanup 2026-05-15)", () => {
  it("detects ::ffff:127.0.0.1 (loopback via mapped form)", () => {
    expect(isPrivateIpString("::ffff:127.0.0.1")).toBe(true);
  });

  it("detects ::ffff:10.0.0.1 (private 10/8 via mapped form)", () => {
    expect(isPrivateIpString("::ffff:10.0.0.1")).toBe(true);
  });

  it("detects ::ffff:169.254.169.254 (AWS metadata via mapped form)", () => {
    // SSRF 攻击模型：caller 拿 `https://[::ffff:169.254.169.254]/latest/...` 绕 host allowlist
    expect(isPrivateIpString("::ffff:169.254.169.254")).toBe(true);
  });

  it("is case-insensitive on the `::ffff:` prefix", () => {
    expect(isPrivateIpString("::FFFF:127.0.0.1")).toBe(true);
    expect(isPrivateIpString("::FfFf:10.0.0.1")).toBe(true);
  });

  it("strips brackets on IPv4-mapped IPv6 form", () => {
    expect(isPrivateIpString("[::ffff:127.0.0.1]")).toBe(true);
  });

  it("does NOT flag public IPv4 wrapped in ::ffff: (8.8.8.8 mapped)", () => {
    expect(isPrivateIpString("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("isPrivateIpString — non-IP hostnames", () => {
  it("returns false for domains (so domain-based allowlist handles them)", () => {
    expect(isPrivateIpString("example.com")).toBe(false);
    expect(isPrivateIpString("public.blob.vercel-storage.com")).toBe(false);
    expect(isPrivateIpString("a.b.c.d.e")).toBe(false);
  });

  it("returns false for garbage strings (let URL parse layer reject)", () => {
    expect(isPrivateIpString("")).toBe(false);
    expect(isPrivateIpString("not-an-ip")).toBe(false);
    expect(isPrivateIpString("...")).toBe(false);
  });
});
