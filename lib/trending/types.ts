import { z } from "zod";
import type { ViralVideo } from "@/lib/review-engine/types";

/** 快照 schema 版本。velocity.ts 跨周比较时校验,不一致 → 当作"无上周" → 全 NEW。 */
export const TRENDING_SCHEMA_VERSION = 1 as const;

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
  })
  .passthrough();
