import { z } from "zod";
import { TimeCodeSchema } from "@/lib/cut-plan/schema";

/**
 * Technique Match Report · 单条爆款与用户素材的匹配报告
 *
 * 核心设计：
 *   - 不是「描述爆款怎么剪」，而是「这条爆款的技法对用户素材的可用性判断」
 *   - 每个技法都有 4 选 1 verdict：learn / adapt / skip / inverse
 *   - learn / adapt 必须给出绑定到用户素材时间戳的落地步骤
 *   - skip / inverse 必须说明素材缺什么 / 反向应该怎么做
 */

/**
 * verdict：
 *   - learn：强烈推荐直接学，用户素材完全适配
 *   - adapt：可借鉴但需改造（缩短/简化/调整参数）
 *   - skip：素材基础不支持，明确不要学
 *   - inverse：学反例（爆款这么做但你的素材应该反过来做）
 */
export const VerdictSchema = z.enum(["learn", "adapt", "skip", "inverse"]);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * 单个技法（atomic）：爆款中可被抽取的剪辑/视觉/节奏单元
 */
export const TechniqueSchema = z.object({
  /** 技法名（自由描述：如 "Beat-sync match cut on lyric hook" / "Push-in on subject reveal"） */
  name: z.string(),
  /** 技法所属类别 */
  category: z
    .string()
    .describe(
      "类别（参考：editing_rhythm / camera_movement / transition / color / typography / bgm_sync / metaphor / structure）",
    ),
  /** 在爆款里出现的位置 */
  sourceAt: TimeCodeSchema.nullable().optional(),
  /** 技法简短描述（爆款里是怎么用的） */
  description: z.string(),
});

/**
 * 单个建议：技法 + verdict + 落地步骤
 */
export const TechniqueRecommendationSchema = z.object({
  technique: TechniqueSchema,
  verdict: VerdictSchema,

  /** 在用户素材里的应用时间戳（learn/adapt 必填） */
  userVideoAt: TimeCodeSchema.nullable().optional(),
  /** 应用持续时长（如适用） */
  userVideoDurationSec: z.number().min(0).nullable().optional(),

  /** 适配/不适配的理由（必填） */
  reasoning: z.string().describe(
    "为什么 learn/adapt/skip/inverse；必须引用 MaterialPotential 里的具体维度（如 strengths/limitations/cutPoints/metaphorHooks）",
  ),

  /**
   * 落地步骤（learn 和 adapt 必填，skip/inverse 可选）
   * 必须具体到剪辑软件操作级（如「在 X 秒做 transform scale 100→125, 30 帧 ease-out」）
   */
  actionableSteps: z
    .array(z.string())
    .describe("可执行的具体操作步骤"),

  /** 改造方案（仅 adapt 需要：原版怎么用、你应该怎么改） */
  adaptationNotes: z
    .string()
    .nullable()
    .optional()
    .describe("如何在用户素材上改造原技法（adapt 才填）"),

  /** 优先级 P0/P1/P2 */
  priority: z.enum(["P0", "P1", "P2"]).describe(
    "P0=必做（最高 ROI）/ P1=强烈建议 / P2=锦上添花",
  ),

  /** 预期效果 */
  expectedImpact: z.string().describe("做了这个改动用户视频会有什么变化"),
});
export type TechniqueRecommendation = z.infer<
  typeof TechniqueRecommendationSchema
>;

/**
 * 单条爆款的完整匹配报告
 */
export const TechniqueMatchReportSchema = z.object({
  /** 爆款视频 ID */
  referenceVideoId: z.string(),
  /** 爆款来源 URL / handle */
  referenceSource: z.string().nullable().optional(),
  /** 爆款的核心定位（一句话总结这条爆款靠什么火） */
  referencePositioning: z.string(),

  /** 爆款与用户素材的「总体适配性」0-100 */
  overallFitScore: z.number().min(0).max(100),
  /** 总体适配性一句话评语 */
  fitSummary: z.string(),

  /** 技法清单 + 每个技法的建议 */
  recommendations: z.array(TechniqueRecommendationSchema),

  /** 整体不建议方向（这条爆款的某些维度根本不适配） */
  bigPictureWarnings: z.array(z.string()).default([]),
});
export type TechniqueMatchReport = z.infer<typeof TechniqueMatchReportSchema>;

/**
 * BGM 推荐（Phase 5.5）
 *
 * Opus 综合用户素材的 metaphorHooks / videoFormat / 节奏 / 情绪推断适合的音乐方向。
 * 由于现有爆款 enriched 数据里 195/299 条 bgm 是 "Original audio" 泛标签（缺乏具体歌名），
 * 推荐结果不一定能给出真歌名，但一定要给：
 *   - vibe 描述（"upbeat motivational speech + lo-fi instrumental"）
 *   - 在 TikTok / Spotify 搜索的关键词
 *   - 为什么适合用户素材的理由
 */
export const RecommendedBgmSchema = z.object({
  /** 推荐音乐名（具体歌名 / 艺人优先；没有就给 vibe 概念名） */
  name: z.string(),
  /** 艺人 / 创作者（可选） */
  artist: z.string().nullable().optional(),
  /** 类型：trending_sound（TikTok 声音池）/ specific_track（具体歌曲）/ vibe_category（vibe 风格描述） */
  kind: z.string().describe("trending_sound | specific_track | vibe_category"),
  /** 推荐理由（必须引用用户的 metaphorHooks / videoFormat / 形态等具体维度） */
  reasoning: z.string(),
  /** TikTok / Spotify / YouTube 搜索关键词数组（用户复制即用） */
  searchKeywords: z.array(z.string()),
  /** 来自哪条爆款（如果是从 reference videos 提取的） */
  fromReferenceId: z.string().nullable().optional(),
  /** TikTok / Spotify 搜索 URL（可选，方便点击直跳） */
  searchUrl: z.string().nullable().optional(),
  /** 优先级 P0 必选 / P1 备选 */
  priority: z.enum(["P0", "P1"]),
});
export type RecommendedBgm = z.infer<typeof RecommendedBgmSchema>;

/**
 * 多条爆款的批量匹配结果（最终交付给前端）
 */
export const TechniqueMatchingResultSchema = z.object({
  userVideoId: z.string(),
  /** 各条爆款的报告 */
  reports: z.array(TechniqueMatchReportSchema),

  /**
   * 跨爆款综合：
   * 选出全部 recommendations 里 verdict=learn / priority=P0 的"全局必做清单"
   */
  topPriorityActions: z
    .array(
      z.object({
        userVideoAt: TimeCodeSchema.nullable().optional(),
        action: z.string(),
        sourcedFromReferenceId: z.string(),
        priority: z.enum(["P0", "P1", "P2"]),
      }),
    )
    .describe("跨爆款汇总的优先动作清单（去重/合并/排序后）"),

  /** 跨爆款的"绝对不要做" */
  globalDoNots: z.array(z.string()).default([]),

  /** Phase 5.5：3-5 首推荐 BGM */
  recommendedBgms: z.array(RecommendedBgmSchema).default([]),

  meta: z
    .object({
      model: z.string().optional(),
      analyzedAt: z.string().optional(),
      referenceCount: z.number().int().optional(),
    })
    .optional(),
});
export type TechniqueMatchingResult = z.infer<
  typeof TechniqueMatchingResultSchema
>;
