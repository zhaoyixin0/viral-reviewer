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

  it("rejects non-vercel-storage hostname with 400 invalid_blob_url (post-Zod allowlist)", async () => {
    const res = await POST(
      jsonReq({ blobUrl: "https://evil.com/x.pdf", fileName: "x.pdf" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    // Zod 语法过了,SSRF allowlist 拒绝
    expect(body.error).toBe("invalid_blob_url");
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
