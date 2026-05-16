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
export const maxDuration = 60;

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
 * Vercel Blob client-direct upload token endpoint for PDF brief documents.
 *
 * 前端调 @vercel/blob/client 的 upload()，先 POST 这里换签名 token，
 * 再用 token 直接 PUT 到 Blob —— 绕过 Next.js function 4.5MB body 限制，支持 100MB。
 *
 * P5.1.a-4: handleUpload 集成搬进 @/lib/storage facade。GCS swap (P5.1.b)
 * 时 route 一行不动；facade 内部把 Vercel handleUpload 换成 GCS v4 signed POST URL。
 */
async function impl(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error: "blob_not_configured",
        message: "Set BLOB_READ_WRITE_TOKEN in env",
      },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(await handleSignedUpload(req, POLICY));
  } catch (e) {
    if (e instanceof InvalidUploadBodyError) {
      return NextResponse.json({ error: "invalid_upload_body" }, { status: 400 });
    }
    if (e instanceof StorageError) {
      console.error(
        `[brief-upload] error code=${e.code} message=${e.message}`,
        "cause:",
        e.cause,
      );
    } else {
      console.error("[brief-upload] error:", e);
    }
    // 固定文案不透 (e as Error).message —— facade 内部错前缀会泄实现细节
    // (typescript-reviewer 2026-05-15 a-4 commit 2 MED)。详情进 console.error 给 ops。
    return NextResponse.json(
      { error: "upload_failed", message: "Brief 上传失败，请稍后重试" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(RATE_LIMITER, clientIp, impl);
