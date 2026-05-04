import { NextRequest, NextResponse } from "next/server";
import {
  extractBriefFromPDF,
  BriefExtractException,
  type ExtractedBrief,
} from "@/lib/template-review/brief-extract";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
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

export async function POST(
  req: NextRequest,
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    return errResponse(400, "invalid_form", (e as Error).message);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errResponse(400, "missing_file", "form field 'file' is required");
  }

  if (!ALLOWED_MIME.includes(file.type)) {
    return errResponse(
      400,
      "invalid_mime",
      `only PDF allowed, got ${file.type || "unknown"}`,
    );
  }

  if (file.size > MAX_BYTES) {
    return errResponse(
      413,
      "too_large",
      `file size ${file.size} exceeds limit ${MAX_BYTES}`,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const extracted = await extractBriefFromPDF(buffer);
    return NextResponse.json({
      ok: true,
      extracted,
      meta: {
        fileName: file.name,
        sizeBytes: file.size,
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
