"use client";

import { motion } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  Wrench,
  TrendingUp,
  HelpCircle,
} from "lucide-react";
import type {
  TemplateAuditResult,
  TemplateAuditScore,
} from "@/lib/template-review/types";
import type { ViralVideo } from "@/lib/review-engine/types";

type Props = {
  result: TemplateAuditResult;
  concept: { topic: string; playStyle: string; visualStyle: string };
  modelId?: string;
};

const VERDICT_META = {
  recommended: { label: "推荐立项", color: "#22d3ee", icon: CheckCircle2 },
  conditional: {
    label: "条件通过 · 修改后再立项",
    color: "#f59e0b",
    icon: AlertTriangle,
  },
  not_recommended: { label: "不推荐", color: "#f43f5e", icon: XCircle },
} as const;

const READINESS_META: Record<
  string,
  { label: string; color: string }
> = {
  ready: { label: "已具备", color: "#22d3ee" },
  partial: { label: "部分支持", color: "#f59e0b" },
  missing: { label: "需新建", color: "#f43f5e" },
};

function formatNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function ScoreBar({ s }: { s: TemplateAuditScore }) {
  const pct = (s.score / 5) * 100;
  const color =
    s.score >= 4 ? "#22d3ee" : s.score >= 3 ? "#d946ef" : "#f43f5e";
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">{s.dimension}</span>
        <span className="text-sm font-semibold" style={{ color }}>
          {s.score}/5
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, ${color}aa)` }}
        />
      </div>
      <p className="mt-2 text-xs text-white/60 leading-relaxed">{s.reason}</p>
    </div>
  );
}

function VideoCard({ v }: { v: ViralVideo }) {
  return (
    <a
      href={v.url}
      target="_blank"
      rel="noopener noreferrer"
      className="relative aspect-[9/16] rounded-xl overflow-hidden border border-white/[0.08] hover:border-white/20 transition-colors group bg-white/5"
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
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <div className="text-[10px] uppercase tracking-wider text-white/60">
          {v.platform}
        </div>
        <div className="text-xs font-medium leading-tight line-clamp-2">
          {v.title || v.description}
        </div>
        <div className="mt-1.5 text-[10px] text-white/55">
          ▶ {formatNum(v.views)} · ❤ {formatNum(v.likes)}
        </div>
      </div>
    </a>
  );
}

export function AuditOutput({ result, concept, modelId }: Props) {
  const v = VERDICT_META[result.verdict.level];
  const VIcon = v.icon;
  const avgScore =
    result.scores.reduce((s, x) => s + x.score, 0) / result.scores.length;

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
        <span className="pill">题材：{concept.topic}</span>
        <span className="pill">玩法：{concept.playStyle}</span>
        <span className="pill">视觉：{concept.visualStyle}</span>
      </div>

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
              7 维综合
            </span>
            <span className="text-3xl font-bold text-gradient-accent">
              {avgScore.toFixed(1)}
            </span>
            <span className="text-white/40">/ 5</span>
          </div>
          <div className="space-y-2 mt-4">
            <div className="text-xs uppercase tracking-wider text-white/50">
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

      {/* 7 维评分 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <Sparkles className="w-4 h-4 text-[#d946ef]" />
          <h3 className="text-lg font-semibold">7 维评分</h3>
        </div>
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          {result.scores.map((s) => (
            <ScoreBar key={s.dimension} s={s} />
          ))}
        </div>
      </motion.div>

      {/* 市场信号 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <TrendingUp className="w-4 h-4 text-[#22d3ee]" />
          <h3 className="text-lg font-semibold">市场信号</h3>
        </div>
        <div className="grid md:grid-cols-3 gap-4 mb-5">
          <div className="rounded-xl bg-white/[0.04] p-4">
            <div className="text-xs uppercase tracking-wider text-white/50 mb-1">
              同类爆款
            </div>
            <div className="text-2xl font-bold text-gradient-accent">
              {result.marketSignal.similarViralCount}
            </div>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-4">
            <div className="text-xs uppercase tracking-wider text-white/50 mb-1">
              平均播放
            </div>
            <div className="text-2xl font-bold text-gradient-accent">
              {formatNum(result.marketSignal.avgViews)}
            </div>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-4">
            <div className="text-xs uppercase tracking-wider text-white/50 mb-1">
              主流玩法 #1
            </div>
            <div className="text-base font-semibold mt-1">
              {result.marketSignal.dominantPlayStyles[0]?.name ?? "-"}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <div className="text-xs uppercase tracking-wider text-[#22d3ee] mb-2">
              市场空缺方向
            </div>
            <ul className="space-y-1.5">
              {result.marketSignal.marketGaps.map((g, i) => (
                <li key={i} className="text-sm text-white/80 flex gap-2">
                  <span className="text-[#22d3ee]">+</span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-[#f43f5e] mb-2">
              已过气方向
            </div>
            <ul className="space-y-1.5">
              {result.marketSignal.fadingTrends.map((g, i) => (
                <li key={i} className="text-sm text-white/80 flex gap-2">
                  <span className="text-[#f43f5e]">−</span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </motion.div>

      {/* 能力清单 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <Wrench className="w-4 h-4 text-[#fb7185]" />
          <h3 className="text-lg font-semibold">特效能力清单</h3>
        </div>
        <div className="space-y-2">
          {result.capabilities.map((c, i) => {
            const meta = READINESS_META[c.readiness];
            return (
              <div
                key={i}
                className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]"
              >
                <span
                  className="shrink-0 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-medium"
                  style={{
                    background: `${meta.color}22`,
                    color: meta.color,
                    border: `1px solid ${meta.color}55`,
                  }}
                >
                  {meta.label}
                </span>
                <div>
                  <div className="text-sm font-medium">
                    {c.category} · {c.capability}
                  </div>
                  <div className="text-xs text-white/55 mt-1">{c.note}</div>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* 同类爆款 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <TrendingUp className="w-4 h-4 text-[#8b5cf6]" />
          <h3 className="text-lg font-semibold">
            同类爆款引用（{result.referenceVideos.length}）
          </h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {result.referenceVideos.slice(0, 8).map((v) => (
            <VideoCard key={v.id} v={v} />
          ))}
        </div>
      </motion.div>

      {/* 四段式建议 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />
          <h3 className="text-lg font-semibold">改进建议</h3>
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

      {/* 拷问清单 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
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

      {/* 行动项 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="glass-card p-7"
      >
        <div className="flex items-center gap-2 mb-5">
          <CheckCircle2 className="w-4 h-4 text-[#22d3ee]" />
          <h3 className="text-lg font-semibold">下一步行动</h3>
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
