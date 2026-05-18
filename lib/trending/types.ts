import { z } from "zod";
import type { ViralVideo } from "@/lib/review-engine/types";
import { TrendingInsightSchema, type TrendingInsight } from "./insight-schema";

/**
 * 快照 schema 版本。velocity.ts 跨周比较时落在 SUPPORTED_SCHEMA_VERSIONS 窗口
 * 内的 prev 才参与对比;窗口外或缺字段 → 当作"无上周" → 全 NEW。
 *
 * v1 → v2 (L3+ plan §3.5):新增 optional `insight` 字段。读侧 loose passthrough,
 * v1 老快照(无此字段)解析仍过。
 */
export const TRENDING_SCHEMA_VERSION = 2 as const;

/**
 * 跨周对比允许的旧版本窗口。v1 旧快照(本周 v=2 / 上周 v=1)仍能算 velocity。
 * 任何新版本必须显式加入此数组,以避免"突然全部标 NEW"的静默回归。
 */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2];

export type PlatformMeta = {
  /** TikTok = 两阶段(Stage 1 是 trends-actor);Instagram = 热门 hashtag 代理 */
  source: "trends-actor" | "hashtag-proxy";
  /** Apify run ID。TikTok 记 Stage 1 trends-scraper 的 run id */
  actorRun: string;
  /** TikTok = Stage 2 抓回的视频条数;IG = 抓回的视频条数 */
  rawCount: number;
  /** Haiku 富化成功多少条 */
  enrichedCount: number;
  /** 该平台本次抓取是否成功 */
  ok: boolean;
  /**
   * 本平台主入口尝试次数 (1 = 成功未重试;2 = 重试一次)。TikTok 记 Stage 1
   * 实际尝试次数;IG 当前不重试,固定 1。Optional 保持旧快照向后兼容。
   */
  retryAttempts?: number;
};

export type TrendingSnapshot = {
  schemaVersion: typeof TRENDING_SCHEMA_VERSION;
  /** ISO week,如 "2026-W20" */
  week: string;
  /** ISO timestamp */
  capturedAt: string;
  /** v4 新增:TikTok Stage 1 趋势 hashtag 榜(IG 无此项,空数组即可)。 */
  trendingHashtags: TrendingHashtag[];
  /** tt + ig 混合,靠 v.platform 区分;含 Haiku 题材标签写入 v.topic */
  videos: ViralVideo[];
  meta: {
    tiktok: PlatformMeta;
    instagram: PlatformMeta;
    /** 任一平台失败 = true */
    partial: boolean;
  };
  /**
   * v2 (L3+) 新增:aggregate insight(hashtag/BGM/event/velocity 维度报表)。
   * 富化全失败时仍写一份 emptyInsight(stage1 数据不丢);v1 旧快照无此字段。
   */
  insight?: TrendingInsight;
};

export type TrendTag = "rising" | "stable" | "falling" | "new";

/**
 * v4 新增:TikTok Stage 1 趋势 hashtag 记录(来自 clockworks/tiktok-trends-scraper)。
 * 字段映射见 P1.7 probe 实测结果。
 */
export type TrendingHashtag = {
  name: string;
  rank: number;
  viewCount: number;
  videoCount: number;
  rankDiff: number;
  isNew: boolean;
  industryName?: string;
};

/** velocity 是派生类型,不落盘 —— 由 velocity.ts 读取时实时算。 */
export type TrendingVideoWithVelocity = ViralVideo & {
  velocity: {
    /** (本周 views - 上周 views) / 上周 views;上周无此条 = null */
    weekOverWeek: number | null;
    rank: { current: number; previous: number | null };
    trend: TrendTag;
  };
};

/** v4.1 新增:hashtag 级 velocity 派生类型 —— 趋势连续性主载体(见 spec 2.8)。 */
export type TrendingHashtagWithVelocity = TrendingHashtag & {
  velocity: {
    /** (本周 viewCount - 上周 viewCount) / 上周 viewCount;上周无此 hashtag = null */
    weekOverWeek: number | null;
    rank: { current: number; previous: number | null };
    trend: TrendTag;
  };
};

/**
 * Blob 是系统边界 —— 读回的快照 JSON 可能是旧 schema / 损坏 / 手改的。
 * 这个 loose schema 只校验下游真正依赖的结构锚点(schemaVersion / week / videos[].id+views),
 * 其余字段 passthrough。safeParse 失败 → 读取函数返回 null,不让 undefined 字段流进 velocity.ts。
 * 参考 memory llm-schema-looseness:最小校验,不全字段严格化。
 */
export const TrendingSnapshotSchema = z
  .object({
    schemaVersion: z.number(),
    week: z.string().min(1),
    videos: z.array(
      z
        .object({
          id: z.string().min(1),
          views: z.number(),
        })
        .passthrough(),
    ),
    // v4:trendingHashtags 加为 optional —— TS type 上是必填,但 Zod 读侧 loose,
    // 旧快照(无此字段)不应 parse 失败。校验锚点不变。
    trendingHashtags: z
      .array(z.object({ name: z.string() }).passthrough())
      .optional(),
    // v2 (L3+):insight 是 v2 新加的聚合层。optional 让 v1 旧快照解析仍过。
    // TrendingInsightSchema 已 .passthrough(),writer 加新字段不破读侧。
    insight: TrendingInsightSchema.optional(),
  })
  .passthrough();
