"use client";

import { useState } from "react";
import { TrendingCard, formatVelocityBadge } from "./TrendingCard";
import { PlatformFilter, type Platform } from "./PlatformFilter";
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
   * T5 C4-C6 接管 tab 渲染 + 平台切换时同步刷新本 state。
   */
  initialInsight?: BoardInsightDTO | null;
}) {
  const [platform, setPlatform] = useState<Platform>("all");
  const [cards, setCards] = useState<TrendingCardData[]>(initialCards);
  const [trendingHashtags, setTrendingHashtags] = useState<TrendingHashtagCard[]>(initialTrendingHashtags);
  const [loading, setLoading] = useState(false);

  async function handleChange(next: Platform) {
    setPlatform(next);
    setLoading(true);
    try {
      const qs = next === "all" ? "" : `?platform=${next}`;
      const res = await fetch(`/api/trending${qs}`);
      const body = await res.json();
      setCards(body.cards ?? []);
      setTrendingHashtags(body.trendingHashtags ?? []);
    } catch {
      setCards([]);
      setTrendingHashtags([]);
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

  // hashtag 榜:平台筛选为 Instagram 时隐藏(IG 无 trendingHashtags,spec 4.7)
  const showHashtagBoard = platform !== "instagram" && trendingHashtags.length > 0;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-white/45">本周热点 · {initialWeek}</p>
        <PlatformFilter value={platform} onChange={handleChange} />
      </div>

      {/* v4.1:趋势 hashtag 榜(仅 TikTok,spec 4.7) */}
      {showHashtagBoard && (
        <div className="glass-card mb-8 p-4">
          <h2 className="mb-3 text-sm font-semibold text-white/70">TikTok 趋势 Hashtag 榜</h2>
          <ul className="space-y-2">
            {trendingHashtags.map((h) => {
              const badge = formatVelocityBadge(h.velocity);
              return (
                <li
                  key={h.name}
                  className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-sm"
                >
                  <span className="w-6 text-right text-xs text-white/40">#{h.rank}</span>
                  <span className="flex-1 font-medium text-white/85">#{h.name}</span>
                  <span className="text-xs text-white/45">
                    {(h.viewCount / 1_000_000).toFixed(1)}M 播放
                  </span>
                  <span className="text-xs text-white/45">{h.videoCount} 视频</span>
                  <span
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ background: `${badge.color}26`, color: badge.color }}
                  >
                    <badge.Icon className="h-3 w-3" />
                    {badge.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 视频卡片网格 */}
      {loading ? (
        <div className="py-12 text-center text-white/40">加载中…</div>
      ) : cards.length === 0 ? (
        <div className="py-12 text-center text-white/40">该平台暂无数据</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((card) => (
            <TrendingCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
