import { z } from "zod";
import { CutPlanSchema, TimeCodeSchema } from "./schema";

/**
 * MaterialPotential IR · 用户视频「可塑性」表示
 *
 * 与 CutPlan IR 的关系：
 *   - CutPlan 描述「视频现在是什么样」（客观结构）
 *   - MaterialPotential 描述「这段素材能变成什么样」（改造潜力）
 *
 * 设计意图：
 *   匹配引擎拿到这个 IR，能精准判断「某个爆款技法是否落地到用户素材上」。
 *   例如：用户素材只有 1 个静态主体 → 不会推荐密集 match_cut（缺少第二场景）
 *        用户素材有 2 个反差场景 → 强烈推荐 match_cut（有素材基础）
 *
 * Schema 哲学：
 *   全部用 string 自由描述 + 时间戳锚定。
 *   不硬塞 enum，鼓励 Gemini 用自然语言描述潜力（如 "适合在 2.3s 推近右下角的咖啡杯"）。
 */

// ============ 8 个可塑性维度 ============

/**
 * 可切位置：基于画面变化、动作完成、节拍点等推断的「合适切换时刻」
 * 即便当前没切，也能列出适合切的位置。
 */
export const CutPointCandidateSchema = z.object({
  at: TimeCodeSchema,
  reason: z.string().describe("为什么这里适合切（如：动作收尾 / BGM beat / 视线转移）"),
  /** 可应用的剪辑形态：hard_cut / match_cut / whip_pan / speed_ramp / fade 等 */
  suitableTechniques: z.array(z.string()),
  /** 自信度 0-1：素材在该点真的合适切的程度 */
  confidence: z.number().min(0).max(1),
});

/**
 * 推近机会点：有清晰主体可做 push_in / 动态拉近的位置
 */
export const PushInOpportunitySchema = z.object({
  at: TimeCodeSchema,
  durationSec: z.number().min(0).describe("可推近的时长窗口"),
  subject: z.string().describe("可推近的主体（如：咖啡杯特写 / 人物脸部 / 文字标语）"),
  recommendedScale: z
    .object({ from: z.number(), to: z.number() })
    .describe("推荐缩放范围（如 1.0 → 1.25）"),
  confidence: z.number().min(0).max(1),
});

/**
 * Match Cut 候选：找出可形成"构图/景别/动作匹配"的两个画面
 * 例：从「室内楼梯」匹配剪到「室外楼梯」（构图相同，环境反差）
 */
export const MatchCutCandidateSchema = z.object({
  fromAt: TimeCodeSchema,
  toAt: TimeCodeSchema,
  fromShot: z.string().describe("源镜头描述"),
  toShot: z.string().describe("目标镜头描述"),
  matchBasis: z.string().describe("匹配依据（构图 / 主体位置 / 动作 / 颜色 / 形状）"),
  contrastDimension: z.string().describe("反差维度（环境 / 光线 / 情绪 / 时间）"),
  confidence: z.number().min(0).max(1),
});

/**
 * BGM 卡点空间：分析音频，找出可作为切换/特效卡点的时刻
 */
export const BeatSlotSchema = z.object({
  at: TimeCodeSchema,
  kind: z.string().describe("节拍类型（beat / drop / vocal_in / vocal_phrase / hit / silence_break）"),
  intensity: z.string().describe("强度（subtle / moderate / strong）"),
  /** 这个节拍点适合做什么操作 */
  suitableFor: z.array(z.string()).describe("如：cut / whip_pan / effect_in / speed_change"),
});

/**
 * 节奏可调范围
 */
export const RhythmRangeSchema = z.object({
  current: z.string().describe("当前节奏画像"),
  /** 能压缩到多快：每镜最短秒数 */
  minShotDurationSec: z.number().min(0),
  /** 能拉伸到多慢：每镜最长秒数 */
  maxShotDurationSec: z.number().min(0),
  adaptableTo: z
    .array(z.string())
    .describe("可改造方向（如 fast_cut_montage / slow_cinematic / kinetic_tutorial）"),
  bottleneck: z
    .string()
    .nullable()
    .optional()
    .describe("限制节奏调整的原因（如：单一长镜头无法快剪 / 音轨节拍稀疏）"),
});

/**
 * 调性反差潜力
 */
export const ColorContrastPotentialSchema = z.object({
  currentGrade: z.string().describe("当前调色风格"),
  contrastPairs: z
    .array(
      z.object({
        fromAt: TimeCodeSchema,
        toAt: TimeCodeSchema,
        contrast: z
          .string()
          .describe("反差维度（冷暖 / 明暗 / 饱和度 / 单色 vs 彩色）"),
        recommendation: z
          .string()
          .describe("可做的处理（如：加强对比 / 调色一致化 / 滤镜分区）"),
      }),
    )
    .describe("画面之间已有的或可强化的对比"),
  globalAdjustments: z
    .array(z.string())
    .describe("整体可做的调色操作（如 cinematic_teal_orange / sun_drenched / film_grain）"),
});

/**
 * 字幕留白位置：哪些时刻可以塞字幕、塞什么类型的字幕
 */
export const SubtitleSlotSchema = z.object({
  at: TimeCodeSchema,
  durationSec: z.number().min(0),
  reason: z.string().describe("为什么这里适合字幕（视觉留白 / 情绪铺垫 / 语义节点）"),
  suitableStyles: z
    .array(z.string())
    .describe("适合的字幕风格（large_white_stroke / centered_minimal / kinetic / lyric_overlay）"),
  /** 是否有 BGM 歌词可叠加 */
  hasLyricOverlap: z.boolean(),
});

/**
 * 隐喻 / 主题关联钩子：BGM 歌词 + 画面 + 字幕能形成什么意义关联
 * Gemini 在 thematic 标签上的自由发挥点
 */
export const MetaphorHookSchema = z.object({
  description: z.string().describe("画面与音频/歌词的隐喻关系（自由描述）"),
  anchorAt: TimeCodeSchema.describe("最强关联点的时间戳"),
  bgmLyricFragment: z
    .string()
    .nullable()
    .optional()
    .describe("相关歌词片段（如有）"),
  visualElement: z.string().describe("对应的画面元素"),
  amplifyHow: z
    .string()
    .describe("如何放大这个隐喻（字幕强调 / 卡点切换 / 慢镜头突出）"),
});

/**
 * 场景转换候选：用户素材中可形成 reveal / 蒙太奇序列的画面组
 */
export const SceneTransitionCandidateSchema = z.object({
  scenes: z
    .array(
      z.object({
        at: TimeCodeSchema,
        durationSec: z.number().min(0),
        description: z.string(),
      }),
    )
    .min(2)
    .describe("可串联成序列的场景片段"),
  narrativeArc: z
    .string()
    .describe("可形成的叙事弧（如：渐进 reveal / 时间流逝 / 状态转变 / 因果链）"),
  recommendedTechnique: z
    .string()
    .describe("推荐的串联手法（如 cinematic_pull_out_reveal / cross_fade_montage / speed_ramp_compression）"),
});

// ============ 整体 MaterialPotential ============

export const MaterialPotentialSchema = z.object({
  /** 视频 ID（用户上传的） */
  videoId: z.string(),
  /** 视频形态分类（参考 CutPlan 的 videoFormat，但用户视频可能形态模糊） */
  detectedFormat: z.string(),
  detectedFormatConfidence: z.number().min(0).max(1),

  /** 客观结构（CutPlan IR） */
  base: CutPlanSchema,

  /** 8 大可塑性维度 */
  potential: z.object({
    cutPoints: z.array(CutPointCandidateSchema).describe("适合切换的位置列表"),
    pushInOpportunities: z.array(PushInOpportunitySchema),
    matchCutCandidates: z.array(MatchCutCandidateSchema),
    beatSlots: z.array(BeatSlotSchema).describe("BGM 上可卡点的位置"),
    rhythmRange: RhythmRangeSchema,
    colorContrast: ColorContrastPotentialSchema,
    subtitleSlots: z.array(SubtitleSlotSchema),
    metaphorHooks: z
      .array(MetaphorHookSchema)
      .describe("画面与 BGM/歌词的隐喻关联点（thematic 标签的具体落地）"),
    sceneTransitionCandidates: z.array(SceneTransitionCandidateSchema),
  }),

  /**
   * 适配性总评：用户素材整体上"能学到什么"
   * 让 LLM 自由总结：素材的优势 / 局限 / 最适合学习的技法方向
   */
  adaptabilitySummary: z.object({
    strengths: z.array(z.string()).describe("素材的剪辑潜力优势（如：有 2 个反差场景，适合 match_cut）"),
    limitations: z.array(z.string()).describe("素材的局限（如：单一静态主体，难做密集快剪）"),
    bestSuitedTechniques: z
      .array(z.string())
      .describe("最适合套用的剪辑技法方向（不限于已有爆款，开放推理）"),
    notSuitableTechniques: z
      .array(z.string())
      .describe("素材基础不支持的技法（明确说『不要学这些』）"),
  }),

  meta: z
    .object({
      model: z.string().optional(),
      analyzedAt: z.string().optional(),
    })
    .optional(),
});
export type MaterialPotential = z.infer<typeof MaterialPotentialSchema>;
