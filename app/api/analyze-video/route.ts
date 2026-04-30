import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeVideo } from "@/lib/video/analyze";

export const runtime = "nodejs";
export const maxDuration = 300;

const RequestSchema = z.object({
  videoUrl: z.string().url(),
  topic: z.string().min(1).max(200),
  audience: z.string().max(200).optional().default(""),
  scene: z.string().max(200).optional().default(""),
});

export async function POST(req: NextRequest) {
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

  try {
    const reviewInput = await analyzeVideo(parsed.data);
    return NextResponse.json(reviewInput);
  } catch (e) {
    console.error("[analyze-video] error:", e);
    return NextResponse.json(
      { error: "analyze_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
