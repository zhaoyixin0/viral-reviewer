"use client";

import { Layers, ArrowRight } from "lucide-react";
import type { AssemblyTimeline } from "@/lib/technique-matching/types";

type Props = {
  timeline: AssemblyTimeline;
  /** 与上传全集对齐的视频文件名数组（用于显示「素材N · xxx.mp4」），可缺。 */
  videoFileNames?: ReadonlyArray<string | null | undefined>;
};

/**
 * 编排枚举 → 中文短标签。catalog 定义在 `lib/capcut-compiler/transitions.ts`，
 * 这里只做 UI 展示用的最小映射，不引 server 侧 module 到 client bundle。
 * 未知类型回退到 type 原文，避免悄悄掩盖 LLM 自由发挥。
 */
const TRANSITION_LABEL: Record<string, string> = {
  hard_cut: "硬切",
  cross_dissolve: "叠化",
  fade: "叠化",
  whip_pan: "Slick Twist",
  match_cut: "替换",
  flash: "流行切换",
  push_in_transition: "推近",
  blur: "模糊",
  zoom_carousel: "缩放轮播",
  wispy_fade: "Wispy Fade",
  flip: "翻转视角",
  glitch: "色差故障",
  distort: "幻影波动",
};

function transitionLabel(type: string): string {
  return TRANSITION_LABEL[type] ?? type;
}

function formatRange(startSec: number, endSec: number): string {
  return `${startSec.toFixed(1)}s – ${endSec.toFixed(1)}s`;
}

function materialLabel(
  index: number,
  fileName: string | null | undefined,
): string {
  const base = `素材 ${index + 1}`;
  return fileName ? `${base} · ${fileName}` : base;
}

/**
 * Task 13：把 Opus 4.7 输出的 AssemblyTimeline 渲染成可读的"编排清单"。
 * 非时间轴可视化 —— 用户不调序，只需"可读确认"。
 *
 * 渲染形态：
 *   素材3 · my.mp4    [叠化 ▶]    素材1 · other.mp4    [推近 ▶]    素材2 · ...
 *   3.0s – 7.5s                   0.0s – 4.2s                       ...
 *   reason ...                    reason ...                         ...
 */
export function AssemblySummary({ timeline, videoFileNames }: Props) {
  const { clips, narrativeSummary, rationale, estimatedDurationSec } = timeline;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-[#8b5cf6]" />
        <h3 className="text-base font-semibold">AI 编排清单</h3>
        <span className="text-xs text-white/45">
          {clips.length} 段 · 约 {estimatedDurationSec.toFixed(1)}s
        </span>
      </div>

      {narrativeSummary && (
        <p className="text-xs text-white/70 leading-relaxed mb-4">
          {narrativeSummary}
        </p>
      )}

      <ol className="space-y-3">
        {clips.map((clip, i) => {
          const transitionType = clip.incomingTransition?.type ?? null;
          return (
            <li
              key={`${clip.order}-${clip.sourceVideoIndex}-${clip.sourceStartSec}`}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
            >
              {i > 0 && transitionType && (
                <div className="flex items-center gap-1.5 text-[10px] text-[#8b5cf6] mb-2">
                  <ArrowRight className="w-3 h-3" />
                  <span className="font-medium">
                    {transitionLabel(transitionType)}
                  </span>
                  <span className="text-white/45">
                    · {clip.incomingTransition!.durationSec.toFixed(2)}s
                  </span>
                  {clip.incomingTransition!.reason && (
                    <span className="text-white/45 truncate">
                      — {clip.incomingTransition!.reason}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <div className="text-sm font-medium text-white">
                  {materialLabel(
                    clip.sourceVideoIndex,
                    videoFileNames?.[clip.sourceVideoIndex] ?? null,
                  )}
                </div>
                <div className="text-xs text-white/55 font-mono shrink-0">
                  {formatRange(clip.sourceStartSec, clip.sourceEndSec)}
                </div>
              </div>

              {clip.animation && (
                <div className="text-[11px] text-white/55 mb-1">
                  动画 · {clip.animation.type}
                  {clip.animation.scaleFrom != null &&
                  clip.animation.scaleTo != null
                    ? ` (${clip.animation.scaleFrom} → ${clip.animation.scaleTo})`
                    : ""}
                </div>
              )}

              {clip.reason && (
                <p className="text-[11px] text-white/65 leading-relaxed">
                  {clip.reason}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {rationale && (
        <p className="text-[11px] text-white/55 leading-relaxed mt-4 pt-3 border-t border-white/[0.06]">
          <span className="text-white/70 font-medium">整体编排理由：</span>
          {rationale}
        </p>
      )}
    </div>
  );
}
