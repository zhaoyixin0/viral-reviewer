"use client";

import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { TechniqueBar } from "../charts/TechniqueBar";
import type { Platform } from "../PlatformFilter";
import type { BoardInsightDTO } from "@/app/api/trending/route";

/**
 * Technique tab (L3+ plan §6.2):全局技法分布 + 周环比 trend badge。
 *
 * 数据源:BoardInsightDTO.techniqueTab (按 share 降序)。
 * trend = "rising" | "stable" | "falling" | "new" 来自 projection 层 derive
 * (基于 velocity.techniqueWoW 5pp 阈值,与 aggregate.ts 同 noise floor)。
 *
 * W3 carryover #1:platform === "instagram" 时显示 "基于 TikTok 趋势" disclaimer,
 * 因为 techniqueTab 是全局 (跨平台) 加权聚合,但 hashtagInsights 源头是 TT 独占
 * (aggregate.ts:224 buildHashtagInsight from trendingHashtags),所以 IG 用户
 * 看到的技法实际是 TT 数据。
 */

type Props = {
  techniques: BoardInsightDTO["techniqueTab"];
  platform: Platform;
};

const TREND_META: Record<
  BoardInsightDTO["techniqueTab"][number]["trend"],
  { label: string; color: string; Icon: typeof TrendingUp }
> = {
  rising: { label: "上升", color: "#22d3ee", Icon: TrendingUp },
  falling: { label: "下降", color: "#f87171", Icon: TrendingDown },
  stable: { label: "稳定", color: "#94a3b8", Icon: Minus },
  new: { label: "新出现", color: "#a78bfa", Icon: Sparkles },
};

export function TechniqueTab({ techniques, platform }: Props) {
  if (techniques.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-sm text-white/40">
        本周暂无技法分布数据
      </div>
    );
  }

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/70">本周技法分布</h2>
        {platform === "instagram" && (
          <span
            className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] text-white/55"
            title="技法分布的源头来自 TikTok trending hashtag 富化样本,IG 视频未参与聚合"
          >
            基于 TikTok 趋势
          </span>
        )}
      </div>

      <div className="mb-4">
        <TechniqueBar
          distribution={Object.fromEntries(
            techniques.map((t) => [t.technique, t.share]),
          )}
          maxItems={10}
        />
      </div>

      <ul className="space-y-1.5">
        {techniques.map((t) => {
          const meta = TREND_META[t.trend];
          return (
            <li
              key={t.technique}
              className="flex items-center gap-3 rounded bg-white/[0.03] px-3 py-2 text-xs"
            >
              <span className="flex-1 font-medium text-white/80">{t.technique}</span>
              <span className="w-12 text-right text-white/55">
                {(t.share * 100).toFixed(1)}%
              </span>
              <span
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
                style={{ background: `${meta.color}26`, color: meta.color }}
              >
                <meta.Icon className="h-3 w-3" />
                {meta.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
