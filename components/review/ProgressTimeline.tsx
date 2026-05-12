"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import type { StageEvent } from "@/app/review/page";

type Props = { stages: StageEvent[] };

const STAGE_ICONS: Record<string, string> = {
  topic_inference: "🎯",
  local_lookup: "📚",
  cache_hit: "🗂️",
  live_research: "🔍",
  fallback: "⚠️",
  llm_review: "🧠",
  hashtags: "🏷️",
  scraping_tiktok: "🎵",
  scraping_instagram: "📸",
  enriching: "🤖",
  done: "✅",
  extract: "📝",
  load_corpus: "📦",
  aggregate: "📊",
  llm_explore: "🧭",
  // technique-match pipeline
  download: "⬇️",
  ffprobe: "🎬",
  potential_stage1: "🔬",
  potential_stage2: "🧬",
  load_refs: "📐",
  match_engine: "✂️",
};

export function ProgressTimeline({ stages }: Props) {
  const last = stages[stages.length - 1];

  return (
    <div className="glass-card p-8">
      <div className="flex items-center gap-3 mb-1">
        <Loader2 className="w-5 h-5 animate-spin text-[#d946ef]" />
        <h3 className="text-lg font-semibold">
          {last ? "评审进行中" : "准备中…"}
        </h3>
      </div>
      <p className="text-sm text-white/55 mb-6">
        基于真实爆款数据 + Claude Opus 4.7 深度推理生成报告。首次新题材通常需要 2-3 分钟。
      </p>

      <div className="space-y-3 relative">
        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-gradient-to-b from-[#8b5cf6]/40 via-[#d946ef]/40 to-transparent" />

        {stages.map((s, i) => {
          const isLatest = i === stages.length - 1;
          const icon = STAGE_ICONS[s.stage] ?? "•";
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3 }}
              className="relative flex items-start gap-4 pl-1"
            >
              <div
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm relative z-10 ${
                  isLatest
                    ? "bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] shadow-[0_0_18px_-2px_rgba(217,70,239,0.7)]"
                    : "bg-white/[0.06] border border-white/10"
                }`}
              >
                {isLatest ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#22d3ee]" />
                )}
              </div>
              <div className="flex-1 pt-1">
                <div className="text-sm flex items-center gap-1.5">
                  <span className="opacity-70">{icon}</span>
                  <span className={isLatest ? "text-white" : "text-white/70"}>
                    {s.message}
                  </span>
                </div>
                {(() => {
                  const tags = s.data?.hashtags;
                  if (!Array.isArray(tags) || tags.length === 0) return null;
                  const tagStrs = tags.filter(
                    (t): t is string => typeof t === "string",
                  );
                  return (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tagStrs.map((h) => (
                        <span
                          key={h}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60"
                        >
                          #{h}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          );
        })}

        {stages.length === 0 && (
          <div className="flex items-center gap-3 text-sm text-white/50 pl-1">
            <Sparkles className="w-4 h-4" />
            正在启动…
          </div>
        )}
      </div>
    </div>
  );
}
