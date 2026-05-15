import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetBackendForTests } from "@/lib/rate-limit/backend";

/**
 * P3 #3 phase 2 commit 5/6 per W3 verdict §F (F2: 22-test sample strategy):
 *   抽样 4 route 一对一覆盖 4 preset，验证 happy + 429 + rate-limit headers
 *   注入。account-profile 额外**显式断言** limiter.check 失败时不进入
 *   controller 分支（stream inline-before-enqueue 关键 invariant）。
 *
 * | 路由 | preset | limit/window |
 * |---|---|---|
 * | GET /api/trending | STRICT_PER_IP | 10/1m sliding |
 * | POST /api/template-brief | ANON_AI_HEAVY | 10/10m sliding |
 * | POST /api/scrape | WRITE_HEAVY | 5/10m fixed |
 * | POST /api/account-profile | STREAM_HEAVY | 3/10m fixed |
 *
 * 跨 describe 用 `_resetBackendForTests()` per case 清桶避免累积。
 */

// ============ scrape mocks ============
const scrapeTikTokMock = vi.fn();
const scrapeInstagramMock = vi.fn();
vi.mock("@/lib/apify/scrapers", () => ({
  scrapeTikTokByHashtag: (...a: unknown[]) => scrapeTikTokMock(...a),
  scrapeInstagramByHashtag: (...a: unknown[]) => scrapeInstagramMock(...a),
}));

// ============ account-profile mocks ============
const scrapeProfileMock = vi.fn();
const analyzeTopVideoMock = vi.fn();
const analyzeProfileMock = vi.fn();
const readCacheMock = vi.fn();
const writeCacheMock = vi.fn();
vi.mock("@/lib/account-profile/scrape", () => ({
  scrapeAccountProfile: (...a: unknown[]) => scrapeProfileMock(...a),
}));
vi.mock("@/lib/account-profile/frame-analyze", () => ({
  analyzeAccountTopVideo: (...a: unknown[]) => analyzeTopVideoMock(...a),
}));
vi.mock("@/lib/account-profile/analyze", () => ({
  analyzeAccountProfile: (...a: unknown[]) => analyzeProfileMock(...a),
}));
vi.mock("@/lib/account-profile/cache", () => ({
  buildAccountCacheKey: (p: string, u: string) => `${p}:${u}`,
  readAccountProfileCache: (...a: unknown[]) => readCacheMock(...a),
  writeAccountProfileCache: (...a: unknown[]) => writeCacheMock(...a),
}));

// ============ template-brief mocks ============
const extractBriefMock = vi.fn();
vi.mock("@/lib/template-review/brief-extract", () => ({
  extractBriefFromPDF: (...a: unknown[]) => extractBriefMock(...a),
  BriefExtractException: class BriefExtractException extends Error {
    detail: unknown;
    constructor(detail: unknown) {
      super("brief extract failed");
      this.detail = detail;
    }
  },
}));

// ============ trending mocks ============
const readLatestTwoMock = vi.fn();
vi.mock("@/lib/trending/snapshot-store", () => ({
  readLatestTwoSnapshots: (...a: unknown[]) => readLatestTwoMock(...a),
}));

import { POST as scrapePOST } from "@/app/api/scrape/route";
import { POST as accountProfilePOST } from "@/app/api/account-profile/route";
import { POST as templateBriefPOST } from "@/app/api/template-brief/route";
import { GET as trendingGET } from "@/app/api/trending/route";
import { NextRequest } from "next/server";

const originalEnv = { ...process.env };

beforeEach(() => {
  _resetBackendForTests();
  process.env.APIFY_TOKEN = "test-apify";
  process.env.ANTHROPIC_API_KEY = "test-anthropic";
  process.env.BLOB_READ_WRITE_TOKEN = "test-blob";
  // 默认 mocks（每个 describe override 自己需要的）
  scrapeTikTokMock.mockReset().mockResolvedValue({ videos: [] });
  scrapeInstagramMock.mockReset().mockResolvedValue({ videos: [] });
  scrapeProfileMock.mockReset().mockResolvedValue({ topVideos: [] });
  analyzeTopVideoMock.mockReset().mockResolvedValue(null);
  analyzeProfileMock.mockReset().mockResolvedValue({
    username: "u",
    platform: "tiktok",
    positioning: "p",
  });
  readCacheMock.mockReset().mockResolvedValue(null);
  writeCacheMock.mockReset().mockResolvedValue(undefined);
  extractBriefMock.mockReset().mockResolvedValue({
    coreIdea: "x",
    audience: "y",
    deliverables: [],
  });
  readLatestTwoMock.mockReset().mockResolvedValue({
    current: null,
    previous: null,
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

function postJson(url: string, body: unknown, ip = "1.2.3.4"): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": ip,
    },
    body: JSON.stringify(body),
  });
}

function getReq(url: string, ip = "1.2.3.4"): Request {
  return new Request(url, {
    method: "GET",
    headers: { "x-real-ip": ip },
  });
}

// ============================================================
// GET /api/trending · STRICT_PER_IP (10/1m sliding)
// ============================================================
describe("GET /api/trending · STRICT_PER_IP rate-limit", () => {
  it("happy: 1st call 200 + X-RateLimit-* headers injected", async () => {
    const res = await trendingGET(getReq("https://x/api/trending"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
    expect(res.headers.get("RateLimit-Reset")).toBeTruthy();
  });

  it("429: 11th call from same IP returns 429 + Retry-After", async () => {
    for (let i = 0; i < 10; i++) {
      await trendingGET(getReq("https://x/api/trending", "5.5.5.5"));
    }
    const res = await trendingGET(getReq("https://x/api/trending", "5.5.5.5"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.limit).toBe(10);
  });

  it("isolation: different IPs have independent buckets", async () => {
    for (let i = 0; i < 10; i++) {
      await trendingGET(getReq("https://x/api/trending", "9.9.9.9"));
    }
    const res = await trendingGET(getReq("https://x/api/trending", "8.8.8.8"));
    expect(res.status).toBe(200);
  });
});

// ============================================================
// POST /api/template-brief · ANON_AI_HEAVY (10/10m sliding)
// ============================================================
describe("POST /api/template-brief · ANON_AI_HEAVY rate-limit", () => {
  it("happy: 1st call passes rate-limit gate (multipart bad form -> 400, headers still injected)", async () => {
    // multipart 路径没 file 走 400 missing_file；rate-limit 通过后才到 400
    // —— 我们看 X-RateLimit-Limit=10 证明 wrapper 注入 headers
    const req = new NextRequest("https://x/api/template-brief", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=---",
        "x-real-ip": "1.2.3.4",
      },
      body: "---\r\n",
    });
    const res = await templateBriefPOST(req);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
  });

  it("429: 11th call returns rate_limited 429", async () => {
    const ip = "11.11.11.11";
    for (let i = 0; i < 10; i++) {
      await templateBriefPOST(
        postJson("https://x/api/template-brief", { blobUrl: "x" }, ip),
      );
    }
    const res = await templateBriefPOST(
      postJson("https://x/api/template-brief", { blobUrl: "x" }, ip),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.limit).toBe(10);
  });
});

// ============================================================
// POST /api/scrape · WRITE_HEAVY (5/10m fixed)
// ============================================================
describe("POST /api/scrape · WRITE_HEAVY rate-limit", () => {
  it("happy: 1st call 200 + X-RateLimit-Limit=5", async () => {
    const res = await scrapePOST(
      postJson(
        "https://x/api/scrape",
        { topic: "早餐健身", platforms: ["tiktok"] },
        "2.2.2.2",
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
  });

  it("429: 6th call from same IP returns 429 (fixed window)", async () => {
    const ip = "3.3.3.3";
    for (let i = 0; i < 5; i++) {
      await scrapePOST(
        postJson(
          "https://x/api/scrape",
          { topic: "早餐健身", platforms: ["tiktok"] },
          ip,
        ),
      );
    }
    const res = await scrapePOST(
      postJson(
        "https://x/api/scrape",
        { topic: "早餐健身", platforms: ["tiktok"] },
        ip,
      ),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.limit).toBe(5);
  });
});

// ============================================================
// POST /api/account-profile · STREAM_HEAVY (3/10m fixed)
// ============================================================
// W3 verdict §F mandate: stream 路由必须**显式断言** limiter.check 失败
// 时不进入 controller 分支（inline-before-enqueue invariant）。
describe("POST /api/account-profile · STREAM_HEAVY rate-limit (stream inline-before-enqueue)", () => {
  it("happy: 1st call 200 NDJSON stream + X-RateLimit-Limit=3", async () => {
    const res = await accountProfilePOST(
      postJson(
        "https://x/api/account-profile",
        { platform: "tiktok", username: "u1" },
        "4.4.4.4",
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
  });

  it("429: 4th call returns rate_limited 429 (fixed 3/10m)", async () => {
    const ip = "6.6.6.6";
    for (let i = 0; i < 3; i++) {
      await accountProfilePOST(
        postJson(
          "https://x/api/account-profile",
          { platform: "tiktok", username: "u2" },
          ip,
        ),
      );
    }
    const res = await accountProfilePOST(
      postJson(
        "https://x/api/account-profile",
        { platform: "tiktok", username: "u2" },
        ip,
      ),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.limit).toBe(3);
  });

  it("inline-before-enqueue invariant: 429 path does NOT call scrapeAccountProfile (stream controller never starts)", async () => {
    const ip = "7.7.7.7";
    for (let i = 0; i < 3; i++) {
      await accountProfilePOST(
        postJson(
          "https://x/api/account-profile",
          { platform: "tiktok", username: "u3" },
          ip,
        ),
      );
    }
    const callsBeforeRateLimit = scrapeProfileMock.mock.calls.length;
    const res = await accountProfilePOST(
      postJson(
        "https://x/api/account-profile",
        { platform: "tiktok", username: "u3" },
        ip,
      ),
    );
    expect(res.status).toBe(429);
    // ⭐ 关键断言: 429 之后 scrapeAccountProfile 调用次数没有增加 ——
    // 证明 limiter.check 失败时 controller.start 没跑（stream 未启动）。
    // 这是 P3 #2 phase 2 SSRF stream 教训的 rate-limit 镜像（f59080f）。
    expect(scrapeProfileMock.mock.calls.length).toBe(callsBeforeRateLimit);
  });
});
