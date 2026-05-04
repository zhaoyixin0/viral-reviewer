"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Target,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import type {
  BrainstormResult,
  BrainstormIdea,
  BrainstormSingleResult,
  BrainstormCompareResult,
} from "@/lib/template-review/types";
import {
  DIVERGENCE_METHODS_BY_ID,
  type DivergenceMethodId,
} from "@/lib/template-review/divergence-methods";

type Props = {
  result: BrainstormResult;
  modelId?: string;
  retrieved?: { topic: string; source: string; matched: boolean };
};

export function BrainstormOutput({ result, modelId, retrieved }: Props) {
  return (
    <div className="space-y-6">
      <Meta result={result} modelId={modelId} retrieved={retrieved} />

      {result.diversityWarning && (
        <DiversityWarning text={result.diversityWarning} />
      )}

      {result.mode === "single" ? (
        <SingleResult result={result} />
      ) : (
        <CompareResult result={result} />
      )}
    </div>
  );
}

function Meta({
  result,
  modelId,
  retrieved,
}: {
  result: BrainstormResult;
  modelId?: string;
  retrieved?: { topic: string; source: string; matched: boolean };
}) {
  const totalIdeas =
    result.mode === "single"
      ? result.ideas.length
      : result.methodA.ideas.length + result.methodB.ideas.length;

  const sourceLabel: Record<string, string> = {
    local: "本地爆款库",
    cache: "本周缓存",
    live: "实时抓取",
    fallback: "跨题材通用",
  };

  return (
    <div className="glass-card p-5 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-[#d946ef]" />
        <span className="text-sm text-white/85">
          产出 <strong className="text-white">{totalIdeas}</strong> 条 idea
        </span>
      </div>
      {modelId && (
        <span className="text-xs text-white/45">{modelId}</span>
      )}
      {retrieved && (
        <span className="text-xs text-white/45">
          · benchmark：{sourceLabel[retrieved.source] || retrieved.source}
          {retrieved.matched ? "（同题材）" : "（无同题材，跨题材兜底）"}
        </span>
      )}
    </div>
  );
}

function DiversityWarning({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-[#fbbf24]/30 bg-[#fbbf24]/5 p-4 flex gap-3"
    >
      <AlertTriangle className="w-5 h-5 text-[#fbbf24] flex-shrink-0" />
      <div className="text-sm text-white/85">
        <div className="font-medium text-[#fbbf24] mb-1">主题趋同警告</div>
        <p className="text-white/65">{text}</p>
      </div>
    </motion.div>
  );
}

function SingleResult({ result }: { result: BrainstormSingleResult }) {
  const method = DIVERGENCE_METHODS_BY_ID[result.methodId];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          发散方法：{method.name}
          <span className="ml-2 text-sm text-white/50 font-normal">
            ({method.shortLabel})
          </span>
        </h2>
        <RuleCheckBadge passed={result.ruleCheck.passed} />
      </div>
      <div className="space-y-3">
        {result.ideas.map((idea, i) => (
          <IdeaCard key={i} idea={idea} index={i + 1} accent="primary" />
        ))}
      </div>
      {result.ruleCheck.violations.length > 0 && (
        <RuleViolations violations={result.ruleCheck.violations} />
      )}
    </div>
  );
}

function CompareResult({ result }: { result: BrainstormCompareResult }) {
  const a = DIVERGENCE_METHODS_BY_ID[result.methodA.id];
  const b = DIVERGENCE_METHODS_BY_ID[result.methodB.id];
  return (
    <div className="space-y-5">
      <RecommendBanner
        recommended={result.recommendedMethod}
        methodA={result.methodA.id}
        methodB={result.methodB.id}
        summary={result.compareSummary}
      />
      <div className="grid lg:grid-cols-2 gap-5">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-white">
              方法 A · {a.name}
            </h3>
            <RuleCheckBadge passed={result.methodA.ruleCheck.passed} />
          </div>
          <div className="space-y-3">
            {result.methodA.ideas.map((idea, i) => (
              <IdeaCard
                key={`a-${i}`}
                idea={idea}
                index={i + 1}
                accent={
                  result.recommendedMethod === result.methodA.id
                    ? "primary"
                    : "neutral"
                }
              />
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-white">
              方法 B · {b.name}
            </h3>
            <RuleCheckBadge passed={result.methodB.ruleCheck.passed} />
          </div>
          <div className="space-y-3">
            {result.methodB.ideas.map((idea, i) => (
              <IdeaCard
                key={`b-${i}`}
                idea={idea}
                index={i + 1}
                accent={
                  result.recommendedMethod === result.methodB.id
                    ? "primary"
                    : "neutral"
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecommendBanner({
  recommended,
  methodA,
  methodB,
  summary,
}: {
  recommended: DivergenceMethodId;
  methodA: DivergenceMethodId;
  methodB: DivergenceMethodId;
  summary: string;
}) {
  const recName = DIVERGENCE_METHODS_BY_ID[recommended].name;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-[#d946ef]/30 bg-gradient-to-br from-[#8b5cf6]/10 to-[#d946ef]/10 p-5"
    >
      <div className="flex items-start gap-3">
        <Target className="w-5 h-5 text-[#d946ef] flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-[#fbcfe8] mb-2">
            气质对比 + 推荐方向
            <span className="ml-2 px-2 py-0.5 rounded bg-[#d946ef]/20 text-[#fbcfe8] text-xs">
              推荐：{recName}
            </span>
            <span className="ml-1.5 text-xs text-white/40">
              （{methodA === recommended ? "方法 A" : "方法 B"}）
            </span>
          </div>
          <p className="text-sm text-white/80 leading-relaxed whitespace-pre-line">
            {summary}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function RuleCheckBadge({ passed }: { passed: boolean }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded ${
        passed
          ? "bg-[#22c55e]/15 text-[#86efac]"
          : "bg-[#f43f5e]/15 text-[#fda4af]"
      }`}
    >
      {passed ? "Rule 9-16 ✓" : "Rule 9-16 ⚠"}
    </span>
  );
}

function RuleViolations({ violations }: { violations: string[] }) {
  return (
    <div className="rounded-xl border border-[#f43f5e]/30 bg-[#f43f5e]/5 p-4">
      <div className="flex items-center gap-2 text-[#fda4af] mb-2">
        <ShieldAlert className="w-4 h-4" />
        <span className="text-sm font-medium">治理规则违规</span>
      </div>
      <ul className="text-xs text-white/70 space-y-1 list-disc list-inside">
        {violations.map((v, i) => (
          <li key={i}>{v}</li>
        ))}
      </ul>
    </div>
  );
}

function IdeaCard({
  idea,
  index,
  accent,
}: {
  idea: BrainstormIdea;
  index: number;
  accent: "primary" | "neutral";
}) {
  const [expanded, setExpanded] = useState(false);
  const accentClass =
    accent === "primary"
      ? "border-[#8b5cf6]/30 hover:border-[#d946ef]/50"
      : "border-white/10 hover:border-white/20";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`glass-card p-5 border ${accentClass} transition-colors`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] flex items-center justify-center text-xs font-semibold text-white flex-shrink-0">
            {index}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white leading-snug">
              {idea.highlight}
            </h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Tag color="violet">{idea.playbook_mix}</Tag>
              {idea.capabilities_used.slice(0, 4).map((c) => (
                <Tag key={c} color="blue">
                  {c}
                </Tag>
              ))}
              {idea.capabilities_used.length > 4 && (
                <Tag color="blue">+{idea.capabilities_used.length - 4}</Tag>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-white/50 hover:text-white/85 flex-shrink-0"
        >
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      <p className="text-sm text-white/70 leading-relaxed mb-3">
        {idea.core_play}
      </p>

      <div className="flex items-start gap-2 text-xs text-white/55 mb-3">
        <Lightbulb className="w-3.5 h-3.5 text-[#fbbf24] flex-shrink-0 mt-0.5" />
        <span>
          <span className="text-white/40">对标：</span>
          {idea.market_reference}
        </span>
      </div>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="border-t border-white/10 pt-4 space-y-3 text-xs"
        >
          <Field label="output_form 产出形态" value={idea.output_form} />
          <Field label="context_signals 触发场景" value={idea.context_signals} />
          <Field label="user_intent_gap 需求缺口" value={idea.user_intent_gap} />
          <Field label="user_motivation 底层动机" value={idea.user_motivation} />
          <Field label="interaction_flow 操作链路" value={idea.interaction_flow} />
          <Field
            label="ai_necessity AI 必要性自证 (Rule 12)"
            value={idea.ai_necessity}
            highlight
          />
          <Field label="goal_fit 目标契合" value={idea.goal_fit} />
          <Field label="consumption_hook 消费钩子" value={idea.consumption_hook} />
          <Field
            label="interaction_motivation 参与动机 (Rule 15)"
            value={idea.interaction_motivation}
            highlight
          />
          <Field label="risk 风险" value={idea.risk} />
        </motion.div>
      )}
    </motion.div>
  );
}

function Tag({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "violet" | "blue";
}) {
  const cls =
    color === "violet"
      ? "bg-[#8b5cf6]/15 text-[#c4b5fd]"
      : "bg-[#0ea5e9]/15 text-[#7dd3fc]";
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] ${cls}`}>{children}</span>
  );
}

function Field({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div
        className={`text-[10px] uppercase tracking-wider mb-0.5 ${
          highlight ? "text-[#fbbf24]" : "text-white/40"
        }`}
      >
        {label}
      </div>
      <div className="text-white/75 leading-relaxed">{value}</div>
    </div>
  );
}
