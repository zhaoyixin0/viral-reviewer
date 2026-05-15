import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import {
  createRateLimiter,
  withRateLimit,
  clientIp,
  STRICT_PER_IP,
} from "@/lib/rate-limit";
import { ClientPayloadSchema } from "./schema";

export const runtime = "nodejs";
export const maxDuration = 60;

// P3 #3 phase 2: STRICT_PER_IP (10/1m sliding) —— Blob token 换签端点 (PDF brief)。
const RATE_LIMITER = createRateLimiter({
  identifier: "template-brief-upload",
  ...STRICT_PER_IP,
});

const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Vercel Blob client-direct upload token endpoint for PDF brief documents.
 *
 * 前端调 @vercel/blob/client 的 upload()，先 POST 这里换签名 token，
 * 再用 token 直接 PUT 到 Blob —— 绕过 Next.js function 4.5MB body 限制，支持 100MB。
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

  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // P3 hardening #1：clientPayload 防御性校验。当前 schema 强制为 null —— 任何
        // 字符串负载会 throw，handleUpload 回 400。未来要消费 clientPayload 必须先扩 schema。
        const parsed = ClientPayloadSchema.safeParse(clientPayload);
        if (!parsed.success) {
          throw new Error("clientPayload not accepted by this endpoint");
        }
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        // tokenPayload 未消费：onBeforeGenerateToken 已通过 schema 拒绝任何字符串
        // 负载，handleUpload 默认 tokenPayload = clientPayload = null。
        console.log("[brief-upload] completed:", blob.url);
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    console.error("[brief-upload] error:", e);
    return NextResponse.json(
      { error: "upload_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(RATE_LIMITER, clientIp, impl);
