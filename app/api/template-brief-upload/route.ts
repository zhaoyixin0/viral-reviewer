import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Vercel Blob client-direct upload token endpoint for PDF brief documents.
 *
 * 前端调 @vercel/blob/client 的 upload()，先 POST 这里换签名 token，
 * 再用 token 直接 PUT 到 Blob —— 绕过 Next.js function 4.5MB body 限制，支持 100MB。
 */
export async function POST(req: NextRequest) {
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
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async ({ blob }) => {
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
