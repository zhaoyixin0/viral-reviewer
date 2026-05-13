"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Scissors, Info, Sparkles } from "lucide-react";
import { UserDiagnosis } from "@/components/technique-match/UserDiagnosis";
import { PriorityActions } from "@/components/technique-match/PriorityActions";
import { ReferenceReports } from "@/components/technique-match/ReferenceReports";
import { GlobalDoNots } from "@/components/technique-match/GlobalDoNots";
import { CapCutExport } from "@/components/technique-match/CapCutExport";
import { BgmRecommendations } from "@/components/technique-match/BgmRecommendations";
import { ProgressTimeline } from "@/components/review/ProgressTimeline";
import type { StageEvent } from "@/app/review/page";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

export type AnalyzeResponseShape = {
  userVideoId: string;
  userPotential: MaterialPotential;
  referenceSource: string;
  referenceNotice?: string;
  match: TechniqueMatchingResult;
};

export type AnalyzeResultsProps = {
  loading: boolean;
  error: string | null;
  stages: StageEvent[];
  partial: { userVideoId: string; userPotential: MaterialPotential } | null;
  full: AnalyzeResponseShape | null;
  videoUrl: string | null;
  /** 文案：empty state 标题/副标题 */
  emptyTitle?: string;
  emptySubtitle?: string;
};

/**
 * 渐进披露的结果展示区：
 *   - loading + 没数据 → ProgressTimeline
 *   - partial 到来（Gemini 完成 userPotential）→ 立即显示 UserDiagnosis（fast lane）
 *   - full 到来（Opus 匹配完成）→ 追加显示 PriorityActions / BgmRecommendations /
 *     GlobalDoNots / ReferenceReports / CapCutExport（deep lane）
 *
 * 同时被 /technique-match 和 /analyze 两个 page 复用。
 */
export function AnalyzeResults({
  loading,
  error,
  stages,
  partial,
  full,
  videoUrl,
  emptyTitle = "上传你的视频草稿",
  emptySubtitle = "AI 会看完整段视频，找出你的素材能学什么、不能学什么，输出具体到秒的剪辑改动建议。",
}: AnalyzeResultsProps) {
  const showFastLane = partial !== null || full !== null;
  const showDeepLane = full !== null;
  const showTimeline = loading && !showDeepLane;

  return (
    <div className="space-y-6">
      {/* Progress timeline 在 Opus 完成前一直挂着，partial 出现也不影响 */}
      <AnimatePresence>
        {showTimeline && (
          <motion.div
            key="timeline"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ProgressTimeline stages={stages} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass-card p-8 border border-[#f43f5e]/30"
          >
            <div className="text-[#f43f5e] font-semibold mb-2">出错了</div>
            <p className="text-sm text-white/70">{error}</p>
          </motion.div>
        )}

        {!loading && !error && !showFastLane && stages.length === 0 && (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass-card p-12 text-center"
          >
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] mb-5">
              <Scissors className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-xl font-semibold mb-2">{emptyTitle}</h3>
            <p className="text-sm text-white/60 max-w-md mx-auto">
              {emptySubtitle}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fast lane: 用户素材诊断（Gemini Stage 1 后立即显示） */}
      <AnimatePresence>
        {showFastLane && (
          <motion.div
            key="fast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 bg-[#22d3ee]/15 border border-[#22d3ee]/30 text-[10px] uppercase tracking-wider text-[#22d3ee]">
                <Sparkles className="w-3 h-3" />
                Fast Lane · Gemini 已完成
              </span>
              {!showDeepLane && (
                <span className="text-xs text-white/45">
                  Opus 爆款对标分析中…
                </span>
              )}
            </div>
            <UserDiagnosis
              potential={(full?.userPotential ?? partial?.userPotential)!}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Deep lane: 爆款对标 + 优先级 + 配乐 + 导出（Opus 完成后） */}
      <AnimatePresence>
        {showDeepLane && full && (
          <motion.div
            key="deep"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 bg-[#a78bfa]/15 border border-[#a78bfa]/30 text-[10px] uppercase tracking-wider text-[#a78bfa]">
                <Sparkles className="w-3 h-3" />
                Deep Lane · Opus 4.7 双向匹配完成
              </span>
            </div>
            {full.referenceNotice && (
              <div className="rounded-lg p-3 bg-[#22d3ee]/10 border border-[#22d3ee]/30 flex items-start gap-2">
                <Info className="w-4 h-4 text-[#22d3ee] shrink-0 mt-0.5" />
                <p className="text-xs text-white/75 leading-relaxed">
                  {full.referenceNotice}
                </p>
              </div>
            )}
            <PriorityActions match={full.match} />
            <BgmRecommendations bgms={full.match.recommendedBgms ?? []} />
            {videoUrl && (
              <CapCutExport
                videoUrl={videoUrl}
                userPotential={full.userPotential}
                match={full.match}
              />
            )}
            <GlobalDoNots items={full.match.globalDoNots} />
            <ReferenceReports match={full.match} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
