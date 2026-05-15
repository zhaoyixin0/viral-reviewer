import {
  GoogleGenAI,
  createPartFromUri,
  createUserContent,
} from "@google/genai";
import { z } from "zod";
import {
  MaterialPotentialSchema,
  type MaterialPotential,
  CutPointCandidateSchema,
  PushInOpportunitySchema,
  MatchCutCandidateSchema,
  BeatSlotSchema,
  RhythmRangeSchema,
  ColorContrastPotentialSchema,
  SubtitleSlotSchema,
  MetaphorHookSchema,
  SceneTransitionCandidateSchema,
} from "@/lib/cut-plan/material-potential";
import { CutPlanSchema, type CutPlan } from "@/lib/cut-plan/schema";
import { normalizeTimeCode } from "@/lib/cut-plan/time-code";
import type { VideoMeta } from "./ffprobe-meta";

/**
 * Gemini 2.5 Pro · 用户视频「可塑性」分析（两阶段 pipeline）
 *
 * Stage 1: 视频 → CutPlan IR（客观结构，复用 Phase 1 已验证的 prompt）
 * Stage 2: 视频 + CutPlan 摘要 → potential 8 维 + adaptabilitySummary
 *
 * 优点：
 *   - 复用上传的 File API URI（单次上传，双 LLM 调用）
 *   - Schema 任务清晰分离，命中率更高
 *   - 可独立调试两阶段
 */

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY not configured");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// ============ Stage 1 system prompt（同 Phase 1 的 understand 模块）============

const STAGE1_SYSTEM = `你是 TikTok / Instagram Reels 视频技术分析师。
我会给你一段视频。请按 CutPlan IR schema 输出客观结构 JSON：

1. videoFormat — vlog / tutorial / transformation / skit / comedy / listicle / review / pov / interview / edit / ugc_native / other
2. videoFormatConfidence — 0-1
3. actions — 时序列表，每个元素必须用 kind 字段（不是 type）:
   - { "kind": "cut", "at": {"sec": x}, "toShotSize": "...", "shotDescription": "..." }
   - { "kind": "camera_move", "at": {"sec": x}, "type": "push_in|pull_out|pan_*|tilt_*|tracking|handheld|dolly_zoom|orbit|static|other", "durationSec": x, "scaleFrom": x, "scaleTo": x, "easing": "linear|ease_in|ease_out|ease_in_out" }
   - { "kind": "transition", "at": {"sec": x}, "type": "hard_cut|whip_pan|match_cut|speed_ramp|fade|cross_dissolve|morph|zoom_blur|flash|other", "durationFrames": x }
   - { "kind": "speed_change", "at": {"sec": x}, "multiplier": x, "durationSec": x }
   - { "kind": "effect", "at": {"sec": x}, "type": "...", "durationSec": x }
   - { "kind": "subtitle", "at": {"sec": x}, "text": "...", "durationSec": x, "style": {...} }
4. bgm — { name, trending, bpm, startsAt: {sec}, markers: [{at: {sec}, kind: "beat|drop|vocal_in|vocal_phrase|...", note}] }
5. dimensions — 4 个对象（不是字符串！）：
   - pacing: { shotCount, avgShotDurationSec, cutDensityPerSec, rhythmProfile: "fast_cut|medium|slow_burn|mixed|slow|...", keyTwistAt: {sec} | null }
   - camera: { dominantMovements: [...], shotSizeDistribution: { extreme_close_up, close_up, medium, wide, extreme_wide }, transitionPatterns: [...] }
   - audiovisual: { bgmPattern, bgmSyncTightness: "loose|moderate|tight|thematic|...", subtitleStyle, colorGrade }
   - structure: { hookFormat, openingShot, endingShot, cta, payoffAt: {sec} | null }
6. density — 5 个 0-100 数字（不是字符串！）：editing / transition / effect / bgmSync / overall

【强制规则】
- 时序操作必须用 "kind" 字段（不是 "type"）
- 时间戳必须用 "at": { "sec": 浮点 } 格式（不是 from/to）
- dimensions.* 必须是对象，不能是字符串
- density.* 必须是 0-100 数字，不能是字符串
- 返回严格 JSON，不要 markdown 包裹`;

// ============ Stage 2 system prompt（potential 推理）============

const STAGE2_SYSTEM = `你是 TikTok / Instagram Reels 资深剪辑师 + 内容策略师。

我会给你：
1. 一段视频（用户的创作素材）
2. 这段视频的客观结构分析（CutPlan JSON）

请基于这两个输入，推理「这段素材还能变成什么样」。这是剪辑师思维：不是描述视频"现在什么样"，而是判断"还能改造成什么样"。

【你必须输出的 JSON 结构】

{
  "potential": {
    "cutPoints": [
      {
        "at": {"sec": x},
        "reason": "...",
        "suitableTechniques": ["hard_cut", "match_cut", ...],
        "confidence": 0.0-1.0
      },
      ... (5-15 个候选切点)
    ],
    "pushInOpportunities": [
      {
        "at": {"sec": x},
        "durationSec": x,
        "subject": "...",
        "recommendedScale": {"from": 1.0, "to": 1.25},
        "confidence": 0.0-1.0
      },
      ... (可为空数组)
    ],
    "matchCutCandidates": [
      {
        "fromAt": {"sec": x},
        "toAt": {"sec": x},
        "fromShot": "...",
        "toShot": "...",
        "matchBasis": "构图 / 主体位置 / 动作 / 颜色 / 形状",
        "contrastDimension": "环境 / 光线 / 情绪 / 时间",
        "confidence": 0.0-1.0
      },
      ... (可为空数组，vlog 类视频通常没有)
    ],
    "beatSlots": [
      {
        "at": {"sec": x},
        "kind": "beat|drop|vocal_in|vocal_phrase|hit|silence_break",
        "intensity": "subtle|moderate|strong",
        "suitableFor": ["cut", "whip_pan", "effect_in", ...]
      },
      ...
    ],
    "rhythmRange": {
      "current": "当前节奏画像",
      "minShotDurationSec": 0.5,
      "maxShotDurationSec": 6.0,
      "adaptableTo": ["fast_cut_montage", "slow_cinematic", ...],
      "bottleneck": "..." 或 null
    },
    "colorContrast": {
      "currentGrade": "...",
      "contrastPairs": [
        {
          "fromAt": {"sec": x},
          "toAt": {"sec": x},
          "contrast": "冷暖 / 明暗 / 饱和度 / ...",
          "recommendation": "..."
        }
      ],
      "globalAdjustments": ["cinematic_teal_orange", ...]
    },
    "subtitleSlots": [
      {
        "at": {"sec": x},
        "durationSec": x,
        "reason": "...",
        "suitableStyles": ["centered_minimal", "lyric_overlay", ...],
        "hasLyricOverlap": true|false
      }
    ],
    "metaphorHooks": [
      {
        "description": "画面与 BGM/歌词的隐喻关系（自由描述）",
        "anchorAt": {"sec": x},
        "bgmLyricFragment": "...歌词片段..." 或 null,
        "visualElement": "...",
        "amplifyHow": "如何放大这个隐喻"
      },
      ... (至少 1-3 个)
    ],
    "sceneTransitionCandidates": [
      {
        "scenes": [
          {"at": {"sec": x}, "durationSec": x, "description": "..."},
          ...
        ],
        "narrativeArc": "...",
        "recommendedTechnique": "..."
      }
    ]
  },
  "adaptabilitySummary": {
    "strengths": ["素材的优势 1", "素材的优势 2", ...],
    "limitations": ["素材的局限 1", "素材的局限 2", ...],
    "bestSuitedTechniques": ["最适合学的技法 1", ...],
    "notSuitableTechniques": ["明确不要学的技法 1", ...]
  }
}

【风格要求】
- 描述要具体到「在 X 秒做 Y 操作」级别
- 鼓励自由发明细颗粒标签（如 colorGrade 用 "vibrant_oceanic_blues"）
- metaphorHooks 是这一步最重要的创意维度，认真找画面与音轨歌词的意义关联
- 时间戳必须用 "at"/"fromAt"/"toAt"/"anchorAt"：{ "sec": 浮点 } 格式
- 严格 JSON，不要 markdown 包裹
- 不输出 base 或 videoId（caller 会合并）`;

// ============ 子 schemas ============

const PotentialBodySchema = z.object({
  cutPoints: z.array(CutPointCandidateSchema),
  pushInOpportunities: z.array(PushInOpportunitySchema),
  matchCutCandidates: z.array(MatchCutCandidateSchema),
  beatSlots: z.array(BeatSlotSchema),
  rhythmRange: RhythmRangeSchema,
  colorContrast: ColorContrastPotentialSchema,
  subtitleSlots: z.array(SubtitleSlotSchema),
  metaphorHooks: z.array(MetaphorHookSchema),
  sceneTransitionCandidates: z.array(SceneTransitionCandidateSchema),
});

const Stage2OutputSchema = z.object({
  potential: PotentialBodySchema,
  adaptabilitySummary: z.object({
    strengths: z.array(z.string()),
    limitations: z.array(z.string()),
    bestSuitedTechniques: z.array(z.string()),
    notSuitableTechniques: z.array(z.string()),
  }),
});

// ============ 辅助：时间戳归一化 ============

function makeTimeCodeNormalizer(fps: number) {
  const normAt = (raw: unknown): unknown => {
    if (raw && typeof raw === "object") {
      const at = raw as { sec?: number; frame?: number };
      if (typeof at.sec === "number") {
        return normalizeTimeCode(
          { sec: at.sec, frame: at.frame },
          fps,
        );
      }
    }
    return raw;
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (
        (k === "at" ||
          k === "fromAt" ||
          k === "toAt" ||
          k === "anchorAt" ||
          k === "startsAt" ||
          k === "keyTwistAt" ||
          k === "payoffAt") &&
        obj[k] &&
        typeof obj[k] === "object"
      ) {
        obj[k] = normAt(obj[k]);
      } else if (typeof obj[k] === "object") {
        walk(obj[k]);
      }
    }
  };
  return walk;
}

async function dumpDebug(
  videoId: string,
  stage: string,
  raw: unknown,
  err: unknown,
): Promise<void> {
  try {
    const { writeFile, mkdir } = await import("fs/promises");
    const { join } = await import("path");
    const dir = join(process.cwd(), "data", "probes", "_debug");
    await mkdir(dir, { recursive: true });
    const ts = Date.now();
    await writeFile(
      join(dir, `${stage}-${videoId}-${ts}.json`),
      JSON.stringify(raw, null, 2),
      "utf-8",
    );
    if (err && typeof err === "object" && "issues" in err) {
      const issues = (err as { issues: unknown[] }).issues;
      console.error(`[${stage}] Zod issues (first 10):`);
      for (const i of issues.slice(0, 10)) {
        const issue = i as { path?: unknown[]; message?: string; received?: unknown };
        console.error(
          `  - path=${JSON.stringify(issue.path)} msg="${issue.message}" received=${JSON.stringify(issue.received)}`,
        );
      }
    }
  } catch {
    /* ignore */
  }
}

// ============ 主入口 ============

export type AnalyzePotentialInput = {
  videoPath: string;
  videoId: string;
  meta: VideoMeta;
  hints?: {
    sourceUrl?: string;
    knownTitle?: string;
    userIntent?: string;
    userTopic?: string;
  };
  /**
   * Gemini Files API processing 状态轮询最大次数（每次间隔 5s）。
   * 默认 60 次（≈300s）保留旧行为；多视频路由可下调到 24（≈120s）
   * 让卡死视频快速 fail，避免 N=6 并行时拖累整批 wall-clock。
   */
  maxPollAttempts?: number;
};

export async function analyzeMaterialPotential(
  input: AnalyzePotentialInput,
): Promise<MaterialPotential> {
  const ai = getClient();
  const model = process.env.GEMINI_VIDEO_MODEL || "gemini-2.5-pro";
  const norm = makeTimeCodeNormalizer(input.meta.fps);
  const maxPollAttempts = input.maxPollAttempts ?? 60;

  // 上传一次
  const uploaded = await ai.files.upload({
    file: input.videoPath,
    config: { mimeType: "video/mp4" },
  });
  if (!uploaded.name) throw new Error("Gemini file upload returned no name");

  try {
    let file = uploaded;
    let attempts = 0;
    while (file.state === "PROCESSING") {
      attempts++;
      if (attempts > maxPollAttempts) {
        throw new Error("Gemini file processing timed out");
      }
      await new Promise((r) => setTimeout(r, 5000));
      file = await ai.files.get({ name: file.name as string });
    }
    if (file.state === "FAILED") throw new Error("Gemini file processing failed");
    if (!file.uri || !file.mimeType) {
      throw new Error("Gemini file has no uri/mimeType");
    }

    const filePart = createPartFromUri(file.uri, file.mimeType);

    // ============ Stage 1: CutPlan ============
    const hintsLine = [
      input.hints?.sourceUrl ? `source_url: ${input.hints.sourceUrl}` : "",
      input.hints?.knownTitle ? `title: ${input.hints.knownTitle}` : "",
      input.hints?.userTopic ? `user_topic: ${input.hints.userTopic}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const stage1Prompt = `video_id_for_output: "${input.videoId}"\n${hintsLine}\n\n请分析此视频并按 schema 返回严格 JSON CutPlan。`;

    const stage1Resp = await ai.models.generateContent({
      model,
      config: {
        systemInstruction: STAGE1_SYSTEM,
        responseMimeType: "application/json",
        temperature: 0.2,
      },
      contents: createUserContent([filePart, stage1Prompt]),
    });

    const stage1Text = (stage1Resp.text ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");
    const stage1Raw = JSON.parse(stage1Text) as Record<string, unknown>;

    // 注入硬指标
    stage1Raw.videoId = input.videoId;
    stage1Raw.durationSec = input.meta.durationSec;
    stage1Raw.fps = input.meta.fps;
    stage1Raw.resolution = {
      width: input.meta.width,
      height: input.meta.height,
    };
    stage1Raw.meta = {
      model,
      analyzedAt: new Date().toISOString(),
      sourceUrl: input.hints?.sourceUrl,
    };
    norm(stage1Raw);

    let cutPlan: CutPlan;
    try {
      cutPlan = CutPlanSchema.parse(stage1Raw);
    } catch (e) {
      await dumpDebug(input.videoId, "stage1-cutplan", stage1Raw, e);
      throw new Error(
        `Stage 1 (CutPlan) parse failed: ${(e as Error).message}`,
      );
    }

    // ============ Stage 2: Potential + AdaptabilitySummary ============
    const cutPlanSummaryJson = JSON.stringify(cutPlan, null, 2);
    const userIntentLine = input.hints?.userIntent
      ? `\nuser_intent: ${input.hints.userIntent}`
      : "";

    const stage2Prompt = [
      `视频客观结构（CutPlan）：`,
      "```json",
      cutPlanSummaryJson,
      "```",
      userIntentLine,
      "",
      "请基于视频本身 + 上述客观结构，推理该素材的 potential 与 adaptabilitySummary。返回严格 JSON。",
    ].join("\n");

    const stage2Resp = await ai.models.generateContent({
      model,
      config: {
        systemInstruction: STAGE2_SYSTEM,
        responseMimeType: "application/json",
        temperature: 0.4,
      },
      contents: createUserContent([filePart, stage2Prompt]),
    });

    const stage2Text = (stage2Resp.text ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");
    const stage2Raw = JSON.parse(stage2Text);
    norm(stage2Raw);

    let stage2Parsed: z.infer<typeof Stage2OutputSchema>;
    try {
      stage2Parsed = Stage2OutputSchema.parse(stage2Raw);
    } catch (e) {
      await dumpDebug(input.videoId, "stage2-potential", stage2Raw, e);
      throw new Error(
        `Stage 2 (Potential) parse failed: ${(e as Error).message}`,
      );
    }

    // ============ 合并 ============
    const result: MaterialPotential = {
      videoId: input.videoId,
      detectedFormat: cutPlan.videoFormat,
      detectedFormatConfidence: cutPlan.videoFormatConfidence,
      base: cutPlan,
      potential: stage2Parsed.potential,
      adaptabilitySummary: stage2Parsed.adaptabilitySummary,
      meta: {
        model,
        analyzedAt: new Date().toISOString(),
      },
    };
    return MaterialPotentialSchema.parse(result);
  } finally {
    try {
      if (uploaded.name) await ai.files.delete({ name: uploaded.name });
    } catch (e) {
      console.warn(
        "[analyze-potential] file cleanup failed:",
        (e as Error).message,
      );
    }
  }
}
