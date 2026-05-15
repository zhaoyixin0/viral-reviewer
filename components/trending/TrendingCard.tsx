import { TrendingUp, TrendingDown, Sparkles, Minus } from "lucide-react";
import type { TrendingCard as TrendingCardData } from "@/app/api/trending/route";

type Velocity = TrendingCardData["velocity"];

type Badge = {
  label: string;
  color: string;
  Icon: typeof TrendingUp;
};

/**
 * 防御 javascript:/data: URI 等非 http(s) scheme 走进 <a href>。
 * card.url 来自 Apify scraped 数据,上游不可信 —— 渲染边界必须自带 scheme guard。
 * 非 http(s) → 返回 undefined,React 会 omit href 属性,a 标签退化为不可点击文本。
 */
export function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/**
 * velocity → badge 文案。纯函数,单独测。
 * architect L4:weekOverWeek 为 null(首周 / 上周无此条 / schemaVersion 不一致)
 * 一律渲染 NEW,绝不产出 +null% / NaN%。
 */
export function formatVelocityBadge(velocity: Velocity): Badge {
  if (velocity.trend === "new" || velocity.weekOverWeek === null) {
    return { label: "NEW", color: "#22d3ee", Icon: Sparkles };
  }
  if (velocity.trend === "rising") {
    const pct = Math.round(velocity.weekOverWeek * 100);
    return { label: `+${pct}%`, color: "#22c55e", Icon: TrendingUp };
  }
  if (velocity.trend === "falling") {
    const pct = Math.round(velocity.weekOverWeek * 100);
    return { label: `${pct}%`, color: "#f43f5e", Icon: TrendingDown };
  }
  return { label: "持平", color: "#94a3b8", Icon: Minus };
}

function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(0)}K`;
  return String(views);
}

export function TrendingCard({ card }: { card: TrendingCardData }) {
  const badge = formatVelocityBadge(card.velocity);
  const platformLabel = card.platform === "tiktok" ? "TT" : "IG";

  return (
    <a
      href={safeHref(card.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="glass-card group block overflow-hidden transition-transform hover:-translate-y-1"
    >
      <div className="relative aspect-[9/16] bg-white/[0.04]">
        {card.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.cover}
            alt={card.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-white/30 text-xs">
            无封面
          </div>
        )}
        {/* 平台角标 */}
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {platformLabel}
        </span>
        {/* velocity badge */}
        <span
          className="absolute right-2 top-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{ background: `${badge.color}26`, color: badge.color }}
        >
          <badge.Icon className="h-3 w-3" />
          {badge.label}
        </span>
      </div>
      <div className="p-3">
        <p className="line-clamp-2 text-sm text-white/85">{card.title}</p>
        <div className="mt-2 flex items-center justify-between text-xs text-white/45">
          <span>{card.topic || "未分类"}</span>
          <span>{formatViews(card.views)} 播放</span>
        </div>
        {/* v4.1:TikTok trending 视频来源 hashtag 小字(spec 4.7) */}
        {card.trendingContext && (
          <p className="mt-1 text-[10px] text-white/40">
            来自趋势 #{card.trendingContext.hashtag}(榜 #{card.trendingContext.hashtagRank})
          </p>
        )}
        {card.platform === "instagram" && (
          <p className="mt-1 text-[10px] text-white/30">热门标签代理</p>
        )}
      </div>
    </a>
  );
}
