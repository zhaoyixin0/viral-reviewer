import { NextRequest, NextResponse } from "next/server";
import {
  createRateLimiter,
  withRateLimit,
  clientIp,
  STRICT_PER_IP,
} from "@/lib/rate-limit";
import {
  handleSignedUpload,
  InvalidUploadBodyError,
  StorageError,
  type UploadPolicy,
} from "@/lib/storage";
import { ClientPayloadSchema } from "./schema";

export const runtime = "nodejs";

// P3 #3 phase 2: STRICT_PER_IP (10/1m fixed) —— Blob token 换签端点 (PDF brief)。
const RATE_LIMITER = createRateLimiter({
  identifier: "template-brief-upload",
  ...STRICT_PER_IP,
});

const POLICY: UploadPolicy = {
  logTag: "brief-upload",
  allowedContentTypes: ["application/pdf"],
  maxBytes: 100 * 1024 * 1024,
  addRandomSuffix: true,
  clientPayloadSchema: ClientPayloadSchema,
  onCompleted: async ({ url }) => {
    console.log("[brief-upload] completed:", url);
  },
};

/**
 * Client-direct upload signed-policy + completion endpoint for PDF brief
 * documents. See app/api/upload/route.ts for the full browser flow doc;
 * this route differs only in POLICY (allowedContentTypes / maxBytes / logTag).
 *
 * `BLOB_READ_WRITE_TOKEN` env check retired in P5.1.b-2 commit 4 — same
 * fail-fast path as /api/upload (`storage_not_configured` → 503 below).
 */
async function impl(req: NextRequest) {
  try {
    return NextResponse.json(await handleSignedUpload(req, POLICY));
  } catch (e) {
    return mapUploadError(e);
  }
}

/**
 * Same HTTP status mapping rules as /api/upload (W3 verdict 78b7d2f nit #6).
 * Duplicated (vs imported) because user-facing messages differ ("Brief"
 * prefix) and the log tag is different — extracting a generic helper would
 * couple the two routes' UX strings.
 */
function mapUploadError(e: unknown): NextResponse {
  if (e instanceof InvalidUploadBodyError) {
    return NextResponse.json({ error: "invalid_upload_body" }, { status: 400 });
  }
  if (e instanceof StorageError) {
    console.error(
      `[brief-upload] error code=${e.code} message=${e.message}`,
      "cause:",
      e.cause,
    );
    switch (e.code) {
      case "storage_not_configured":
        return NextResponse.json(
          { error: "storage_not_configured", message: "Brief 上传服务暂未配置，请稍后重试" },
          { status: 503 },
        );
      case "completion_token_invalid":
      case "completion_token_expired":
        return NextResponse.json(
          { error: e.code, message: "Brief 上传凭证已失效，请刷新页面重试" },
          { status: 401 },
        );
      case "completion_blob_mismatch":
        return NextResponse.json(
          { error: "completion_blob_mismatch", message: "Brief 上传校验失败" },
          { status: 400 },
        );
    }
  } else {
    console.error("[brief-upload] error:", e);
  }
  return NextResponse.json(
    { error: "upload_failed", message: "Brief 上传失败，请稍后重试" },
    { status: 500 },
  );
}

export const POST = withRateLimit(RATE_LIMITER, clientIp, impl);
