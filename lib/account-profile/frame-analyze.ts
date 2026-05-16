import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { extractFramesAndAudio, cleanupWorkspace } from "@/lib/video/ffmpeg";
import { UrlAllowlistError, type UrlAllowlist } from "@/lib/url-allowlist";
import type { AccountFrameInsight } from "./types";

const FRAME_VISION_SYSTEM = `你是 TikTok / Instagram Reels 创作者画像分析师。
我会给你 N 张按时间顺序排列的抽样帧（来自一条该创作者的爆款视频）。
请分析这位创作者的镜头语言、钩子风格、节奏特点。

仅返回 JSON（不要 markdown 包裹）：

{
  "description": "整支视频 80 字内描述（主体 / 场景 / 故事进展）",
  "hookSeconds": "前 0-3s 的钩子具体做法（视觉 / 主体 / 文字）",
  "shotLanguage": "镜头语言一句话（景别 / 运镜 / 构图）",
  "pacing": "节奏特点一句话（剪辑密度 / 字幕节拍 / BGM 卡点习惯）"
}`;

type ParsedFrameInsight = {
  description?: string;
  hookSeconds?: string;
  shotLanguage?: string;
  pacing?: string;
};

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
}

/**
 * 下载 top 1 视频 → 抽 5 帧 → Haiku Vision 分析镜头语言。
 *
 * 失败处理：任何环节 fail 都返回 null，让综合分析阶段降级为只用 cover + comments。
 * 常见失败：TikTok download URL 已过期 / IG videoUrl 无 CDN 权限 / ffmpeg 解码失败。
 */
export async function analyzeAccountTopVideo(
  videoUrl: string,
  videoId: string,
  opts: { urlAllowlist: UrlAllowlist; frameCount?: number },
): Promise<AccountFrameInsight | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  let workDir: string | null = null;
  try {
    const result = await extractFramesAndAudio(videoUrl, opts.frameCount ?? 5, {
      urlAllowlist: opts.urlAllowlist,
    });
    workDir = result.workDir;

    if (result.framesBase64.length === 0) {
      return null;
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const userContent: Anthropic.Messages.ContentBlockParam[] = [
      {
        type: "text",
        text: `视频时长 ${result.duration.toFixed(1)}s，下方 ${result.framesBase64.length} 张帧按时间顺序排列。`,
      },
      ...result.framesBase64.map((b64) => ({
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
      max_tokens: 800,
      system: FRAME_VISION_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });

    const block = response.content[0];
    const text = block?.type === "text" ? block.text : "";
    let parsed: ParsedFrameInsight;
    try {
      parsed = JSON.parse(stripCodeFence(text));
    } catch (e) {
      console.error(
        `[frame-analyze] JSON parse failed for ${videoId}:`,
        (e as Error).message,
      );
      return null;
    }

    return {
      videoId,
      description: parsed.description ?? "",
      hookSeconds: parsed.hookSeconds,
      shotLanguage: parsed.shotLanguage,
      pacing: parsed.pacing,
    };
  } catch (e) {
    // Phase 3.5 (W3 verdict 5357c41 §C): resolved_private_ip 是 security event,
    // log 用 error level + 记 resolvedIp 触发 ops alert（fail-soft 行为不变,仍返回
    // null,让 account-profile UI 退化到"无 frame 分析"而非整请求失败）。
    if (e instanceof UrlAllowlistError && e.reason === "resolved_private_ip") {
      console.error(
        `[frame-analyze] SECURITY: resolved_private_ip videoId=${videoId} url=${e.url} resolvedIp=${e.resolvedIp ?? "?"}`,
      );
    } else {
      console.error(
        `[frame-analyze] failed for ${videoId}:`,
        (e as Error).message,
      );
    }
    return null;
  } finally {
    if (workDir) await cleanupWorkspace(workDir);
  }
}
