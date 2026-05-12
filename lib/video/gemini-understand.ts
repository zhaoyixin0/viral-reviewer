import {
  GoogleGenAI,
  createPartFromUri,
  createUserContent,
} from "@google/genai";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";
import {
  normalizeTimeCode,
  parseGeminiTimestamp,
} from "@/lib/cut-plan/time-code";
import type { VideoMeta } from "./ffprobe-meta";

/**
 * Gemini 2.5 Pro 视频理解 → CutPlan IR
 *
 * Pipeline:
 *   1. ai.files.upload 上传本地视频到 Gemini File API
 *   2. 轮询直到状态变成 ACTIVE
 *   3. 用 generateContent + 严格 JSON schema 让 Gemini 输出 CutPlan
 *   4. parse + validate + 时间戳归一化
 *   5. 清理上传的文件
 */

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY not configured");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `你是 TikTok / Instagram Reels 内部视频技术分析师。
我会给你一段短视频。你需要把它解构成结构化的「剪辑计划 IR」JSON，覆盖：

1. 时序操作列表（actions）— 按时间从前到后排序
   - cut：镜头切换点。给出每个镜头的内容描述、切换前后的景别
   - transition：转场效果（whip_pan / match_cut / speed_ramp / fade / morph / zoom_blur / flash 等）
   - camera_move：镜头运动（push_in / pull_out / pan / tilt / tracking / handheld / dolly_zoom / orbit）。push_in 要给 scaleFrom 和 scaleTo
   - speed_change：变速/定格。给出 multiplier
   - effect：特效（glitch / chromatic_aberration / vhs / film_grain / overlay_emoji 等）
   - subtitle：字幕。给出文本、样式、动画

2. 音轨（bgm）
   - name：音乐名（看视频里有没有显示）
   - trending：是否 trending sound（TikTok 声音池标志，原创/翻拍多则为 true）
   - bpm：节拍数（粗估）
   - markers：beat / drop / vocal_in 等关键节拍位置（用于卡点分析）

3. 四大维度汇总（dimensions）
   - pacing：节奏（shotCount / avgShotDurationSec / cutDensityPerSec / rhythmProfile / keyTwistAt）
   - camera：镜头（dominantMovements / shotSizeDistribution / transitionPatterns）
   - audiovisual：视听（bgmPattern / bgmSyncTightness / subtitleStyle / colorGrade）
   - structure：结构（hookFormat / openingShot / endingShot / cta / payoffAt）

4. 技法密度（density）— 4 个 0-100 子分 + overall
   - editing：剪辑密度。镜头多、切换快、节奏紧凑 → 高分
   - transition：转场丰富度。用了多少种转场 + 频次 → 高分
   - effect：特效使用密度。特效次数 + 占时长比例 → 高分
   - bgmSync：BGM 同步度。卡点准确、用了 trending sound → 高分
   - overall：综合分（不是简单平均，要考虑各子项协同；用得越极致 → 越高）

5. 视频形态（videoFormat）— 重要！必须是以下之一：
   vlog / tutorial / transformation / skit / comedy / listicle / review / pov / interview / edit / ugc_native / other
   videoFormatConfidence：判定置信度 0-1

【时间戳约定】
- 所有 at 字段格式：{ "sec": 浮点秒数 }
- 不需要给 frame 字段（compiler 阶段会算）
- 时间戳必须从视频本身计算，精确到 0.1s

【输出要求】
- 返回严格 JSON，不要 markdown 包裹（不要 \`\`\`json）
- 所有字段必须填，未观察到就给合理推断（如未明显运动→camera_move: static, 0-duration）
- shotCount 必须精确，逐镜头识别后给出
- density 分数要客观区分"靠技术火 vs 靠内容火"——纯讲解、静态画面、长镜头 = 低 editing/transition；快剪卡点变装 = 高分
`;

const RESPONSE_SCHEMA_HINT = `
严格 JSON 输出 schema（示例结构，字段不可少；ts comment 仅说明）：
{
  "videoId": "用我传入的 id",
  "durationSec": 25.0,
  "fps": 30,
  "resolution": { "width": 1080, "height": 1920 },
  "videoFormat": "vlog",
  "videoFormatConfidence": 0.92,
  "actions": [
    { "kind": "cut", "at": { "sec": 0 }, "toShotSize": "wide", "shotDescription": "海滩日落广角" },
    { "kind": "camera_move", "at": { "sec": 0 }, "type": "push_in", "durationSec": 2.0, "scaleFrom": 1.0, "scaleTo": 1.15, "easing": "ease_out" },
    { "kind": "subtitle", "at": { "sec": 0.5 }, "text": "你必须看的日落", "durationSec": 2.0, "style": { "position": "center", "animation": "fade_in" } },
    { "kind": "cut", "at": { "sec": 2.5 }, "fromShotSize": "wide", "toShotSize": "medium", "shotDescription": "..." },
    { "kind": "transition", "at": { "sec": 2.5 }, "type": "whip_pan", "durationFrames": 6 }
  ],
  "bgm": {
    "name": "Sunset Lover - Petit Biscuit (trending)",
    "trending": true,
    "bpm": 90,
    "startsAt": { "sec": 0 },
    "markers": [
      { "at": { "sec": 3 }, "kind": "drop" },
      { "at": { "sec": 12 }, "kind": "beat" }
    ]
  },
  "dimensions": {
    "pacing": { "shotCount": 14, "avgShotDurationSec": 1.78, "cutDensityPerSec": 0.56, "rhythmProfile": "medium", "keyTwistAt": { "sec": 12 } },
    "camera": { "dominantMovements": ["push_in", "static"], "shotSizeDistribution": { "extreme_close_up": 0, "close_up": 2, "medium": 5, "wide": 6, "extreme_wide": 1 }, "transitionPatterns": ["hard_cut", "whip_pan", "match_cut"] },
    "audiovisual": { "bgmPattern": "Trending sound 前奏 0-3s + drop 卡点", "bgmSyncTightness": "tight", "subtitleStyle": "centered_minimal", "colorGrade": "高饱和暖调日落" },
    "structure": { "hookFormat": "visual_contrast", "openingShot": "海滩广角推近", "endingShot": "落日特写", "payoffAt": { "sec": 12 } }
  },
  "density": { "editing": 62, "transition": 70, "effect": 30, "bgmSync": 85, "overall": 67 }
}
`;

export type GeminiUnderstandInput = {
  /** 本地视频路径（File API 上传用） */
  videoPath: string;
  videoId: string;
  /** 从 ffprobe 拿到的硬指标，会回填进 CutPlan */
  meta: VideoMeta;
  /** 用户已知的元数据（爆款 URL / 标题等），帮助 Gemini 判断 trending sound 等 */
  hints?: {
    sourceUrl?: string;
    knownTitle?: string;
    knownBgm?: string;
    knownTags?: string[];
  };
};

export async function understandVideoAsCutPlan(
  input: GeminiUnderstandInput,
): Promise<CutPlan> {
  const ai = getClient();
  const model = process.env.GEMINI_VIDEO_MODEL || "gemini-2.5-pro";

  // 1) 上传到 File API
  const uploaded = await ai.files.upload({
    file: input.videoPath,
    config: { mimeType: "video/mp4" },
  });

  if (!uploaded.name) {
    throw new Error("Gemini file upload returned no name");
  }

  try {
    // 2) 轮询直到 ACTIVE
    let file = uploaded;
    let attempts = 0;
    while (file.state === "PROCESSING") {
      attempts++;
      if (attempts > 60) {
        throw new Error("Gemini file processing timed out (>5min)");
      }
      await new Promise((r) => setTimeout(r, 5000));
      file = await ai.files.get({ name: file.name as string });
    }
    if (file.state === "FAILED") {
      throw new Error("Gemini file processing failed");
    }
    if (!file.uri || !file.mimeType) {
      throw new Error("Gemini file has no uri/mimeType after processing");
    }

    // 3) 调用 generateContent
    const userPrompt = [
      `video_id_for_output: "${input.videoId}"`,
      input.hints?.sourceUrl ? `source_url: ${input.hints.sourceUrl}` : "",
      input.hints?.knownTitle ? `known_title: ${input.hints.knownTitle}` : "",
      input.hints?.knownBgm ? `known_bgm: ${input.hints.knownBgm}` : "",
      input.hints?.knownTags?.length
        ? `known_tags: ${input.hints.knownTags.join(", ")}`
        : "",
      "",
      RESPONSE_SCHEMA_HINT,
      "",
      "请分析此视频，返回严格 JSON CutPlan。",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await ai.models.generateContent({
      model,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.3,
      },
      contents: createUserContent([
        createPartFromUri(file.uri, file.mimeType),
        userPrompt,
      ]),
    });

    const text = response.text ?? "";
    if (!text.trim()) {
      throw new Error("Gemini returned empty response");
    }

    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");

    const raw = JSON.parse(cleaned);

    // 回填硬指标 + 元信息（这些用 ffprobe / 我们这边的真值，不信 Gemini 的估算）
    const enriched = {
      ...raw,
      videoId: input.videoId,
      durationSec: input.meta.durationSec,
      fps: input.meta.fps,
      resolution: {
        width: input.meta.width,
        height: input.meta.height,
      },
      meta: {
        model,
        analyzedAt: new Date().toISOString(),
        sourceUrl: input.hints?.sourceUrl,
      },
    };

    // 4) 时间戳归一化（补 frame 字段）
    const normAt = (raw: unknown): unknown => {
      if (raw && typeof raw === "object") {
        const at = raw as { sec?: number; frame?: number };
        if (typeof at.sec === "number") {
          return normalizeTimeCode(
            { sec: at.sec, frame: at.frame },
            input.meta.fps,
          );
        }
      }
      return raw;
    };

    if (Array.isArray(enriched.actions)) {
      enriched.actions = enriched.actions.map((a: { at?: unknown }) => ({
        ...a,
        at: normAt(a.at),
      }));
    }
    if (enriched.bgm?.markers && Array.isArray(enriched.bgm.markers)) {
      enriched.bgm.markers = enriched.bgm.markers.map(
        (m: { at?: unknown }) => ({ ...m, at: normAt(m.at) }),
      );
    }

    // 5) 严格 Zod 验证
    const parsed = CutPlanSchema.parse(enriched);
    return parsed;
  } finally {
    // 6) 清理上传的文件
    try {
      if (uploaded.name) {
        await ai.files.delete({ name: uploaded.name });
      }
    } catch (e) {
      console.warn(
        "[gemini-understand] file cleanup failed:",
        (e as Error).message,
      );
    }
  }
}

/**
 * 工具函数：从 Gemini 输出的字符串时间戳（"MM:SS"）补救
 * 当 Gemini 偶尔不按 {sec} 输出时使用
 */
export function coerceTimestampInput(raw: unknown, fps: number): unknown {
  if (typeof raw === "string") {
    try {
      const sec = parseGeminiTimestamp(raw);
      return normalizeTimeCode({ sec }, fps);
    } catch {
      return raw;
    }
  }
  return raw;
}
