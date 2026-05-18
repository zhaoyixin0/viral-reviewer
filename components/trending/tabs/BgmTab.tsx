"use client";

import { TrendingUp, TrendingDown, Minus, Sparkles, Music } from "lucide-react";
import type { BoardInsightDTO } from "@/app/api/trending/route";

/**
 * BGM tab (L3+ plan §6.2):top-10 BGM list,hitCount + trend badge + Gemini
 * "trending" 角标。
 *
 * 数据源:BoardInsightDTO.bgmTab (projection 已 slice(0, 10) + join velocity.bgmWoW)。
 *
 * **W3 carryover #2** (CRITICAL UX 防回归):trending 字段是三值
 * `boolean | null | undefined`,**必须** `entry.trending === true` 严格判断,
 * **不能** truthy/nullish-coalescing。否则:
 * - `false` (Gemini 标过不 trending) 被吞 → UI 误标 "未知"
 * - `null` (W4 sentinel 显式 "标过非 trending") 被吞 → 同上
 * - 只有 `undefined` (未标) 应该不显示角标
 */

type Props = {
  bgms: BoardInsightDTO["bgmTab"];
};

type BgmTrend = Required<BoardInsightDTO["bgmTab"][number]>["trend"];

const TREND_META: Record<BgmTrend, { label: string; color: string; Icon: typeof TrendingUp }> = {
  rising: { label: "上升", color: "#22d3ee", Icon: TrendingUp },
  falling: { label: "下降", color: "#f87171", Icon: TrendingDown },
  stable: { label: "稳定", color: "#94a3b8", Icon: Minus },
  new: { label: "新出现", color: "#a78bfa", Icon: Sparkles },
};

export function BgmTab({ bgms }: Props) {
  if (bgms.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-sm text-white/40">
        本周暂无 BGM 数据
      </div>
    );
  }

  return (
    <div className="glass-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-white/70">本周热门 BGM (top 10)</h2>
      <ul className="space-y-2">
        {bgms.map((b, idx) => {
          const meta = b.trend ? TREND_META[b.trend] : null;
          // W3 carryover #2:严格 === true,见 file-level JSDoc
          const isExplicitlyTrending = b.trending === true;
          return (
            <li
              key={`${b.name}-${idx}`}
              className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-sm"
            >
              <span className="w-6 text-right text-xs text-white/40">#{idx + 1}</span>
              <Music className="h-3.5 w-3.5 text-white/35" />
              <span className="flex-1 truncate font-medium text-white/85" title={b.name}>
                {b.name}
              </span>
              {isExplicitlyTrending && (
                <span
                  className="rounded bg-[#facc15]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#facc15]"
                  title="Gemini 富化时标记为 trending BGM"
                >
                  Trending
                </span>
              )}
              <span className="text-xs text-white/45">{b.hitCount} 次命中</span>
              {meta && (
                <span
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: `${meta.color}26`, color: meta.color }}
                >
                  <meta.Icon className="h-3 w-3" />
                  {meta.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
