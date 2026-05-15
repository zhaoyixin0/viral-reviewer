import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeVideo } from "@/lib/video/analyze";
import {
  createUrlAllowlist,
  VERCEL_BLOB_PRESET,
  UrlAllowlistError,
} from "@/lib/url-allowlist";
import {
  createRateLimiter,
  withRateLimit,
  clientIp,
  ANON_AI_HEAVY,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

const RequestSchema = z.object({
  videoUrl: z.string().url(),
  topic: z.string().min(1).max(200),
  audience: z.string().max(200).optional().default(""),
  scene: z.string().max(200).optional().default(""),
});

// P3 #3 phase 2: ANON_AI_HEAVY (10/10m sliding) —— Claude analyze + frame extract。
const RATE_LIMITER = createRateLimiter({
  identifier: "analyze-video",
  ...ANON_AI_HEAVY,
});

async function impl(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "anthropic_key_missing" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // P3 #2 phase 2: SSRF allowlist —— analyzeVideo 内部 extractFramesAndAudio
  // 在入口 check videoUrl，deny → 抛 UrlAllowlistError 到此处映射 400
  const urlAllowlist = createUrlAllowlist(VERCEL_BLOB_PRESET);
  try {
    const reviewInput = await analyzeVideo(parsed.data, { urlAllowlist });
    return NextResponse.json(reviewInput);
  } catch (e) {
    if (e instanceof UrlAllowlistError) {
      console.warn(
        `[url-allowlist] denied url=${e.url} reason=${e.reason} route=analyze-video`,
      );
      return NextResponse.json(
        { error: "url_denied", message: "提供的 URL 不在允许列表中" },
        { status: 400 },
      );
    }
    console.error("[analyze-video] error:", e);
    return NextResponse.json(
      { error: "analyze_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(RATE_LIMITER, clientIp, impl);
