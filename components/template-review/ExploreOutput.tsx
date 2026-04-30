"use client";

import { motion } from "framer-motion";
import {
  Sparkles,
  TrendingUp,
  XCircle,
  Database,
  Brain,
} from "lucide-react";
import type { ExploreResult } from "@/lib/template-review/types";
import type { ViralVideo } from "@/lib/review-engine/types";

type Props = {
  result: ExploreResult;
  modelId?: string;
  corpusSize: number;
  filter?: { topic?: string; playStyle?: string; platform?: string };
};

function formatNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function ReferenceCard({ v }: { v: ViralVideo }) {
  return (
    <a
      href={v.url}
      target="_blank"
      rel="noopener noreferrer"
      className="relative aspect-[9/16] rounded-lg overflow-hidden border border-white/[0.08] hover:border-white/20 transition-colors group bg-white/5"
    >
      {v.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={v.cover}
          alt={v.title}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-2">
        <div className="text-[9px] uppercase text-white/60">{v.platform}</div>
        <div className="text-[10px] font-medium leading-tight line-clamp-2">
          {v.title || v.description}
        </div>
        <div className="text-[9px] text-white/55 mt-0.5">
          ▶ {formatNum(v.views)}
        </div>
      </div>
    </a>
  );
}

export function ExploreOutput({ result, modelId, corpusSize, filter }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span
          className="pill"
          style={{
            background: "rgba(34,211,238,0.12)",
            borderColor: "rgba(34,211,238,0.3)",
          }}
        >
          ✨ {modelId ?? "Opus 4.7"}
        </span>
        <span className="pill">大盘样本：{corpusSize}</span>
        {filter?.topic && <span className="pill">题材：{filter.topic}</span>}
        {filter?.playStyle && (
          <span className="pill">玩法：{filter.playStyle}</span>
        )}
        {filter?.platform && (
          <span className="pill">平台：{filter.platform}</span>
        )}
      </div>

      {/* 大盘观察 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-7 relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2 bg-[#8b5cf6]" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-[#22d3ee]" />
            <h3 className="text-lg font-semibold">大盘观察</h3>
          </div>
          <p className="text-base text-white/85 leading-relaxed">
            {result.overview}
          </p>
        </div>
      </motion.div>

      {/* 推荐赛道 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center gap-2 mb-4 px-1">
          <Sparkles className="w-4 h-4 text-[#d946ef]" />
          <h3 className="text-lg font-semibold">
            推荐赛道（{result.recommendations.length}）
          </h3>
        </div>
        <div className="space-y-4">
          {result.recommendations.map((r, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card glass-card-hover p-6"
            >
              <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] flex items-center justify-center text-sm font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <h4 className="text-xl font-semibold">{r.trackName}</h4>
                    <p className="text-sm text-white/60 mt-0.5">
                      {r.positioning}
                    </p>
                  </div>
                </div>
                <span
                  className="pill"
                  style={{
                    background:
                      r.source === "data_driven"
                        ? "rgba(34,211,238,0.15)"
                        : "rgba(217,70,239,0.15)",
                    borderColor:
                      r.source === "data_driven"
                        ? "rgba(34,211,238,0.4)"
                        : "rgba(217,70,239,0.4)",
                    color:
                      r.source === "data_driven" ? "#22d3ee" : "#d946ef",
                  }}
                >
                  {r.source === "data_driven" ? (
                    <>
                      <Database className="w-3 h-3" />
                      数据驱动
                    </>
                  ) : (
                    <>
                      <Brain className="w-3 h-3" />
                      LLM 推断
                    </>
                  )}
                </span>
              </div>

              <div className="text-sm text-white/85 mb-4">{r.marketSize}</div>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-white/45 mb-1.5">
                    主流玩法
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.dominantPlayStyles.map((p) => (
                      <span
                        key={p}
                        className="text-xs px-2 py-0.5 rounded bg-[#8b5cf6]/15 text-[#c4b5fd]"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-white/45 mb-1.5">
                    主流视觉
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.dominantVisualStyles.map((p) => (
                      <span
                        key={p}
                        className="text-xs px-2 py-0.5 rounded bg-[#d946ef]/15 text-[#f0abfc]"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-gradient-to-br from-[#8b5cf6]/10 to-[#d946ef]/10 border border-[#d946ef]/20 p-4 mb-4">
                <div className="text-xs uppercase tracking-wider text-[#d946ef] mb-1.5">
                  💡 推荐特效模板
                </div>
                <div className="text-base font-semibold mb-2">
                  {r.suggestedTemplate.name}
                </div>
                <div className="text-sm text-white/75 mb-1">
                  <span className="text-white/45">核心能力：</span>
                  {r.suggestedTemplate.coreCapability}
                </div>
                <div className="text-sm text-white/75">
                  <span className="text-white/45">差异点：</span>
                  {r.suggestedTemplate.differentiator}
                </div>
              </div>

              {r.references && r.references.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs uppercase tracking-wider text-white/45 mb-2">
                    爆款样本
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                    {r.references.slice(0, 4).map((v, idx) => (
                      <ReferenceCard key={idx} v={v} />
                    ))}
                  </div>
                </div>
              )}

              {r.risks.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-[#f43f5e] mb-1.5">
                    风险点
                  </div>
                  <ul className="space-y-1">
                    {r.risks.map((rk, idx) => (
                      <li
                        key={idx}
                        className="text-xs text-white/70 flex gap-2"
                      >
                        <span className="text-[#f43f5e]">⚠</span>
                        {rk}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* 应该规避 */}
      {result.avoidDirections.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card p-7"
        >
          <div className="flex items-center gap-2 mb-4">
            <XCircle className="w-4 h-4 text-[#f43f5e]" />
            <h3 className="text-lg font-semibold">应该规避的方向</h3>
          </div>
          <div className="space-y-2.5">
            {result.avoidDirections.map((a, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-[#f43f5e]/20"
              >
                <span className="text-[#f43f5e] mt-0.5">✗</span>
                <div>
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-xs text-white/55 mt-0.5">{a.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
