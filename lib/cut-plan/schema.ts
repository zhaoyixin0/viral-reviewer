import { z } from "zod";

/**
 * CutPlan IR · 视频「剪辑计划」的中间表示
 *
 * 核心设计目标：
 *   1. 既能描述爆款视频的剪辑结构（让 LLM 拿来对照）
 *   2. 又能直接编译到 CapCut draft_content.json / Premiere XML（一键出片）
 *   3. 同一份 schema 同时表达"现状"和"建议"，方便 diff
 *
 * 时间单位说明：
 *   - 内部以 TimeCode {sec, frame} 为准（双单位，避免精度丢失）
 *   - CapCut compiler 阶段统一转 μs（CapCut draft 用微秒）
 *   - 详见 lib/cut-plan/time-code.ts
 *
 * =============================================================
 * SCHEMA DESIGN RULES（加/改字段之前先读）
 * =============================================================
 *
 * 历史上踩过 4 轮 schema 灾难（详见 v1/v2/v3/v4 commit history 与
 * docs/superpowers/plans/2026-05-13-cutplan-enrichment-plus-technique-index.md）：
 *
 * RULE 1 · 描述性字段不要用 `z.enum([...])`
 *   Gemini 2.5 Pro 经常输出枚举外的细分值（如 `medium_close_up`、
 *   `glitch_transition`、`n/a`）。所有 LLM 自由输出的描述性字段都用
 *   `z.string()` + 在 `.describe()` 里写参考值。
 *
 * RULE 2 · LLM 自由文本字段必须接受 null
 *   Gemini 在没识别到某个属性时常返 `null` 而不是省略字段。所以这类字段写：
 *     z.string().nullable().optional()
 *   `BgmTrack.name`、`BgmMarker.kind`、各 TimedAction 的 `.type`、
 *   `rhythmProfile`、`hookFormat`、`openingShot`、`endingShot` 都是。
 *
 * RULE 3 · 不要随便 `.default(X)`
 *   Zod 4 的 `.default(X)` 让 z.infer<> 的 OUTPUT 类型把字段标成 required
 *   （即使 input 是 optional）。这会让 fixture / 直接构造对象的代码必须
 *   填该字段。`easing` 字段就因为 `.default("linear")` 在 v4 fixture 里
 *   要求每个 camera_move 都填 easing，删 default 才解决（见 commit ff340c2）。
 *
 *   只在以下场景用 `.default()`：
 *     - 数组：`.default([])`（消费者总能 iterate）
 *     - 必需数字：`.default(30)`（如 fps）
 *     - 当前 schema 里 LLM-free-text 字段仍保留 `.default("")` 是因为还
 *       没有代码直接构造 BgmTrack / 各 Dimension 对象（全走 safeParse）。
 *       未来若加手写构造代码，把那些 `.default("")` 都删掉。
 *
 * RULE 4 · 防回归测试
 *   `tests/cut-plan/schema.test.ts` 锁定了 Gemini null tolerance 契约。
 *   任何字段的 nullable / optional / default 改动都跑一下那个文件。
 *
 * 长期解药：Gemini structured output `responseSchema` 由模型侧保证字段
 * 形态，但还没接（见 HANDOVER-2026-05-12.md B 项）。在接通之前，loose
 * 是唯一靠谱的姿势。
 * =============================================================
 */

// ============ TimeCode ============

export const TimeCodeSchema = z.object({
  sec: z.number().min(0).describe("秒，浮点（如 1.5 = 1.5s）"),
  frame: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("精确到帧（可选；compiler 阶段会从 sec * fps 算出）"),
});
export type TimeCode = z.infer<typeof TimeCodeSchema>;

// ============ TimedAction · 时序操作 ============

/**
 * 镜头切换点（最基础的剪辑动作）
 * 标记"在此时间点切到下一个镜头"
 */
export const CutActionSchema = z.object({
  kind: z.literal("cut"),
  at: TimeCodeSchema,
  /** 切换前后的镜头景别（可选；近景→远景 / 远景→近景 等信号）
   * 用 string 而非 enum：Gemini 实际会输出 `medium_close_up` 等细分景别。
   * 标准参考值：extreme_close_up / close_up / medium / wide / extreme_wide
   */
  fromShotSize: z.string().optional(),
  toShotSize: z.string().optional(),
  /** 该镜头的内容描述（来自 Gemini 视频理解） */
  shotDescription: z.string().optional(),
});

/**
 * 转场效果（硬切之外的转场处理）
 *
 * type 用 string 而非 enum：LLM 可能给出 "fade" / "wipe" / "glitch_transition"
 * 等未预期值。建议值（参考）：hard_cut / whip_pan / match_cut / speed_ramp /
 * fade_in / fade_out / cross_dissolve / morph / zoom_blur / flash / other
 */
export const TransitionActionSchema = z.object({
  kind: z.literal("transition"),
  at: TimeCodeSchema,
  type: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("转场类型（LLM 自由输出，参考值见 schema 注释；未识别时返 null）"),
  durationFrames: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .default(0)
    .describe("转场持续帧数；硬切 = 0"),
  note: z.string().nullable().optional().describe("转场细节（如 whip pan 方向）"),
});

/**
 * 镜头运动（推/拉/摇/移）
 *
 * type 用 string：参考值 push_in / pull_out / pan_left/right / tilt_up/down /
 * tracking / handheld / dolly_zoom / orbit / static / other
 */
export const CameraMoveActionSchema = z.object({
  kind: z.literal("camera_move"),
  at: TimeCodeSchema,
  type: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("镜头运动类型（LLM 自由输出；未识别时返 null）"),
  durationSec: z.number().min(0).default(0).describe("运动持续秒数"),
  scaleFrom: z.number().nullable().optional(),
  scaleTo: z.number().nullable().optional(),
  easing: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

/**
 * 速度变化（变速、定格）
 */
export const SpeedChangeActionSchema = z.object({
  kind: z.literal("speed_change"),
  at: TimeCodeSchema,
  multiplier: z.number().describe("速率（2 = 2 倍速，0.5 = 半速，0 = 定格）"),
  durationSec: z.number().min(0),
  note: z.string().nullable().optional(),
});

/**
 * 特效（滤镜、贴纸、AI 效果、文字动画外）
 */
export const EffectActionSchema = z.object({
  kind: z.literal("effect"),
  at: TimeCodeSchema,
  type: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("特效类型（如 glitch / chromatic_aberration / vhs / film_grain / overlay_emoji；未识别时返 null）"),
  durationSec: z.number().min(0),
  params: z.record(z.unknown()).nullable().optional(),
});

/**
 * 字幕（独立轨道，但也可以作为 TimedAction 出现）
 */
export const SubtitleActionSchema = z.object({
  kind: z.literal("subtitle"),
  at: TimeCodeSchema,
  text: z.string(),
  durationSec: z.number().min(0),
  style: z
    .object({
      font: z.string().nullable().optional(),
      sizePct: z.number().nullable().optional().describe("字号占画面短边的百分比"),
      color: z.string().nullable().optional(),
      strokeColor: z.string().nullable().optional(),
      strokeWidthPx: z.number().nullable().optional(),
      position: z.string().nullable().optional(),
      animation: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const TimedActionSchema = z.discriminatedUnion("kind", [
  CutActionSchema,
  TransitionActionSchema,
  CameraMoveActionSchema,
  SpeedChangeActionSchema,
  EffectActionSchema,
  SubtitleActionSchema,
]);
export type TimedAction = z.infer<typeof TimedActionSchema>;

// ============ 音轨 ============

export const BgmMarkerSchema = z.object({
  at: TimeCodeSchema,
  kind: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("标记类型：beat / drop / vocal_in / vocal_out / vocal_phrase / transition / other（未识别时返 null）"),
  note: z.string().nullable().optional(),
});

export const BgmTrackSchema = z.object({
  name: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("BGM 名称（Gemini 在没识别到具体曲名时会返 null）"),
  trending: z.boolean().nullable().optional(),
  bpm: z.number().nullable().optional(),
  startsAt: TimeCodeSchema.nullable().optional(),
  markers: z.array(BgmMarkerSchema).default([]),
});
export type BgmTrack = z.infer<typeof BgmTrackSchema>;

// ============ 四大维度结构化数据 ============

export const PacingDimensionSchema = z.object({
  shotCount: z.number().int().min(0).describe("总镜头数"),
  avgShotDurationSec: z.number().min(0),
  cutDensityPerSec: z.number().min(0).describe("每秒平均切换数"),
  rhythmProfile: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("节奏画像（参考：fast_cut / medium / slow_burn / mixed / slow_and_steady；LLM 自由输出，未识别时返 null）"),
  keyTwistAt: TimeCodeSchema.nullable().optional().describe("剧情/视觉反转关键时刻"),
});

export const CameraDimensionSchema = z.object({
  dominantMovements: z.array(z.string()).describe("主要镜头运动模式"),
  shotSizeDistribution: z
    .object({
      extreme_close_up: z.number().min(0).default(0),
      close_up: z.number().min(0).default(0),
      medium: z.number().min(0).default(0),
      wide: z.number().min(0).default(0),
      extreme_wide: z.number().min(0).default(0),
    })
    .describe("各景别分布（Gemini 可能返回镜头数 int 或比例 float，两种都接受）"),
  transitionPatterns: z.array(z.string()).describe("用到的转场类型集合"),
});

export const AudiovisualDimensionSchema = z.object({
  bgmPattern: z.string().nullable().optional().default("").describe("BGM 整体模式"),
  bgmSyncTightness: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("卡点精度（loose / moderate / tight）"),
  subtitleStyle: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe(
      "字幕风格（none / large_white_stroke / centered_minimal / kinetic / auto_caption / decorative / other）",
    ),
  colorGrade: z.string().nullable().optional().describe("调色风格"),
});

export const StructureDimensionSchema = z.object({
  hookFormat: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe(
      "0-3s 钩子形态（参考：number_assertion / visual_contrast / suspense_subtitle / pov / sound_anchor / question / tutorial_promise / before_after / other；LLM 自由输出，未识别时返 null）",
    ),
  openingShot: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("0-2s 开场画面描述（LLM 未识别时返 null）"),
  endingShot: z
    .string()
    .nullable()
    .optional()
    .default("")
    .describe("结尾画面描述（LLM 未识别时返 null）"),
  cta: z.string().nullable().optional().describe("结尾 CTA 文案"),
  payoffAt: TimeCodeSchema.nullable().optional().describe("彩蛋 / payoff 出现时刻"),
});

// ============ 技法密度（关键评分） ============

export const DensitySchema = z.object({
  editing: z
    .number()
    .min(0)
    .max(100)
    .describe("剪辑密度 = f(cutDensity, shotCount, rhythmProfile)"),
  transition: z
    .number()
    .min(0)
    .max(100)
    .describe("转场丰富度 = f(转场类型多样性 + 频次)"),
  effect: z
    .number()
    .min(0)
    .max(100)
    .describe("特效使用密度 = f(特效次数 + 占时长比例)"),
  bgmSync: z
    .number()
    .min(0)
    .max(100)
    .describe("BGM 同步度 = f(卡点精度 + 用 trending sound 与否)"),
  overall: z
    .number()
    .min(0)
    .max(100)
    .describe("综合技法密度（用于 technique 模式 retrieval 筛选）"),
});
export type Density = z.infer<typeof DensitySchema>;

// ============ Video Format（B+C 方案核心） ============

/**
 * Video Format（B+C 方案核心维度）
 * 用 string 而非 enum：LLM 可能给出 "vlog_cinematic" 或 "story_vlog" 等细分变体
 * 推荐值：vlog / tutorial / transformation / skit / comedy / listicle / review /
 *        pov / interview / edit / ugc_native / other
 * retrieval 阶段做 prefix 匹配（startsWith("vlog") 都算 vlog）
 */
export const VideoFormatSchema = z.string();
export type VideoFormat = z.infer<typeof VideoFormatSchema>;

// ============ 完整 CutPlan ============

export const CutPlanSchema = z.object({
  /** 关联的视频 ID（用户上传的或爆款的） */
  videoId: z.string(),
  /** 视频时长（秒） */
  durationSec: z.number().min(0),
  /** 帧率（来自 ffprobe；fallback 30） */
  fps: z.number().default(30),
  /** 分辨率 */
  resolution: z
    .object({ width: z.number(), height: z.number() })
    .optional(),

  /** 视频形态分类（B+C 方案的 C 部分；用于跨题材筛 vlog） */
  videoFormat: VideoFormatSchema,
  /** 形态判定置信度 0-1 */
  videoFormatConfidence: z.number().min(0).max(1).default(0.8),

  /** 时序操作列表（剪辑/转场/镜头运动/特效/字幕） */
  actions: z.array(TimedActionSchema).default([]),

  /** 音乐轨道（Gemini 在视频静音时会返回 null） */
  bgm: BgmTrackSchema.nullable().optional(),

  /** 四大维度汇总 */
  dimensions: z.object({
    pacing: PacingDimensionSchema,
    camera: CameraDimensionSchema,
    audiovisual: AudiovisualDimensionSchema,
    structure: StructureDimensionSchema,
  }),

  /** 技法密度评分 */
  density: DensitySchema,

  /** Gemini 解析时的元信息（可观测） */
  meta: z
    .object({
      model: z.string().optional(),
      analyzedAt: z.string().optional(),
      sourceUrl: z.string().optional(),
    })
    .optional(),
});
export type CutPlan = z.infer<typeof CutPlanSchema>;
