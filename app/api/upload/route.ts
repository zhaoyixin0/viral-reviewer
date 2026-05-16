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
 * Vercel Blob client-direct upload token endpoint.
 *
 * 浏览器调用 @vercel/blob/client 的 upload()，它先 POST 到这里换签名 token，
 * 然后用 token 直接 PUT 到 Blob（绕过 Next.js function 的 4.5MB body 限制）。
 *
 * P5.1.a-4: handleUpload 集成搬进 @/lib/storage facade。GCS swap (P5.1.b)
 * 时 route 一行不动；facade 内部把 Vercel handleUpload 换成 GCS v4 signed POST URL。
 */
async function impl(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error: "blob_not_configured",
        message: "Set BLOB_READ_WRITE_TOKEN in .env.local",
      },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(await handleSignedUpload(req, POLICY));
  } catch (e) {
    // 400 路径：req.json() parse fail 或 clientPayload schema reject。
    // 不回 message 防 schema 内部错信息泄露（zod error 含字段路径但仍偏服务端实现细节）。
    if (e instanceof InvalidUploadBodyError) {
      return NextResponse.json({ error: "invalid_upload_body" }, { status: 400 });
    }
    // 500 路径：StorageError("signed_upload_failed") 或未预期错。
    // StorageError 显式 log code+cause（a-3 followup 模式）让 ops 看到根因。
    if (e instanceof StorageError) {
      console.error(
        `[upload] error code=${e.code} message=${e.message}`,
        "cause:",
        e.cause,
      );
    } else {
      console.error("[upload] error:", e);
    }
    // 固定文案不透 (e as Error).message —— facade 内部错前缀会泄实现细节
    // (typescript-reviewer 2026-05-15 a-4 commit 2 MED)。详情进 console.error 给 ops。
    return NextResponse.json(
      { error: "upload_failed", message: "上传失败，请稍后重试" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(RATE_LIMITER, clientIp, impl);
