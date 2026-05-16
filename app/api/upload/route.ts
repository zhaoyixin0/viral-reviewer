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

// P3 #3 phase 2: STRICT_PER_IP (10/1m sliding) —— Blob token 换签端点,
// 实际 upload 走 Blob SDK 自身限流,本路由仅签名生成,STRICT 防 token 滥发。
const RATE_LIMITER = createRateLimiter({
  identifier: "upload",
  ...STRICT_PER_IP,
});

const POLICY: UploadPolicy = {
  logTag: "upload",
  allowedContentTypes: [
    "video/mp4",
    "video/quicktime",
    "video/x-m4v",
    "video/webm",
    // Phase 5.5: BGM 上传支持
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/m4a",
    "audio/x-m4a",
    "audio/mp4",
    "audio/aac",
  ],
  maxBytes: 200 * 1024 * 1024,
  addRandomSuffix: true,
  clientPayloadSchema: ClientPayloadSchema,
  onCompleted: async ({ url }) => {
    console.log("[upload] completed:", url);
  },
};

/**
 * Client-direct upload signed-policy + completion endpoint.
 *
 * Browser flow (post-P5.1.b-2):
 *   1. POST {type:"generate-signed-url",...} → returns opaque envelope
 *      with GCS POST policy `url` + `fields` + HMAC `completionToken`.
 *   2. Browser POSTs multipart/form-data directly to GCS (bucket CORS allows).
 *   3. POST {type:"completion", completionToken, blobInfo} → verify + fire
 *      policy.onCompleted (D3 swallow + log).
 *
 * `BLOB_READ_WRITE_TOKEN` env check retired in P5.1.b-2 commit 4: the
 * lib now fail-fasts via `requireUploadSecret()` (UPLOAD_SIGNING_SECRET)
 * + `requireBucket()` (GCS_BUCKET_NAME), surfaced here as
 * `storage_not_configured` → 503 below.
 */
async function impl(req: NextRequest) {
  try {
    return NextResponse.json(await handleSignedUpload(req, POLICY));
  } catch (e) {
    return mapUploadError(e);
  }
}

/**
 * Map storage errors to HTTP status per W3 verdict 78b7d2f nit #6:
 *   - invalid_upload_body         → 400 (parse / schema / contentType / allowlist)
 *   - completion_blob_mismatch    → 400 (cross-bucket / wrong-key blobInfo)
 *   - completion_token_invalid    → 401 (HMAC mismatch / tampered)
 *   - completion_token_expired    → 401 (TTL exceeded)
 *   - storage_not_configured      → 503 (env missing — ops-level failure)
 *   - all others (signed_upload_failed, unknown)  → 500
 *
 * Response shape: `{error: <code>, message?: <user-facing>}`. Message is
 * fixed text per upload-route to avoid leaking facade internals (per
 * typescript-reviewer 2026-05-15 a-4 commit 2 MED). Full code+cause goes
 * to console.error for ops triage (a-3 followup pattern).
 */
function mapUploadError(e: unknown): NextResponse {
  if (e instanceof InvalidUploadBodyError) {
    return NextResponse.json({ error: "invalid_upload_body" }, { status: 400 });
  }
  if (e instanceof StorageError) {
    console.error(
      `[upload] error code=${e.code} message=${e.message}`,
      "cause:",
      e.cause,
    );
    switch (e.code) {
      case "storage_not_configured":
        return NextResponse.json(
          { error: "storage_not_configured", message: "上传服务暂未配置，请稍后重试" },
          { status: 503 },
        );
      case "completion_token_invalid":
      case "completion_token_expired":
        return NextResponse.json(
          { error: e.code, message: "上传凭证已失效，请刷新页面重试" },
          { status: 401 },
        );
      case "completion_blob_mismatch":
        return NextResponse.json(
          { error: "completion_blob_mismatch", message: "上传校验失败" },
          { status: 400 },
        );
    }
  } else {
    console.error("[upload] error:", e);
  }
  return NextResponse.json(
    { error: "upload_failed", message: "上传失败，请稍后重试" },
    { status: 500 },
  );
}

export const POST = withRateLimit(RATE_LIMITER, clientIp, impl);
