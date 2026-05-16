import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P3 #2 phase 2: 验证 technique-match route 在 stream 启动前 SSRF allowlist
// batch check 工作正常。route 的 raw `fetch` 路径不经 prepareAssets，需要 route
// 层独立测试覆盖。
//
// downstream lib mocks: 仅为让 module import 通过；allowlist gate 触发后这些
// 函数都不会被调，不需要返回值
vi.mock("@/lib/video/ffprobe-meta", () => ({
  probeVideoMeta: vi.fn(),
}));
vi.mock("@/lib/video/analyze-potential", () => ({
  analyzeMaterialPotential: vi.fn(),
}));
vi.mock("@/lib/sample-references", () => ({
  loadReferenceCutPlans: vi.fn(),
}));
vi.mock("@/lib/technique-matching/match-engine", () => ({
  matchTechniques: vi.fn(),
}));

// Phase 3.5: mock node:dns + undici for checkAsync + fetchWithAllowlist
vi.mock("node:dns", async () => {
  const actual = await vi.importActual<typeof import("node:dns")>("node:dns");
  return {
    ...actual,
    promises: { resolve4: vi.fn(), resolve6: vi.fn() },
  };
});

const { mockPoolCtor } = vi.hoisted(() => ({ mockPoolCtor: vi.fn() }));
vi.mock("undici", () => {
  class MockPool {
    close = vi.fn().mockResolvedValue(undefined);
    constructor(origin: string, opts: { connect?: { servername?: string } }) {
      mockPoolCtor(origin, opts);
    }
  }
  return { Pool: MockPool };
});

import { promises as dns } from "node:dns";
import {
  mockDnsNxDomain,
  mockDnsResolve,
  resetDnsMocks,
} from "@/tests/__stubs__/dns-mock";
import { POST } from "@/app/api/technique-match/route";
import { NextRequest } from "next/server";
import { _resetBackendForTests } from "@/lib/rate-limit/backend";

const originalEnv = { ...process.env };

beforeEach(() => {
  // route 入口 503 守卫需要这两个 env 存在；用 placeholder 即可（allowlist
  // gate 早于 stream 启动，实际不会调任何外部 API）
  process.env.GOOGLE_API_KEY = "test-google-key";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  // P3 #3 phase 2: rate-limit 在 stream 启动前 check（早于 SSRF batch check）。
  // memory backend 跨 test case 累积同一 "anon" IP 桶 → 第 4 case 起 429。
  // 每 case reset 让 SSRF / happy path 期望不漂移。
  _resetBackendForTests();
  resetDnsMocks(dns);
  mockPoolCtor.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// Helper: mock DNS for multiple hosts to public IPs
function mockHostsPublic(hosts: string[]): void {
  const resolve4Mock = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
  const resolve6Mock = dns.resolve6 as unknown as ReturnType<typeof vi.fn>;
  resolve4Mock.mockImplementation((h: string) =>
    hosts.includes(h) ? Promise.resolve(["1.2.3.4"]) : Promise.resolve([]),
  );
  resolve6Mock.mockResolvedValue([]);
}

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("https://x/api/technique-match", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/technique-match · P3 #2 phase 2 SSRF allowlist gate", () => {
  it("rejects denied host with 400 url_denied before stream starts", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await POST(
        jsonReq({ videoUrls: ["https://evil.com/a.mp4"] }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("url_denied");
      const warned = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(
        warned.some(
          (m) =>
            m.includes("host_denied") && m.includes("route=technique-match"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects http:// scheme with 400 url_denied (scheme_denied)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await POST(
        jsonReq({
          videoUrls: ["http://x.public.blob.vercel-storage.com/a.mp4"],
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("url_denied");
      const warned = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warned.some((m) => m.includes("scheme_denied"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects private IP with 400 url_denied (private_ip)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await POST(
        jsonReq({ videoUrls: ["https://169.254.169.254/foo.mp4"] }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("url_denied");
      const warned = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warned.some((m) => m.includes("private_ip"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("batch fail-fast: 1st denied URL aborts before stream", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await POST(
        jsonReq({
          videoUrls: [
            "https://evil-1.com/a.mp4",
            "https://x.public.blob.vercel-storage.com/b.mp4",
          ],
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("url_denied");
      // 只 warn 一次（第一个 deny 就 return）
      // P3 #3 phase 2: rate-limit memory backend warn-once 也命中 spy，
      // 这里只统计 url-allowlist 的 warn 行
      const urlAllowlistWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes("[url-allowlist]"),
      );
      expect(urlAllowlistWarns.length).toBe(1);
      expect(String(urlAllowlistWarns[0][0])).toContain("evil-1.com");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not return 400 url_denied when all URLs pass allowlist (stream starts normally)", async () => {
    // Phase 3.5: 都解析到 public IP → checkAsync 全部 ok → 进 stream（不再 deny）
    mockHostsPublic([
      "x.public.blob.vercel-storage.com",
      "y.public.blob.vercel-storage.com",
    ]);
    const res = await POST(
      jsonReq({
        videoUrls: [
          "https://x.public.blob.vercel-storage.com/a.mp4",
          "https://y.public.blob.vercel-storage.com/b.mp4",
        ],
      }),
    );
    // 200 + NDJSON stream（stream 内部 mock 已被 vi.mock 桩住，不会真调 API）
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  });
});

describe("POST /api/technique-match · phase 3.5 dns_resolve_failed + resolved_private_ip pre-stream", () => {
  it("dns_resolve_failed: 502 + Retry-After: 5 BEFORE stream starts (no NDJSON)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mockDnsNxDomain(dns);
      const res = await POST(
        jsonReq({
          videoUrls: ["https://nx.public.blob.vercel-storage.com/a.mp4"],
        }),
      );
      expect(res.status).toBe(502);
      expect(res.headers.get("Retry-After")).toBe("5");
      // **critical security property**: NOT NDJSON stream (proves pre-stream batch caught it)
      expect(res.headers.get("content-type")).not.toContain("application/x-ndjson");
      const body = await res.json();
      expect(body.error).toBe("dns_resolve_failed");
      const warned = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(
        warned.some(
          (m) =>
            m.includes("dns_resolve_failed") &&
            m.includes("route=technique-match"),
        ),
      ).toBe(true);
      expect(mockPoolCtor).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("resolved_private_ip: 400 url_denied + console.error BEFORE stream starts", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockDnsResolve(
        dns,
        "evil.public.blob.vercel-storage.com",
        ["127.0.0.1"],
      );
      const res = await POST(
        jsonReq({
          videoUrls: ["https://evil.public.blob.vercel-storage.com/a.mp4"],
        }),
      );
      expect(res.status).toBe(400);
      // **critical security property**: NOT NDJSON stream (rejected pre-stream)
      expect(res.headers.get("content-type")).not.toContain("application/x-ndjson");
      const body = await res.json();
      expect(body.error).toBe("url_denied"); // same as host_denied (防 SSRF probe)
      const errored = errSpy.mock.calls.map((c) => String(c[0]));
      expect(
        errored.some(
          (m) =>
            m.includes("resolved_private_ip") &&
            m.includes("127.0.0.1") &&
            m.includes("route=technique-match"),
        ),
      ).toBe(true);
      // No Pool ctor: zero connection attempt to rebound IP
      expect(mockPoolCtor).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("all-or-nothing batch: 1 of N URLs rebinds → entire batch rejected pre-stream", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const resolve4Mock = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
      const resolve6Mock = dns.resolve6 as unknown as ReturnType<typeof vi.fn>;
      resolve4Mock.mockImplementation((h: string) => {
        if (h === "ok.public.blob.vercel-storage.com") return Promise.resolve(["1.1.1.1"]);
        if (h === "evil.public.blob.vercel-storage.com") return Promise.resolve(["169.254.169.254"]);
        return Promise.resolve([]);
      });
      resolve6Mock.mockResolvedValue([]);

      const res = await POST(
        jsonReq({
          videoUrls: [
            "https://ok.public.blob.vercel-storage.com/a.mp4",
            "https://evil.public.blob.vercel-storage.com/b.mp4",
          ],
        }),
      );
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).not.toContain("application/x-ndjson");
      const errored = errSpy.mock.calls.map((c) => String(c[0]));
      expect(
        errored.some(
          (m) => m.includes("resolved_private_ip") && m.includes("169.254.169.254"),
        ),
      ).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });
});
