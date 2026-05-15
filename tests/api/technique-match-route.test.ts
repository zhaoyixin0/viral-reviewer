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
});

afterEach(() => {
  process.env = { ...originalEnv };
});

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
    // 所有 URL 合法 → 进入 stream（无 throw）；不验证 stream 行为本身
    // （依赖更多 mock），只确认 allowlist gate 不误拒
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
