"use client";

import { motion } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  Clock,
  Music,
  Film,
  Subtitles,
  Sparkles,
  ArrowRight,
  HelpCircle,
} from "lucide-react";
import type {
  ReviewResult,
  ReviewScore,
  ViralVideo,
} from "@/lib/review-engine/types";

type Props = {
  result: ReviewResult;
  retrieved: { topic: string; videos: ViralVideo[]; matched: boolean };
  mode: "llm" | "mock";
};

const VERDICT_META = {
  recommended: {
    label: "推荐进入制作",
    color: "#22d3ee",
    icon: CheckCircle2,
  },
  conditional: {
    label: "条件通过 · 修改后再投产",
    color: "#f59e0b",
    icon: AlertTriangle,
  },
  not_recommended: {
    label: "不推荐 · 需要重做",
    color: "#f43f5e",
    icon: XCircle,
  },
} as const;

function formatNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function ScoreBar({ score }: { score: ReviewScore }) {
  const pct = (score.score / 5) * 100;
  const color =
    score.score >= 4 ? "#22d3ee" : score.score >= 3 ? "#d946ef" : "#f43f5e";
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">{score.dimension}</span>
        <span className="text-sm font-semibold" style={{ color }}>
          {score.score}/5
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${color}, ${color}aa)`,
          }}
        />
      </div>
      <p className="mt-2 text-xs text-white/60 leading-relaxed">
        {score.reason}
      </p>
    </div>
  );
}

export function OutputPanel({ result, retrieved, mode }: Props) {
  const v = VERDICT_META[result.verdict.level];
  const VIcon = v.icon;
  const avgScore =
    result.scores.reduce((s, x) => s + x.score, 0) / result.scores.length;

  return (
    <div className="space-y-6">
      {/* Mode badge */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span
          className="pill"
          style={{
            background:
              mode === "llm"
                ? "rgba(34,211,238,0.12)"
                : "rgba(217,70,239,0.12)",
            borderColor:
              mode === "llm"
                ? "rgba(34,211,238,0.3)"
                : "rgba(217,70,239,0.3)",
          }}
        >
          {mode === "llm" ? "✨ LLM 实时生成" : "📋 规则引擎"}
        </span>
        <span
          className="pill"
          style={{
            background: retrieved.matched
              ? undefined
              : "rgba(245,158,11,0.12)",
            borderColor: retrieved.matched
              ? undefined
              : "rgba(245,158,11,0.4)",
            color: retrieved.matched ? undefined : "#fbbf24",
          }}
        >
          {retrieved.matched ? "✓" : "⚠"} 题材：{retrieved.topic}
          {!retrieved.matched && "（库内无同题材样本）"}
        </span>
        <span className="pill">参考爆款：{retrieved.videos.length}</span>
      </div>

      {/* Verdict */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-7 relative overflow-hidden"
      >
        <div
          className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-30 -translate-y-1/2 translate-x-1/2"
          style={{ background: v.color }}
        />
        <div className="relative">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-4"
            style={{
              background: `${v.color}22`,
              color: v.color,
              border: `1px solid ${v.color}55`,
            }}
          >
            <VIcon className="w-4 h-4" />
            {v.label}
          </div>
          <h3 className="text-2xl font-semibold leading-tight mb-4">
            {result.verdict.headline}
          </h3>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-xs uppercase tracking-wider text-white/50">
              综合评分
            </span>
            <span className="text-3xl font-bold text-gradient-accent">
              {avgScore.toFixed(1)}
            </span>
            <span className="text-white/40">/ 5</span>
          </div>
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-white/50 mt-4">
              三大风险
            </div>
            {result.verdict.topRisks.map((r, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-[#f43f5e]" />
                <span className="text-white/80">{r}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Scores */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <Sparkles className="w-4 h-4 text-[#d946ef]" />
          <h3 className="text-lg font-semibold">6 维评分</h3>
        </div>
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          {result.scores.map((s) => (
            <ScoreBar key={s.dimension} score={s} />
          ))}
        </div>
      </motion.div>

      {/* Viral Formula */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <TrendingUp className="w-4 h-4 text-[#22d3ee]" />
          <h3 className="text-lg font-semibold">爆款公式 · {retrieved.topic}</h3>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/50 mb-3">
              主流玩法
            </div>
            <div className="space-y-2">
              {result.viralFormula.playStyles.map((p) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="text-sm flex-1">{p.name}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#d946ef]"
                      style={{ width: `${p.weight * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-white/50 w-8 text-right">
                    {Math.round(p.weight * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-white/50 mb-3">
              视觉风格
            </div>
            <div className="space-y-2">
              {result.viralFormula.visualStyles.map((p) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="text-sm flex-1">{p.name}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#fb7185] to-[#d946ef]"
                      style={{ width: `${p.weight * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-white/50 w-8 text-right">
                    {Math.round(p.weight * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-white/5 grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
              Hook 模式
            </div>
            <div className="text-white/85">{result.viralFormula.hookPattern}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
              时长区间
            </div>
            <div className="text-white/85">{result.viralFormula.avgDuration}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
              BGM 风格
            </div>
            <div className="text-white/85">{result.viralFormula.bgmStyle}</div>
          </div>
        </div>
      </motion.div>

      {/* Timeline */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <Clock className="w-4 h-4 text-[#fb7185]" />
          <h3 className="text-lg font-semibold">按秒优化时间轴</h3>
        </div>
        <div className="space-y-3">
          {result.timeline.map((seg, i) => (
            <div
              key={i}
              className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5"
            >
              <div className="flex items-baseline gap-3 mb-3">
                <span className="text-sm font-mono px-2.5 py-0.5 rounded-md bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white font-semibold">
                  {seg.range}
                </span>
                <span className="text-base font-semibold">{seg.label}</span>
              </div>
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                <div className="flex items-start gap-2">
                  <Film className="w-3.5 h-3.5 mt-0.5 text-white/40 shrink-0" />
                  <div>
                    <span className="text-white/40">镜头：</span>
                    <span className="text-white/80">{seg.shots}</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-white/40 shrink-0" />
                  <div>
                    <span className="text-white/40">转场：</span>
                    <span className="text-white/80">{seg.transition}</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Music className="w-3.5 h-3.5 mt-0.5 text-white/40 shrink-0" />
                  <div>
                    <span className="text-white/40">BGM：</span>
                    <span className="text-white/80">{seg.bgm}</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Subtitles className="w-3.5 h-3.5 mt-0.5 text-white/40 shrink-0" />
                  <div>
                    <span className="text-white/40">字幕：</span>
                    <span className="text-white/80">{seg.subtitles}</span>
                  </div>
                </div>
              </div>
              {seg.tip && (
                <div className="mt-3 pt-3 border-t border-white/5 flex items-start gap-2 text-sm">
                  <Sparkles className="w-3.5 h-3.5 mt-0.5 text-[#fbbf24] shrink-0" />
                  <span className="text-white/75">{seg.tip}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </motion.div>

      {/* Suggestions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />
          <h3 className="text-lg font-semibold">四段式建议</h3>
        </div>
        <div className="space-y-3">
          {result.suggestions.map((s, i) => (
            <div
              key={i}
              className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5"
            >
              <div className="text-base font-semibold mb-3 text-gradient-accent">
                {i + 1}. {s.title}
              </div>
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
                    问题
                  </div>
                  <div className="text-white/80">{s.issue}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
                    影响
                  </div>
                  <div className="text-white/80">{s.impact}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
                    建议
                  </div>
                  <div className="text-white/80">{s.fix}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
                    对标
                  </div>
                  <div className="text-white/80">{s.benchmark}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Interrogation */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <HelpCircle className="w-4 h-4 text-[#06b6d4]" />
          <h3 className="text-lg font-semibold">拷问清单</h3>
        </div>
        <div className="space-y-3">
          {result.interrogation.map((q, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]"
            >
              <span
                className="shrink-0 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-medium"
                style={{
                  background: "rgba(6,182,212,0.12)",
                  color: "#06b6d4",
                  border: "1px solid rgba(6,182,212,0.3)",
                }}
              >
                {q.category}
              </span>
              <span className="text-sm text-white/85">{q.question}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Reference videos */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <TrendingUp className="w-4 h-4 text-[#8b5cf6]" />
          <h3 className="text-lg font-semibold">参考爆款（同题材 top-5）</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {retrieved.videos.map((v) => (
            <a
              key={v.id}
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative aspect-[9/16] rounded-xl overflow-hidden border border-white/[0.08] hover:border-white/20 transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={v.cover}
                alt={v.title}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1">
                  {v.platform}
                </div>
                <div className="text-xs font-medium leading-tight line-clamp-2">
                  {v.title}
                </div>
                <div className="mt-1.5 text-[10px] text-white/50">
                  ▶ {formatNum(v.views)} · ❤ {formatNum(v.likes)}
                </div>
              </div>
            </a>
          ))}
        </div>
      </motion.div>

      {/* Action items */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <CheckCircle2 className="w-4 h-4 text-[#22d3ee]" />
          <h3 className="text-lg font-semibold">下一步行动项</h3>
        </div>
        <div className="space-y-3">
          {result.actions.map((a, i) => (
            <div
              key={i}
              className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-[#22d3ee] to-[#8b5cf6] flex items-center justify-center text-xs font-semibold">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="font-medium mb-2">{a.what}</div>
                  <div className="text-sm text-white/65 mb-1">
                    <span className="text-white/40">怎么改：</span> {a.how}
                  </div>
                  <div className="text-sm text-white/65 mb-1">
                    <span className="text-white/40">为什么：</span> {a.why}
                  </div>
                  <div className="text-sm">
                    <span className="text-white/40">归属：</span>
                    <span className="ml-1 px-2 py-0.5 rounded text-xs bg-white/[0.06]">
                      {a.who}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
