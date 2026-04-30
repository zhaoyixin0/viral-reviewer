"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { ViralVideo } from "@/lib/review-engine/types";
import { Heart, Eye, MessageCircle, Share2, Music } from "lucide-react";

function formatNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  tiktok: { label: "TikTok", color: "#fb7185" },
  instagram: { label: "Instagram", color: "#d946ef" },
};

type Props = {
  videos: ViralVideo[];
  topics: string[];
  source: "enriched" | "raw" | "seed";
};

export function LibraryClient({ videos, topics, source }: Props) {
  const [topicFilter, setTopicFilter] = useState<string>("全部");
  const [platformFilter, setPlatformFilter] = useState<string>("全部");

  const filtered = useMemo(() => {
    return videos
      .filter(
        (v) =>
          (topicFilter === "全部" || v.topic === topicFilter) &&
          (platformFilter === "全部" || v.platform === platformFilter),
      )
      .sort((a, b) => b.views - a.views);
  }, [videos, topicFilter, platformFilter]);

  const sourceMeta = {
    enriched: { label: "✨ 真实抓取 + LLM 富化", color: "#22d3ee" },
    raw: { label: "📡 真实抓取", color: "#d946ef" },
    seed: { label: "🌱 种子数据", color: "#f59e0b" },
  }[source];

  return (
    <>
      <div className="mb-10">
        <span
          className="pill mb-4"
          style={{
            background: `${sourceMeta.color}1f`,
            borderColor: `${sourceMeta.color}55`,
            color: sourceMeta.color,
          }}
        >
          {sourceMeta.label} · {videos.length} 个视频
        </span>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient-primary">
          爆款库
        </h1>
        <p className="mt-4 text-white/60 max-w-2xl">
          {source === "seed"
            ? "目前展示的是手工策展数据。运行 npm run scrape:tiktok 抓取真实数据。"
            : "从 TikTok 与 Instagram Reels 实时抓取的高互动视频。每条视频都已被结构化为 玩法 / 视觉风格 / hook / BGM / 节奏点。"}
        </p>
      </div>

      <div className="glass-card p-5 mb-8 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-white/50 mb-2">
            题材
          </div>
          <div className="flex flex-wrap gap-2">
            {["全部", ...topics].map((t) => (
              <button
                key={t}
                onClick={() => setTopicFilter(t)}
                className={`pill cursor-pointer transition-all ${
                  topicFilter === t
                    ? "bg-gradient-to-r from-[#8b5cf6]/30 to-[#d946ef]/30 border-[#d946ef]/40 text-white"
                    : "hover:bg-white/10"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-white/50 mb-2">
            平台
          </div>
          <div className="flex flex-wrap gap-2">
            {["全部", "tiktok", "instagram"].map((p) => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={`pill cursor-pointer transition-all ${
                  platformFilter === p
                    ? "bg-gradient-to-r from-[#8b5cf6]/30 to-[#d946ef]/30 border-[#d946ef]/40 text-white"
                    : "hover:bg-white/10"
                }`}
              >
                {p === "全部" ? p : PLATFORM_META[p]?.label ?? p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="text-sm text-white/50 mb-4">
        显示 {filtered.length} 个视频
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filtered.map((v, i) => {
          const meta = PLATFORM_META[v.platform];
          return (
            <motion.a
              key={v.id}
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: (i % 12) * 0.04 }}
              className="group glass-card glass-card-hover overflow-hidden flex flex-col"
            >
              <div className="relative aspect-[9/16] overflow-hidden bg-white/5">
                {v.cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.cover}
                    alt={v.title || v.id}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />

                <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                  <span
                    className="px-2 py-1 rounded-md text-[10px] uppercase font-semibold tracking-wider"
                    style={{
                      background: `${meta?.color}33`,
                      color: meta?.color,
                      border: `1px solid ${meta?.color}66`,
                      backdropFilter: "blur(10px)",
                    }}
                  >
                    {meta?.label}
                  </span>
                  {v.duration > 0 && (
                    <span className="px-2 py-1 rounded-md text-[10px] bg-black/40 backdrop-blur-md text-white/80 border border-white/10">
                      {v.duration}s
                    </span>
                  )}
                </div>

                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="text-xs text-white/60 mb-1">
                    {v.authorHandle}
                  </div>
                  <div className="text-sm font-medium leading-tight line-clamp-2 mb-3">
                    {v.title || v.description || "(无标题)"}
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[10px] text-white/70">
                    <div className="flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      {formatNum(v.views)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Heart className="w-3 h-3" />
                      {formatNum(v.likes)}
                    </div>
                    <div className="flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" />
                      {formatNum(v.comments)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Share2 className="w-3 h-3" />
                      {formatNum(v.shares)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/70">
                    {v.topic}
                  </span>
                  {v.playStyle !== "未分类" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#8b5cf6]/15 text-[#c4b5fd]">
                      {v.playStyle}
                    </span>
                  )}
                  {v.visualStyle !== "未分类" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#d946ef]/15 text-[#f0abfc]">
                      {v.visualStyle}
                    </span>
                  )}
                </div>
                {v.hook !== "需要 LLM 二次提取" && (
                  <div className="text-xs text-white/55 leading-relaxed line-clamp-2">
                    Hook: {v.hook}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-white/50 mt-auto pt-2">
                  <Music className="w-3 h-3" />
                  <span className="truncate">{v.bgm}</span>
                </div>
              </div>
            </motion.a>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="glass-card p-12 text-center text-white/60">
          没有匹配的视频，试试改变筛选条件。
        </div>
      )}
    </>
  );
}
