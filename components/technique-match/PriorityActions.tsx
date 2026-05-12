"use client";

import { Zap, Clock } from "lucide-react";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

type Props = { match: TechniqueMatchingResult };

const PRIORITY_STYLE = {
  P0: { bg: "from-[#f43f5e]/30 to-[#fb7185]/20", color: "#f43f5e", label: "P0 · 必做" },
  P1: { bg: "from-[#f59e0b]/25 to-[#fb923c]/15", color: "#f59e0b", label: "P1 · 强烈建议" },
  P2: { bg: "from-[#22d3ee]/20 to-[#8b5cf6]/15", color: "#22d3ee", label: "P2 · 锦上添花" },
} as const;

export function PriorityActions({ match }: Props) {
  const actions = match.topPriorityActions;
  if (actions.length === 0) return null;

  // 按 sec 升序
  const sorted = [...actions].sort(
    (a, b) => (a.userVideoAt?.sec ?? 0) - (b.userVideoAt?.sec ?? 0),
  );

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-[#d946ef]" />
        <h3 className="text-base font-semibold">
          按时间轴排序 · 可执行剪辑清单
        </h3>
        <span className="text-xs text-white/45">
          ({sorted.length} 项)
        </span>
      </div>

      <div className="space-y-3">
        {sorted.map((a, i) => {
          const style = PRIORITY_STYLE[a.priority];
          const t = a.userVideoAt?.sec;
          return (
            <div
              key={i}
              className={`relative rounded-xl p-4 bg-gradient-to-br ${style.bg} border border-white/[0.06]`}
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <div
                    className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider"
                    style={{
                      background: `${style.color}33`,
                      color: style.color,
                      border: `1px solid ${style.color}55`,
                    }}
                  >
                    {a.priority}
                  </div>
                  {t !== undefined && (
                    <div className="flex items-center gap-1 text-[11px] text-white/60">
                      <Clock className="w-3 h-3" />
                      {t.toFixed(1)}s
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white leading-relaxed">
                    {a.action}
                  </p>
                  <p className="mt-2 text-[10px] text-white/40">
                    ← from {a.sourcedFromReferenceId}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
