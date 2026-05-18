"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

import type { InsightBannerData } from "@/lib/insight/generate-banner";

/**
 * Pure display component for the L3+ InsightBanner. Renders nothing when
 * `data` is null (legacy v1 snapshot, no snapshot at all, or LLM+template
 * both produced no insight). Owns the "建议:" UI prefix (T6 C1.1 MED #1
 * deferred here from the data layer, more flexible for future copy tweaks).
 *
 * Visual style mirrors components/review/OutputPanel.tsx (glass-card +
 * framer-motion fade + lucide icon + pill chips), using a violet accent
 * (#a78bfa) to distinguish it from the verdict/score cards above.
 */
type Props = {
  data: InsightBannerData | null;
};

const ACCENT = "#a78bfa";

export function InsightBanner({ data }: Props) {
  if (!data) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-6 relative overflow-hidden"
      aria-label="本周爆款洞察"
    >
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div
          className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium"
          style={{
            background: `${ACCENT}22`,
            color: ACCENT,
            border: `1px solid ${ACCENT}55`,
          }}
        >
          <Sparkles className="w-3.5 h-3.5" />
          本周爆款洞察
        </div>
        <span className="text-xs text-white/50">数据周 {data.sourceWeek}</span>
      </div>

      <h3 className="text-lg font-semibold leading-tight mb-3 text-white/95">
        {data.headline}
      </h3>

      {data.bullets.length > 0 && (
        <ul className="space-y-1.5 mb-4">
          {data.bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-2 text-sm text-white/80"
            >
              <span
                className="mt-1.5 shrink-0 w-1 h-1 rounded-full"
                style={{ background: ACCENT }}
                aria-hidden
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-white/90 leading-relaxed">
        <span className="font-semibold" style={{ color: ACCENT }}>
          建议:
        </span>{" "}
        {data.actionable}
      </p>

      {data.sampleVideoIds.length > 0 && (
        <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-white/50">
          <span>参考视频:</span>
          {data.sampleVideoIds.map((id) => (
            <span
              key={id}
              className="pill"
              style={{
                background: "rgba(167,139,250,0.08)",
                borderColor: "rgba(167,139,250,0.25)",
              }}
            >
              {id}
            </span>
          ))}
        </div>
      )}
    </motion.section>
  );
}
