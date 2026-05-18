"use client";

import { formatVelocityBadge } from "../TrendingCard";
import { TechniqueBar } from "../charts/TechniqueBar";
import type { BoardInsightDTO, TrendingHashtagCard } from "@/app/api/trending/route";

/**
 * Hashtag tab (L3+ plan §6.2):合并 v4.1 velocity 榜 + 新 hashtagTab insight
 * (techniqueDistribution mini-bar / avgDensity / topVideoIds 计数)。
 *
 * 数据源 (同 hashtag.name join):
 * - trendingHashtags: 来自 /api/trending,含 rank / viewCount / videoCount / velocity badge
 *   (原 v4.1 榜),IG 平台为空
 * - hashtagTab: 来自 BoardInsightDTO.hashtagTab,含 techniqueDistribution / avgDensity / topVideoIds
 *   (新 L3+),IG 平台为空 (projectHashtagTab 已剥)
 *
 * Empty state:两个数据源都空 → 提示 (常见于 IG 平台 / v1 老快照)。
 */

type Props = {
  trendingHashtags: TrendingHashtagCard[];
  hashtagInsights: BoardInsightDTO["hashtagTab"];
};

export function HashtagTab({ trendingHashtags, hashtagInsights }: Props) {
  if (trendingHashtags.length === 0 && hashtagInsights.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-sm text-white/40">
        当前平台无 hashtag 榜数据
      </div>
    );
  }

  // Join: hashtag.name → HashtagInsight (techniqueDistribution / avgDensity / topVideoIds)
  const insightByName = new Map(hashtagInsights.map((h) => [h.name, h]));

  return (
    <div className="glass-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-white/70">TikTok 趋势 Hashtag 榜</h2>
      <ul className="space-y-3">
        {trendingHashtags.map((h) => {
          const badge = formatVelocityBadge(h.velocity);
          const insight = insightByName.get(h.name);
          return (
            <li
              key={h.name}
              className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-3">
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
              </div>
              {insight && Object.keys(insight.techniqueDistribution).length > 0 && (
                <div className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 pl-9">
                  <div className="text-[10px] uppercase tracking-wide text-white/30">
                    技法分布
                  </div>
                  <TechniqueBar
                    distribution={insight.techniqueDistribution}
                    maxItems={5}
                  />
                  <div className="text-[10px] uppercase tracking-wide text-white/30">
                    平均密度
                  </div>
                  <div className="text-xs text-white/55">
                    {insight.avgDensity.toFixed(1)}/100
                    {insight.topVideoIds.length > 0 && (
                      <span className="ml-3 text-white/35">
                        · {insight.topVideoIds.length} 个 top 视频已富化
                      </span>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
