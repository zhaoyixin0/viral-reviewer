import { NextResponse } from "next/server";
import { readLatestTwoSnapshots } from "@/lib/trending/snapshot-store";
import { computeVelocity, computeHashtagVelocity } from "@/lib/trending/velocity";
import { projectInsightForBoard } from "@/lib/trending/insight-projection";
import {
  createRateLimiter,
  withRateLimit,
  clientIp,
  STRICT_PER_IP,
} from "@/lib/rate-limit";
import { TrendingQuerySchema } from "./schema";

export type { BoardInsightDTO } from "@/lib/trending/insight-projection";

export const runtime = "nodejs";

// P3 #3 phase 2: STRICT_PER_IP (10/1m sliding) —— 公网匿名 GET 看板,
// ISR 1h revalidate 已兜底，rate-limit 防异常突发 (爬虫 / bot 探测)。
const RATE_LIMITER = createRateLimiter({
  identifier: "trending-get",
  ...STRICT_PER_IP,
});

/** 卡片精简投影 —— 只含看板渲染需要的字段,不返回完整富化快照(spec 4.2 M1)。 */
export type TrendingCard = {
  id: string;
  platform: "tiktok" | "instagram";
  url: string;
  cover: string;
  title: string;
  topic: string;
  views: number;
  /** v4 新增:TikTok 视频带来源趋势 hashtag 信息;IG 视频 / 非 trending 来源为 undefined。 */
  trendingContext?: { hashtag: string; hashtagRank: number };
  velocity: {
    weekOverWeek: number | null;
    rank: { current: number; previous: number | null };
    trend: "rising" | "stable" | "falling" | "new";
  };
};

/** hashtag 榜精简投影 —— 供看板 hashtag 榜视图用,不含 rankDiff / industryName 等 raw 字段。 */
export type TrendingHashtagCard = {
  name: string;
  rank: number;
  viewCount: number;
  videoCount: number;
  velocity: {
    weekOverWeek: number | null;
    rank: { current: number; previous: number | null };
    trend: "rising" | "stable" | "falling" | "new";
  };
};

async function impl(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = TrendingQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", detail: parsed.error.format() },
      { status: 400 },
    );
  }
  const { platform } = parsed.data;

  const { current, previous } = await readLatestTwoSnapshots();
  if (!current) {
    return NextResponse.json({
      week: null,
      cards: [],
      trendingHashtags: [],
      insight: null,
    });
  }

  // 视频 velocity
  const withVelocity = computeVelocity(current, previous);
  const filtered = platform
    ? withVelocity.filter((v) => v.platform === platform)
    : withVelocity;

  const cards: TrendingCard[] = filtered.map((v) => ({
    id: v.id,
    platform: v.platform,
    url: v.url,
    cover: v.cover,
    title: v.title,
    topic: v.topic,
    views: v.views,
    // 透传 trendingContext(仅 TikTok trending 视频携带此字段)
    ...(v.trendingContext ? { trendingContext: v.trendingContext } : {}),
    velocity: v.velocity,
  }));

  // hashtag 级 velocity —— 精简投影(去掉 rankDiff / industryName 等 raw 字段)
  const hashtagsWithVelocity = computeHashtagVelocity(current, previous);
  const trendingHashtags: TrendingHashtagCard[] = hashtagsWithVelocity.map((h) => ({
    name: h.name,
    rank: h.rank,
    viewCount: h.viewCount,
    videoCount: h.videoCount,
    velocity: h.velocity,
  }));

  // v2 (L3+):board DTO 投影。v1 老快照 (current.insight === undefined) → null,
  // 前端 T5 检测 null 时只渲 videos tab (5 个 insight tab 自动隐藏)。
  const insight = projectInsightForBoard(current.insight, platform ?? "all");

  return NextResponse.json({
    week: current.week,
    cards,
    trendingHashtags,
    insight,
  });
}

export const GET = withRateLimit(RATE_LIMITER, clientIp, impl);
