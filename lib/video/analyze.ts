import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createReadStream } from "fs";
import type { ReviewInputVideo } from "@/lib/review-engine/types";
import { extractFramesAndAudio, cleanupWorkspace } from "./ffmpeg";

const VISION_SYSTEM = `你是 TikTok 视频内容分析师。我会给你 N 张按时间顺序排列的抽样帧（来自一条短视频），你需要分析整支视频的：

- 开场 hook（前 0-3 秒最有可能的呈现方式）
- 主玩法（playStyle）：从下列选 1 个 — 前后对比、卡点变装、Tutorial 步骤、List 列表、POV 剧情、Day in the life、First time 反应、Prank 整蛊、声音玩梗、时间反差、价格对比、权威叙事、情感叙事、翻车反差、速览快剪、其他
- 视觉风格（visualStyle）：从下列选 1 个 — Cinematic 大片感、手持 vlog 感、电影感影调、高饱和霓虹、Top-down 俯拍美食、暖色家庭感、复古胶片感、其他
- 每帧的简要描述（镜头景别 + 主体 + 关键元素）

仅返回有效 JSON，不要 markdown 包裹：
{
  "detectedHook": "...",
  "detectedPlayStyle": "...",
  "detectedVisualStyle": "...",
  "frameSamples": [
    { "timestamp": 0, "description": "..." },
    ...
  ]
}`;

type VisionResult = {
  detectedHook: string;
  detectedPlayStyle: string;
  detectedVisualStyle: string;
  frameSamples: { timestamp: number; description: string }[];
};

async function analyzeFramesWithHaiku(
  framesBase64: string[],
  duration: number,
): Promise<VisionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const timestamps = framesBase64.map((_, i) => {
    if (framesBase64.length === 1) return duration / 2;
    return (duration * i) / (framesBase64.length - 1);
  });

  const userContent: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text" as const,
      text: `视频总时长 ${duration.toFixed(1)} 秒。下方是 ${
        framesBase64.length
      } 张按时间顺序的抽样帧（时间戳：${timestamps
        .map((t) => `${t.toFixed(1)}s`)
        .join(", ")}）。请按 system 要求分析。`,
    },
    ...framesBase64.map((b64) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: "image/jpeg" as const,
        data: b64,
      },
    })),
  ];

  const response = await client.messages.create({
    model: process.env.VISION_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: VISION_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const block = response.content[0];
  const text = block?.type === "text" ? block.text : "";
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const parsed = JSON.parse(clean) as VisionResult;

  // 兜底：补齐时间戳
  if (parsed.frameSamples) {
    parsed.frameSamples = parsed.frameSamples.map((s, i) => ({
      timestamp:
        typeof s.timestamp === "number" && !Number.isNaN(s.timestamp)
          ? s.timestamp
          : timestamps[i] ?? 0,
      description: s.description ?? "",
    }));
  } else {
    parsed.frameSamples = timestamps.map((t) => ({
      timestamp: t,
      description: "",
    }));
  }

  return parsed;
}

async function transcribeAudio(audioPath: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return ""; // Whisper 需要 OpenAI key；没有就跳过转录
  }
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await client.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: "whisper-1",
    });
    return r.text ?? "";
  } catch (e) {
    console.error("[transcribe] failed:", (e as Error).message);
    return "";
  }
}

export type AnalyzeVideoArgs = {
  videoUrl: string;
  topic: string;
  audience: string;
  scene: string;
};

export async function analyzeVideo(
  args: AnalyzeVideoArgs,
): Promise<ReviewInputVideo> {
  const { framesBase64, audioPath, duration, workDir } =
    await extractFramesAndAudio(args.videoUrl, 6);

  try {
    const [vision, transcript] = await Promise.all([
      analyzeFramesWithHaiku(framesBase64, duration),
      transcribeAudio(audioPath),
    ]);

    return {
      type: "video",
      topic: args.topic,
      audience: args.audience,
      scene: args.scene,
      videoFeatures: {
        duration,
        frameSamples: vision.frameSamples,
        transcript,
        detectedHook: vision.detectedHook,
        detectedPlayStyle: vision.detectedPlayStyle,
        detectedVisualStyle: vision.detectedVisualStyle,
      },
    };
  } finally {
    await cleanupWorkspace(workDir);
  }
}
