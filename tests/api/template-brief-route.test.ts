import { describe, expect, it, vi, beforeEach } from "vitest";

const extractMock = vi.fn();
vi.mock("@/lib/template-review/brief-extract", () => ({
  extractBriefFromPDF: (...a: unknown[]) => extractMock(...a),
  // 测试不构造 BriefExtractException 路径,但 route 用 instanceof —— 提供占位类
  BriefExtractException: class BriefExtractException extends Error {
    detail: unknown;
    constructor(detail: unknown) {
      super("test");
      this.detail = detail;
    }
  },
}));

import { POST } from "@/app/api/template-brief/route";
import { NextRequest } from "next/server";

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("https://x/api/template-brief", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  extractMock.mockReset();
});

describe("POST /api/template-brief (JSON blob URL branch)", () => {
  it("rejects empty body with 400 invalid_request", async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid_request");
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("rejects non-string blobUrl with 400 invalid_request", async () => {
    const res = await POST(jsonReq({ blobUrl: 123 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects malformed URL with 400 invalid_request", async () => {
    const res = await POST(jsonReq({ blobUrl: "not-a-url" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects non-vercel-storage hostname with 400 url_denied (post-Zod allowlist)", async () => {
    // Phase 2 起改用 lib allowlist：旧 `isVercelBlobUrl` inline 已删，error 字符串
    // 从 `invalid_blob_url` 统一为 `url_denied`（W3 B2 verdict，不暴露 reason）
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await POST(
        jsonReq({ blobUrl: "https://evil.com/x.pdf", fileName: "x.pdf" }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("url_denied");
      // server log 写完整 url + reason 方便后续 grep（VERCEL_BLOB_PRESET 拒
      // evil.com 在 host_denied，不在 scheme_denied/private_ip）
      const warned = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(
        warned.some(
          (m) =>
            m.includes("evil.com") &&
            m.includes("host_denied") &&
            m.includes("route=template-brief"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects fileName exceeding 255 chars", async () => {
    const longName = "a".repeat(256);
    const res = await POST(
      jsonReq({
        blobUrl: "https://x.public.blob.vercel-storage.com/a.pdf",
        fileName: longName,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects invalid JSON body with 400 invalid_json", async () => {
    const req = new NextRequest("https://x/api/template-brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
  });
});
