import { NextResponse } from "next/server";
import { readLatestTwoSnapshots } from "@/lib/trending/snapshot-store";
import { computeVelocity, computeHashtagVelocity } from "@/lib/trending/velocity";
import { TrendingQuerySchema } from "./schema";

export const runtime = "nodejs";

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

export async function GET(request: Request) {
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
    return NextResponse.json({ week: null, cards: [], trendingHashtags: [] });
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

  return NextResponse.json({ week: current.week, cards, trendingHashtags });
}
