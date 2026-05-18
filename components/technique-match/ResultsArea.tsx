"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Scissors, Info, Sparkles, AlertTriangle, Film } from "lucide-react";
import { UserDiagnosis } from "@/components/technique-match/UserDiagnosis";
import { PriorityActions } from "@/components/technique-match/PriorityActions";
import { ReferenceReports } from "@/components/technique-match/ReferenceReports";
import { GlobalDoNots } from "@/components/technique-match/GlobalDoNots";
import { CapCutExport } from "@/components/technique-match/CapCutExport";
import { BgmRecommendations } from "@/components/technique-match/BgmRecommendations";
import { AssemblySummary } from "@/components/technique-match/AssemblySummary";
import { ProgressTimeline } from "@/components/review/ProgressTimeline";
import { InsightBanner } from "@/components/review/InsightBanner";
import type { StageEvent } from "@/app/review/page";
import type { InsightBannerData } from "@/lib/insight/generate-banner";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

export type AnalyzeResponseShape = {
  /** 按上传全集索引的视频 id 数组（Task 4 起 N 视频） */
  userVideoIds: string[];
  /** 按上传全集索引的 MaterialPotential 数组（成功 = MaterialPotential，失败 = null 占位） */
  userPotentials: (MaterialPotential | null)[];
  /** 失败的视频 index（按上传全集索引，I6 约束） */
  failedVideoIndexes: number[];
  referenceSource: string;
  referenceNotice?: string;
  match: TechniqueMatchingResult;
  /** L3+ T6 — present when snapshot.insight exists at review time; null
   * when no v2 snapshot is available. Undefined for legacy callers. */
  insightBanner?: InsightBannerData | null;
};

/**
 * Extract the latest banner payload from the SSE stage stream. The route
 * emits two `insight` events: a `{ loading: true }` skeleton then a
 * `{ banner: ... }` payload. We scan from the tail for the first event
 * carrying `banner` so the banner shows up while Opus is still running.
 *
 * Returns null when no banner has been streamed yet, or when the snapshot
 * has no v2 insight (banner === null).
 */
function deriveBannerFromStages(
  stages: StageEvent[],
): InsightBannerData | null {
  for (let i = stages.length - 1; i >= 0; i--) {
    const s = stages[i];
    if (s.stage !== "insight") continue;
    const d = s.data;
    if (d && typeof d === "object" && "banner" in d) {
      // Server-side Zod (insight-schema + LlmBannerSchema) validates shape
      // before send; trust the wire here.
      const v = (d as { banner?: unknown }).banner;
      return (v as InsightBannerData | null) ?? null;
    }
  }
  return null;
}

export type AnalyzeResultsProps = {
  loading: boolean;
  error: string | null;
  stages: StageEvent[];
  /**
   * 按上传全集 materialIndex 索引的 partial 池；null = 该 index 还没分析完
   * （或最终失败）。Task 13 起按 superset index 渲染 N 张 UserDiagnosis。
   */
  partials: (MaterialPotential | null)[];
  full: AnalyzeResponseShape | null;
  /** 按上传全集索引的视频 URL 数组。N=1 时仍是单元素数组。 */
  videoUrls: string[] | null;
  /** 与 videoUrls 同序对齐的用户文件名数组；元素缺失时由后端退化为 input.mp4。 */
  videoFileNames?: (string | null)[] | null;
  /** 文案：empty state 标题/副标题 */
  emptyTitle?: string;
  emptySubtitle?: string;
};

function pickPrimary(
  potentials: ReadonlyArray<MaterialPotential | null>,
): MaterialPotential | null {
  return potentials.find((p): p is MaterialPotential => p !== null) ?? null;
}

/**
 * 渐进披露的结果展示区：
 *   - loading + 没数据 → ProgressTimeline
 *   - partial 到来（Gemini 完成 userPotential）→ 立即显示 N 张 UserDiagnosis
 *   - full 到来（Opus 完成）→ 追加 PriorityActions / AssemblySummary /
 *     BgmRecommendations / GlobalDoNots / ReferenceReports / CapCutExport
 *
 * 同时被 /technique-match 和 /analyze 两个 page 复用。
 */
export function AnalyzeResults({
  loading,
  error,
  stages,
  partials,
  full,
  videoUrls,
  videoFileNames,
  emptyTitle = "上传你的视频草稿",
  emptySubtitle = "AI 会看完整段视频，找出你的素材能学什么、不能学什么，输出具体到秒的剪辑改动建议。",
}: AnalyzeResultsProps) {
  // superset 长度：partials / userPotentials / videoUrls / videoFileNames 都
  // 按上传全集索引对齐；取最大值确保 N=0/1/M 三种场景都能正确展开。
  const supersetLen = Math.max(
    partials.length,
    full?.userPotentials.length ?? 0,
    videoUrls?.length ?? 0,
    videoFileNames?.length ?? 0,
  );

  const potentialAt = (i: number): MaterialPotential | null => {
    // 优先 full.userPotentials[i]（Opus 完成后的最终数据），fallback partials[i]
    return full?.userPotentials[i] ?? partials[i] ?? null;
  };

  const fileNameAt = (i: number): string | null =>
    videoFileNames?.[i] ?? null;

  const fastLaneCards = Array.from({ length: supersetLen }, (_, i) => ({
    index: i,
    potential: potentialAt(i),
    fileName: fileNameAt(i),
  }));
  const hasAnyPotential = fastLaneCards.some((c) => c.potential !== null);
  const primaryPotential =
    pickPrimary(full?.userPotentials ?? []) ?? pickPrimary(partials);

  const showFastLane = hasAnyPotential || full !== null;
  const showDeepLane = full !== null;
  const showTimeline = loading && !showDeepLane;
  const showSingleHeader = supersetLen <= 1;

  const exportVideoUrls = videoUrls ?? [];
  const exportVideoFileNames = (videoFileNames ?? [])
    .map((n) => n ?? undefined)
    .slice(0, exportVideoUrls.length);

  // L3+ T6: banner — full.insightBanner authoritative once result lands;
  // before that, latest `insight` stage event provides the data.
  const insightBanner =
    full?.insightBanner ?? deriveBannerFromStages(stages);

  return (
    <div className="space-y-6">
      {/* L3+ T6: InsightBanner 顶部插入 — null 时组件自身返 null 不占位 */}
      <AnimatePresence>
        {insightBanner && (
          <motion.div
            key="insight-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <InsightBanner data={insightBanner} />
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Fast lane: N 张 UserDiagnosis（按上传全集索引） */}
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
            <div className="space-y-4">
              {fastLaneCards.map(({ index, potential, fileName }) => (
                <div key={`diag-${index}`} className="space-y-2">
                  {!showSingleHeader && (
                    <div className="flex items-center gap-2 text-xs text-white/70">
                      <Film className="w-3.5 h-3.5 text-[#22d3ee]" />
                      <span className="font-medium">
                        素材 {index + 1}
                        {fileName ? (
                          <span className="text-white/45 font-normal">
                            {" "}
                            · {fileName}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )}
                  {potential ? (
                    <UserDiagnosis potential={potential} />
                  ) : (
                    <div className="glass-card p-4 border border-[#f59e0b]/30 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-[#f59e0b] shrink-0" />
                      <span className="text-xs text-white/70">
                        {loading
                          ? "等待 Gemini 分析完成…"
                          : "这段素材分析失败，已跳过；其它素材正常输出。"}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Deep lane: 爆款对标 + 优先级 + 编排清单 + 配乐 + 导出（Opus 完成后） */}
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
            {full.match.assemblyTimeline && (
              <AssemblySummary
                timeline={full.match.assemblyTimeline}
                videoFileNames={videoFileNames ?? undefined}
              />
            )}
            <BgmRecommendations bgms={full.match.recommendedBgms ?? []} />
            {exportVideoUrls.length > 0 && primaryPotential && (
              <CapCutExport
                videoUrls={exportVideoUrls}
                videoFileNames={
                  exportVideoFileNames.length > 0
                    ? exportVideoFileNames
                    : undefined
                }
                userPotential={primaryPotential}
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
