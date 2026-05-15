import { NextRequest, NextResponse } from "next/server";
import {
  extractBriefFromPDF,
  BriefExtractException,
  type ExtractedBrief,
} from "@/lib/template-review/brief-extract";
import { TemplateBriefJsonBodySchema } from "./schema";

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
  | { ok: false; status: number; error: string; message: string };

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
  if (!isVercelBlobUrl(blobUrl)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_blob_url",
      message: "blobUrl must be a vercel-storage.com URL",
    };
  }
  let blobRes: Response;
  try {
    blobRes = await fetch(blobUrl);
  } catch (e) {
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

function isVercelBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  const contentType = req.headers.get("content-type") || "";
  const loaded = contentType.includes("application/json")
    ? await loadFromBlobUrl(req)
    : await loadFromMultipart(req);

  if (!loaded.ok) {
    return errResponse(loaded.status, loaded.error, loaded.message);
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
