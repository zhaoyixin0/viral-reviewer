"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Film, AlertOctagon } from "lucide-react";
import type { TechniqueMatchingResult, TechniqueMatchReport, Verdict } from "@/lib/technique-matching/types";

const VERDICT_META: Record<
  Verdict,
  { label: string; color: string; emoji: string }
> = {
  learn: { label: "学", color: "#22d3ee", emoji: "★" },
  adapt: { label: "改造后学", color: "#f59e0b", emoji: "◇" },
  skip: { label: "不要学", color: "#fb7185", emoji: "✗" },
  inverse: { label: "学反例", color: "#a78bfa", emoji: "↺" },
};

function FitScoreCircle({ score }: { score: number }) {
  const color =
    score >= 70 ? "#22d3ee" : score >= 40 ? "#f59e0b" : "#fb7185";
  return (
    <div
      className="shrink-0 w-14 h-14 rounded-full flex items-center justify-center font-bold text-base relative"
      style={{
        background: `conic-gradient(${color} ${score * 3.6}deg, rgba(255,255,255,0.06) 0deg)`,
      }}
    >
      <div className="absolute inset-1 rounded-full bg-[rgba(8,8,12,0.92)] flex items-center justify-center">
        <span style={{ color }}>{score}</span>
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: TechniqueMatchReport }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left p-5 hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-start gap-4">
          <FitScoreCircle score={report.overallFitScore} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/45 mb-1">
              {report.referenceVideoId}
            </div>
            <p className="text-sm font-medium text-white leading-relaxed">
              {report.referencePositioning}
            </p>
            <p className="mt-1.5 text-xs text-white/60">{report.fitSummary}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(["learn", "adapt", "inverse", "skip"] as const).map((v) => {
                const count = report.recommendations.filter(
                  (r) => r.verdict === v,
                ).length;
                if (count === 0) return null;
                const meta = VERDICT_META[v];
                return (
                  <span
                    key={v}
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{
                      background: `${meta.color}22`,
                      color: meta.color,
                      border: `1px solid ${meta.color}44`,
                    }}
                  >
                    {meta.emoji} {meta.label} {count}
                  </span>
                );
              })}
            </div>
          </div>
          {open ? (
            <ChevronUp className="w-4 h-4 text-white/40 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-white/40 shrink-0" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] p-5 space-y-4 bg-black/20">
          {report.bigPictureWarnings.length > 0 && (
            <div className="rounded-lg p-3 bg-[#f59e0b]/10 border border-[#f59e0b]/30">
              <div className="flex items-center gap-1.5 text-xs text-[#f59e0b] font-medium mb-1.5">
                <AlertOctagon className="w-3.5 h-3.5" />
                整体警告
              </div>
              <ul className="text-xs text-white/75 space-y-1 list-disc pl-4">
                {report.bigPictureWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            {report.recommendations.map((rec, i) => {
              const meta = VERDICT_META[rec.verdict];
              return (
                <div
                  key={i}
                  className="rounded-lg p-4 bg-white/[0.03] border border-white/[0.06]"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded"
                        style={{
                          background: `${meta.color}22`,
                          color: meta.color,
                          border: `1px solid ${meta.color}44`,
                        }}
                      >
                        {meta.emoji} {meta.label.toUpperCase()}
                      </span>
                      <span className="text-[10px] text-white/40">
                        {rec.priority}
                      </span>
                      <span className="text-[10px] text-white/30">
                        {rec.technique.category}
                      </span>
                    </div>
                    {rec.userVideoAt && (
                      <span className="text-[11px] text-white/55 shrink-0">
                        @ user {rec.userVideoAt.sec.toFixed(1)}s
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium text-white mb-1.5">
                    {rec.technique.name}
                  </p>
                  <p className="text-xs text-white/55 mb-2 italic">
                    {rec.technique.description}
                  </p>
                  <p className="text-xs text-white/70 mb-2">
                    <span className="text-white/45">理由：</span>
                    {rec.reasoning}
                  </p>

                  {rec.adaptationNotes && (
                    <p className="text-xs text-[#f59e0b]/90 mb-2">
                      <span className="text-white/45">改造：</span>
                      {rec.adaptationNotes}
                    </p>
                  )}

                  {rec.actionableSteps.length > 0 && (
                    <div className="mt-2 rounded p-2 bg-black/30">
                      <div className="text-[10px] text-white/45 mb-1">
                        操作步骤
                      </div>
                      <ul className="text-xs text-white/80 space-y-1">
                        {rec.actionableSteps.map((s, j) => (
                          <li key={j} className="flex gap-1.5 leading-relaxed">
                            <span className="text-white/30 shrink-0">{j + 1}.</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="mt-2 text-[11px] text-white/45">
                    <span className="text-white/35">预期效果：</span>
                    {rec.expectedImpact}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ReferenceReports({ match }: { match: TechniqueMatchingResult }) {
  if (match.reports.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Film className="w-4 h-4 text-[#8b5cf6]" />
        <h3 className="text-base font-semibold">
          爆款对照详情
        </h3>
        <span className="text-xs text-white/45">
          ({match.reports.length} 条爆款) · 点击展开
        </span>
      </div>
      <div className="space-y-3">
        {[...match.reports]
          .sort((a, b) => b.overallFitScore - a.overallFitScore)
          .map((r) => (
            <ReportCard key={r.referenceVideoId} report={r} />
          ))}
      </div>
    </div>
  );
}
