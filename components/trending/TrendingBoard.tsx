"use client";

import { useState } from "react";
import { TrendingCard } from "./TrendingCard";
import { PlatformFilter, type Platform } from "./PlatformFilter";
import { InsightTabs, type TabKey } from "./InsightTabs";
import type {
  TrendingCard as TrendingCardData,
  TrendingHashtagCard,
  BoardInsightDTO,
} from "@/app/api/trending/route";

export function TrendingBoard({
  initialWeek,
  initialCards,
  initialTrendingHashtags,
  initialInsight = null,
}: {
  initialWeek: string | null;
  initialCards: TrendingCardData[];
  /** v4.1:hashtag 级 velocity 精简投影,来自 P2.6 RSC / /api/trending(spec 4.7)。 */
  initialTrendingHashtags: TrendingHashtagCard[];
  /**
   * T4 C3 (L3+ plan §5):board DTO seed,RSC 投影注入。
   * v1 老快照 / 无 snapshot → null,T5 C4 检测 null 隐藏 5 个 insight tab,只渲 videos tab。
   * T5 C4 起接管 tab 渲染 + 平台切换时同步刷新本 state。
   */
  initialInsight?: BoardInsightDTO | null;
}) {
  const [platform, setPlatform] = useState<Platform>("all");
  const [cards, setCards] = useState<TrendingCardData[]>(initialCards);
  const [trendingHashtags, setTrendingHashtags] = useState<TrendingHashtagCard[]>(initialTrendingHashtags);
  const [insight, setInsight] = useState<BoardInsightDTO | null>(initialInsight);
  // 默认 tab:insight 有数据 → hashtag (用户主入口);v1 老快照 → videos (唯一可视 tab)
  const [activeTab, setActiveTab] = useState<TabKey>(initialInsight ? "hashtag" : "videos");
  const [loading, setLoading] = useState(false);

  async function handleChange(next: Platform) {
    setPlatform(next);
    setLoading(true);
    try {
      const qs = next === "all" ? "" : `?platform=${next}`;
      const res = await fetch(`/api/trending${qs}`);
      // T4 reviewer M1 fix:fetch 只对网络失败 reject,429 / 5xx 仍 resolved。
      // 不守 !res.ok 会把 error body 当 trending payload 解析,导致 cards/insight
      // 被静默 null-out (UX 误判 = "无数据" 而不是 "请求被限流")。
      if (!res.ok) throw new Error(`trending request failed: ${res.status}`);
      const body = await res.json();
      setCards(body.cards ?? []);
      setTrendingHashtags(body.trendingHashtags ?? []);
      // T4 reviewer N2 fix:平台切换时同步刷新 insight,否则 5 个 insight tab 看
      // 的是初始 (platform="all") 数据,与当前 platform filter 视觉错位。
      setInsight(body.insight ?? null);
    } catch {
      setCards([]);
      setTrendingHashtags([]);
      setInsight(null);
      // reviewer M1 fix:同步把 activeTab 退到 videos,否则 insight=null 时
      // visibleTabs 只剩 videos,而 activeTab 仍指向已隐藏的 insight tab,
      // 用户看到选中按钮凭空消失 + 空 tabpanel 的 UX 故障。
      setActiveTab("videos");
    } finally {
      setLoading(false);
    }
  }

  if (initialWeek === null) {
    return (
      <div className="glass-card p-12 text-center text-white/50">
        首次趋势数据将于下周一生成。
      </div>
    );
  }

  // 视频 grid + loading + empty state 透传给 InsightTabs 的 videos slot
  const videosSlot =
    loading ? (
      <div className="py-12 text-center text-white/40">加载中…</div>
    ) : cards.length === 0 ? (
      <div className="py-12 text-center text-white/40">该平台暂无数据</div>
    ) : (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <TrendingCard key={card.id} card={card} />
        ))}
      </div>
    );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-white/45">本周热点 · {initialWeek}</p>
        <PlatformFilter value={platform} onChange={handleChange} />
      </div>

      {/* C5 reviewer CR2:原 v4.1 顶部 hashtag 榜已挪进 InsightTabs > HashtagTab。
          IG 平台时 HashtagTab 仍渲染空态 (trendingHashtags=[] + hashtagInsights=[]),
          不会重复显示。 */}
      <InsightTabs
        insight={insight}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        platform={platform}
        trendingHashtags={trendingHashtags}
        videosSlot={videosSlot}
      />
    </div>
  );
}
