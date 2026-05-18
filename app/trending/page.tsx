import { TrendingUp } from "lucide-react";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { TrendingBoard } from "@/components/trending/TrendingBoard";
import { readLatestTwoSnapshots } from "@/lib/trending/snapshot-store";
import { computeVelocity, computeHashtagVelocity } from "@/lib/trending/velocity";
import { projectInsightForBoard } from "@/lib/trending/insight-projection";
import type {
  TrendingCard,
  TrendingHashtagCard,
  BoardInsightDTO,
} from "@/app/api/trending/route";

export const runtime = "nodejs";
// 看板按周更新,RSC 缓存 1 小时即可
export const revalidate = 3600;

export default async function TrendingPage() {
  const { current, previous } = await readLatestTwoSnapshots();

  let week: string | null = null;
  let cards: TrendingCard[] = [];
  // v4.1:hashtag 级 velocity 精简投影,注入 TrendingBoard(spec 4.7)
  let initialTrendingHashtags: TrendingHashtagCard[] = [];
  // T4 C3 (L3+ plan §5):board DTO 投影。v1 老快照 → null (T5 降级只渲 videos tab)。
  // RSC 无 platform query,默认走 "all"。客户端切换平台时 fetch /api/trending?platform=X
  // 自带 insight 字段(C2 落地),覆盖 initialInsight。
  let initialInsight: BoardInsightDTO | null = null;

  if (current) {
    week = current.week;

    // 视频 velocity + 精简投影(含 trendingContext 透传)
    cards = computeVelocity(current, previous).map((v) => ({
      id: v.id,
      platform: v.platform,
      url: v.url,
      cover: v.cover,
      title: v.title,
      topic: v.topic,
      views: v.views,
      // 透传 trendingContext:TikTok trending 视频带此字段,IG 视频不带
      ...(v.trendingContext ? { trendingContext: v.trendingContext } : {}),
      velocity: v.velocity,
    }));

    // hashtag 级 velocity —— 精简投影(去掉 rankDiff / industryName 等 raw 字段)
    initialTrendingHashtags = computeHashtagVelocity(current, previous).map((h) => ({
      name: h.name,
      rank: h.rank,
      viewCount: h.viewCount,
      videoCount: h.videoCount,
      velocity: h.velocity,
    }));

    initialInsight = projectInsightForBoard(current.insight, "all");
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-6 py-12 lg:px-10">
        <div className="mb-10 text-center">
          <span className="pill mb-4">
            <TrendingUp className="h-3.5 w-3.5 text-[#22d3ee]" />
            平台热点 · 每周更新
          </span>
          <h1 className="text-gradient-primary text-4xl font-semibold tracking-tight md:text-5xl">
            本周 TikTok / Instagram 在涨什么
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/60">
            每周一抓 TikTok 全局趋势 + Instagram 热门标签,按周环比标注涨跌。
          </p>
        </div>
        <TrendingBoard
          initialWeek={week}
          initialCards={cards}
          initialTrendingHashtags={initialTrendingHashtags}
          initialInsight={initialInsight}
        />
      </main>
      <Footer />
    </>
  );
}
