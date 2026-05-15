import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/rate-limit";

/**
 * P3 #3 phase 2 verify-2(W3 verdict §B mandate):
 *   - x-real-ip 优先（Vercel 注入,single value 难伪造）
 *   - fallback x-forwarded-for left-most（Vercel canonical 客户端 IP）
 *   - fallback "anon"（无 header 时,dev/test/无 IP 请求落同一桶）
 *   - IPv6 / chain / 空 header 必测（W3 verdict §B 强制）
 */
describe("clientIp · Vercel IP trust chain (B3 spec)", () => {
  it("returns x-real-ip when present (IPv4 single)", () => {
    const req = new Request("https://example.com", {
      headers: { "x-real-ip": "1.2.3.4" },
    });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-forwarded-for left-most when x-real-ip absent", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1, 172.16.0.1" },
    });
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("prefers x-real-ip over x-forwarded-for when both set", () => {
    const req = new Request("https://example.com", {
      headers: {
        "x-real-ip": "5.5.5.5",
        "x-forwarded-for": "9.9.9.9, 10.0.0.1",
      },
    });
    expect(clientIp(req)).toBe("5.5.5.5");
  });

  it("returns 'anon' when no headers set", () => {
    const req = new Request("https://example.com");
    expect(clientIp(req)).toBe("anon");
  });

  it("handles IPv6 single value in x-real-ip", () => {
    const req = new Request("https://example.com", {
      headers: { "x-real-ip": "::1" },
    });
    expect(clientIp(req)).toBe("::1");
  });

  it("handles IPv6 chain in x-forwarded-for (left-most)", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "::ffff:127.0.0.1, 192.168.0.1" },
    });
    expect(clientIp(req)).toBe("::ffff:127.0.0.1");
  });

  it("trims whitespace around x-real-ip value", () => {
    const req = new Request("https://example.com", {
      headers: { "x-real-ip": "  8.8.8.8  " },
    });
    expect(clientIp(req)).toBe("8.8.8.8");
  });

  it("trims whitespace around x-forwarded-for left-most", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "  4.4.4.4  ,  10.0.0.1  " },
    });
    expect(clientIp(req)).toBe("4.4.4.4");
  });

  it("returns 'anon' when x-real-ip is empty string", () => {
    const req = new Request("https://example.com", {
      headers: { "x-real-ip": "" },
    });
    expect(clientIp(req)).toBe("anon");
  });

  it("returns 'anon' when x-forwarded-for is only whitespace + commas", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "  ,  " },
    });
    expect(clientIp(req)).toBe("anon");
  });
});
