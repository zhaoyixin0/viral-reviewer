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

// Phase 3.5: mock node:dns/promises + undici for fetchWithAllowlist
vi.mock("node:dns", async () => {
  const actual = await vi.importActual<typeof import("node:dns")>("node:dns");
  return {
    ...actual,
    promises: { resolve4: vi.fn(), resolve6: vi.fn() },
  };
});

const { mockPoolCtor } = vi.hoisted(() => {
  return { mockPoolCtor: vi.fn() };
});
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
import { _resetBackendForTests } from "@/lib/rate-limit/backend";
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
  resetDnsMocks(dns);
  mockPoolCtor.mockReset();
  // Phase 3.5: reset rate-limit memory backend each test 防止跨 test 累计 429
  _resetBackendForTests();
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
    const warnSpy = vi.spyOn(console, "log").mockImplementation(() => {});
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
            m.includes('"module":"api/template-brief"'),
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

  it("rejects http:// scheme on blob hostname with 400 url_denied (scheme_denied reason)", async () => {
    // 旧 inline isVercelBlobUrl 只校 hostname endsWith,不阻 http://；phase 2 起
    // VERCEL_BLOB_PRESET 强制 https:,模拟攻击者 host header injection 走 http
    const warnSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await POST(
        jsonReq({
          blobUrl: "http://x.public.blob.vercel-storage.com/a.pdf",
          fileName: "a.pdf",
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

  it("rejects literal private IP host with 400 url_denied (private_ip reason)", async () => {
    // 旧 inline 只 hostname.endsWith 不阻私有 IP；phase 2 阻 127.0.0.1
    // / 169.254.169.254（云元数据）/ ::1 等
    const warnSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await POST(
        jsonReq({
          blobUrl: "https://127.0.0.1/a.pdf",
          fileName: "a.pdf",
        }),
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

  it("rejects AWS metadata IP 169.254.169.254 with 400 url_denied", async () => {
    // 防御性回归 case：AWS / GCP metadata endpoint 是典型 SSRF 攻击目标
    const warnSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await POST(
        jsonReq({
          blobUrl: "https://169.254.169.254/latest/meta-data/",
          fileName: "x.pdf",
        }),
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
});

describe("POST /api/template-brief · phase 3.5 dns_resolve_failed + resolved_private_ip mapping", () => {
  it("dns_resolve_failed: 502 + Retry-After: 5 (transient, caller may retry)", async () => {
    const warnSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      mockDnsNxDomain(dns);
      const res = await POST(
        jsonReq({
          blobUrl: "https://nx.public.blob.vercel-storage.com/a.pdf",
          fileName: "a.pdf",
        }),
      );
      expect(res.status).toBe(502);
      expect(res.headers.get("Retry-After")).toBe("5");
      const body = await res.json();
      expect(body.error).toBe("dns_resolve_failed");
      // server warn 写完整 cause + url + route
      const warned = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(
        warned.some(
          (m) =>
            m.includes("dns_resolve_failed") &&
            m.includes("nx.public.blob.vercel-storage.com") &&
            m.includes('"module":"api/template-brief"'),
        ),
      ).toBe(true);
      // no actual Pool/fetch
      expect(mockPoolCtor).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("resolved_private_ip: 400 url_denied (防 SSRF probe) + console.error (security event)", async () => {
    const errSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      mockDnsResolve(
        dns,
        "evil.public.blob.vercel-storage.com",
        ["169.254.169.254"],
      );
      const res = await POST(
        jsonReq({
          blobUrl: "https://evil.public.blob.vercel-storage.com/x.pdf",
          fileName: "x.pdf",
        }),
      );
      expect(res.status).toBe(400);
      // No Retry-After (security event, not retryable)
      expect(res.headers.get("Retry-After")).toBeNull();
      const body = await res.json();
      // 与 host_denied 同 enum (防 SSRF probe per W3 phase 2 verdict B2)
      expect(body.error).toBe("url_denied");
      // server log 用 error level（运维 alert 触发 desired）
      const errored = errSpy.mock.calls.map((c) => String(c[0]));
      expect(
        errored.some(
          (m) =>
            m.includes("resolved_private_ip") &&
            m.includes("169.254.169.254") &&
            m.includes('"module":"api/template-brief"'),
        ),
      ).toBe(true);
      // no actual Pool/fetch (rejected before TCP)
      expect(mockPoolCtor).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});
