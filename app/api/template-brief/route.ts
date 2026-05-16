import { NextRequest, NextResponse } from "next/server";
import {
  extractBriefFromPDF,
  BriefExtractException,
  type ExtractedBrief,
} from "@/lib/template-review/brief-extract";
import {
  createUrlAllowlist,
  fetchWithAllowlist,
  UrlAllowlistError,
  VERCEL_BLOB_PRESET,
} from "@/lib/url-allowlist";
import {
  createRateLimiter,
  withRateLimit,
  clientIp,
  ANON_AI_HEAVY,
} from "@/lib/rate-limit";
import { TemplateBriefJsonBodySchema } from "./schema";

/**
 * P3 #2 phase 2：模块作用域单实例。Allowlist 实例无内部状态，跨请求复用安全，
 * 省每请求一次 Zod 校验开销。VERCEL_BLOB_PRESET 强制 https + 阻私有 IP +
 * `*.public.blob.vercel-storage.com` 后缀匹配（含根域 + 子域）。
 */
const URL_ALLOWLIST = createUrlAllowlist(VERCEL_BLOB_PRESET);

// P3 #3 phase 2: ANON_AI_HEAVY (10/10m sliding) —— Claude PDF brief extract。
const RATE_LIMITER = createRateLimiter({
  identifier: "template-brief",
  ...ANON_AI_HEAVY,
});

export const runtime = "nodejs";
export const maxDuration = 300;

const MULTIPART_MAX_BYTES = 4 * 1024 * 1024;
const BLOB_MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED_MIME = ["application/pdf"];

type SuccessResponse = {
  ok: true;
  extracted: ExtractedBrief;
  meta: {
    fileName: string;
    sizeBytes: number;
    modelId: string;
  };
};

type ErrorResponse = {
  ok: false;
  error: string;
  message: string;
  detail?: unknown;
};

function errResponse(
  status: number,
  error: string,
  message: string,
  detail?: unknown,
): NextResponse<ErrorResponse> {
  return NextResponse.json({ ok: false, error, message, detail }, { status });
}

type LoadResult =
  | { ok: true; buffer: Buffer; fileName: string; sizeBytes: number }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      /** Phase 3.5: when set, impl adds `Retry-After: <N>` header（dns_resolve_failed transient） */
      retryAfterSec?: number;
    };

async function loadFromMultipart(req: NextRequest): Promise<LoadResult> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    return {
      ok: false,
      status: 400,
      error: "invalid_form",
      message: (e as Error).message,
    };
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return {
      ok: false,
      status: 400,
      error: "missing_file",
      message: "form field 'file' is required",
    };
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_mime",
      message: `only PDF allowed, got ${file.type || "unknown"}`,
    };
  }
  if (file.size > MULTIPART_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "too_large",
      message: `direct upload limit is ${MULTIPART_MAX_BYTES} bytes; use Blob upload for larger files`,
    };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return { ok: true, buffer, fileName: file.name, sizeBytes: file.size };
}

async function loadFromBlobUrl(req: NextRequest): Promise<LoadResult> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      status: 400,
      error: "invalid_json",
      message: "expected JSON with blobUrl and fileName",
    };
  }
  const parsed = TemplateBriefJsonBodySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      message: "request body failed schema validation",
    };
  }
  const { blobUrl } = parsed.data;
  const fileName = parsed.data.fileName ?? "brief.pdf";
  // P3 #2 phase 2 + phase 3.5 (2026-05-15)：fetchWithAllowlist 统一 sync deny + DNS
  // rebinding 防御 + 实际 fetch（undici Pool with resolved-IP + SNI），单 helper 调用。
  // Caller error mapping per W3 verdict 5357c41 §C:
  //   - sync deny (invalid_url / scheme_denied / host_denied / private_ip): 400 url_denied
  //     + console.warn（user fix request can resolve）
  //   - dns_resolve_failed: 502 dns_resolve_failed + Retry-After: 5（transient,可重试）
  //   - resolved_private_ip: 400 url_denied + console.error（**security event** SSRF probe,
  //     运维必须知道,但 response 用 url_denied 与 host_denied 同 enum 防 SSRF probe）
  let blobRes: Response;
  try {
    blobRes = await fetchWithAllowlist(blobUrl, URL_ALLOWLIST);
  } catch (e) {
    if (e instanceof UrlAllowlistError) {
      if (e.reason === "dns_resolve_failed") {
        console.warn(
          `[url-allowlist] dns_resolve_failed url=${blobUrl} cause=${e.cause ?? "?"} route=template-brief`,
        );
        return {
          ok: false,
          status: 502,
          error: "dns_resolve_failed",
          message: "无法解析 URL（DNS 解析失败），稍后重试",
          retryAfterSec: 5,
        };
      }
      if (e.reason === "resolved_private_ip") {
        // SECURITY EVENT: DNS rebinding 尝试。response 与 host_denied 同 enum 防 SSRF probe，
        // server log 用 error level（运维 alert 触发 desired）。
        console.error(
          `[url-allowlist] resolved_private_ip url=${blobUrl} resolvedIp=${e.resolvedIp ?? "?"} route=template-brief`,
        );
        return {
          ok: false,
          status: 400,
          error: "url_denied",
          message: "提供的 URL 不在允许列表中",
        };
      }
      // Sync deny reasons (invalid_url / scheme_denied / host_denied / private_ip)
      console.warn(
        `[url-allowlist] denied url=${blobUrl} reason=${e.reason} route=template-brief`,
      );
      return {
        ok: false,
        status: 400,
        error: "url_denied",
        message: "提供的 URL 不在允许列表中",
      };
    }
    return {
      ok: false,
      status: 502,
      error: "blob_fetch_failed",
      message: (e as Error).message,
    };
  }
  if (!blobRes.ok) {
    return {
      ok: false,
      status: 502,
      error: "blob_fetch_failed",
      message: `blob fetch returned ${blobRes.status}`,
    };
  }
  const contentType = blobRes.headers.get("content-type") || "";
  if (!contentType.includes("application/pdf")) {
    return {
      ok: false,
      status: 400,
      error: "invalid_mime",
      message: `blob content-type is ${contentType || "unknown"}, expected application/pdf`,
    };
  }
  const buffer = Buffer.from(await blobRes.arrayBuffer());
  if (buffer.length > BLOB_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "too_large",
      message: `file size ${buffer.length} exceeds limit ${BLOB_MAX_BYTES}`,
    };
  }
  return { ok: true, buffer, fileName, sizeBytes: buffer.length };
}

async function impl(
  req: NextRequest,
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  const contentType = req.headers.get("content-type") || "";
  const loaded = contentType.includes("application/json")
    ? await loadFromBlobUrl(req)
    : await loadFromMultipart(req);

  if (!loaded.ok) {
    const res = errResponse(loaded.status, loaded.error, loaded.message);
    if (loaded.retryAfterSec) {
      res.headers.set("Retry-After", String(loaded.retryAfterSec));
    }
    return res;
  }

  try {
    const extracted = await extractBriefFromPDF(loaded.buffer);
    return NextResponse.json({
      ok: true,
      extracted,
      meta: {
        fileName: loaded.fileName,
        sizeBytes: loaded.sizeBytes,
        modelId:
          process.env.ANTHROPIC_HAIKU_MODEL || "claude-haiku-4-5-20251001",
      },
    });
  } catch (e) {
    if (e instanceof BriefExtractException) {
      const detail = e.detail;
      if (detail.kind === "too_many_pages") {
        return errResponse(
          422,
          "too_many_pages",
          `PDF has ${detail.pages} pages, max 30`,
          detail,
        );
      }
      if (detail.kind === "empty_text") {
        return errResponse(
          422,
          "empty_text",
          "PDF text is empty or too short — likely a scanned/image PDF. Please upload a text-based PDF.",
          detail,
        );
      }
      if (detail.kind === "parse_failed") {
        return errResponse(422, "parse_failed", detail.message, detail);
      }
      if (detail.kind === "llm_failed") {
        return errResponse(500, "llm_failed", detail.message, detail);
      }
    }
    console.error("[template-brief] unexpected error:", e);
    return errResponse(500, "internal", (e as Error).message);
  }
}

export const POST = withRateLimit(RATE_LIMITER, clientIp, impl);
