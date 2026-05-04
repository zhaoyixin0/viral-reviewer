"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Wand2 } from "lucide-react";
import { BriefUploader } from "./BriefUploader";
import {
  CAPABILITIES_BY_CATEGORY,
  type Capability,
} from "@/lib/template-review/capabilities-dict";
import {
  DIVERGENCE_METHODS,
  type DivergenceMethodId,
} from "@/lib/template-review/divergence-methods";
import type {
  BrainstormGoal,
  BrainstormInput,
  PlaybookType,
} from "@/lib/template-review/types";

type Props = {
  onSubmit: (input: BrainstormInput) => void;
  isLoading: boolean;
};

const PLAYBOOK_DEFS: { type: PlaybookType; name: string; desc: string }[] = [
  { type: "A", name: "A · 内容玩法", desc: "视觉/听觉/叙事产出" },
  { type: "B", name: "B · 功能玩法", desc: "操作链路/产品交互" },
  { type: "C", name: "C · 机制玩法", desc: "规则/状态/长周期" },
];

const SUGGESTED_GOALS = [
  "传播",
  "留存",
  "付费",
  "人设沉淀",
  "功能拉新",
  "内容生态",
];

const TEMPLATES = [
  {
    label: "DM 节日玩法",
    capabilities: ["ai_face_swap", "vfx_sticker", "tool_dm_trigger"],
    playbookTypes: ["A", "B"] as PlaybookType[],
    goals: [
      { name: "传播", weight: 0.6 },
      { name: "留存", weight: 0.4 },
    ],
    scene: "DM 私信里给好友送春节红包祝福",
    userProblem: "节日给亲友的祝福内容雷同，缺乏个性化和惊喜感",
  },
  {
    label: "AI 短片爆款",
    capabilities: ["ai_text_to_video", "ai_voiceover", "vfx_transition"],
    playbookTypes: ["A"] as PlaybookType[],
    goals: [
      { name: "传播", weight: 0.7 },
      { name: "功能拉新", weight: 0.3 },
    ],
    scene: "feed 流里产出 AI 一键生成的故事短片",
    userProblem: "普通用户没有素材和剪辑能力，但想做剧情类视频",
  },
];

export function BrainstormPanel({ onSubmit, isLoading }: Props) {
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [playbookTypes, setPlaybookTypes] = useState<PlaybookType[]>(["A"]);
  const [goals, setGoals] = useState<BrainstormGoal[]>([]);
  const [scene, setScene] = useState("");
  const [userProblem, setUserProblem] = useState("");
  const [briefSummary, setBriefSummary] = useState("");
  const [briefFileName, setBriefFileName] = useState("");
  const [methodA, setMethodA] = useState<DivergenceMethodId>("scamper");
  const [methodB, setMethodB] = useState<DivergenceMethodId>("first_principles");
  const [compareMode, setCompareMode] = useState(false);

  const useTemplate = (idx: number) => {
    const t = TEMPLATES[idx];
    if (!t) return;
    setCapabilities(t.capabilities);
    setPlaybookTypes(t.playbookTypes);
    setGoals(t.goals);
    setScene(t.scene);
    setUserProblem(t.userProblem);
  };

  const toggleCapability = (id: string) => {
    setCapabilities((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const togglePlaybook = (t: PlaybookType) => {
    setPlaybookTypes((prev) =>
      prev.includes(t)
        ? prev.length > 1
          ? prev.filter((x) => x !== t)
          : prev
        : [...prev, t],
    );
  };

  const toggleGoal = (name: string) => {
    setGoals((prev) =>
      prev.some((g) => g.name === name)
        ? prev.filter((g) => g.name !== name)
        : [...prev, { name, weight: 0.5 }],
    );
  };

  const updateGoalWeight = (name: string, weight: number) => {
    setGoals((prev) =>
      prev.map((g) => (g.name === name ? { ...g, weight } : g)),
    );
  };

  const submit = () => {
    if (scene.trim().length < 1) return;
    onSubmit({
      capabilities,
      playbookTypes,
      goals,
      scene: scene.trim(),
      userProblem: userProblem.trim(),
      briefSummary: briefSummary || undefined,
      method: compareMode
        ? { mode: "compare", methodA, methodB }
        : { mode: "single", methodId: methodA },
    });
  };

  const canSubmit = !isLoading && scene.trim().length >= 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-white/40 self-center">快速开始：</span>
        {TEMPLATES.map((t, i) => (
          <button
            key={t.label}
            onClick={() => useTemplate(i)}
            className="pill hover:bg-white/10 transition-colors"
          >
            {t.label}
          </button>
        ))}
      </div>

      <BriefUploader
        disabled={isLoading}
        onExtracted={(brief, fileName) => {
          setBriefFileName(fileName);
          setBriefSummary(brief.briefSummary);
          if (brief.scene) setScene(brief.scene);
          if (brief.userProblem) setUserProblem(brief.userProblem);
          if (brief.playbookTypes.length > 0) setPlaybookTypes(brief.playbookTypes);
          if (brief.goals.length > 0) setGoals(brief.goals);
        }}
      />
      {briefFileName && briefSummary && (
        <p className="text-[11px] text-white/45">
          已注入 brief 原文片段 {briefSummary.length} 字 — Generator 引用时会扎根这些原话
        </p>
      )}

      <CapabilitySelector
        selected={capabilities}
        onToggle={toggleCapability}
      />

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          玩法类型 <span className="text-[#fb7185]">*</span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {PLAYBOOK_DEFS.map((p) => {
            const active = playbookTypes.includes(p.type);
            return (
              <button
                key={p.type}
                onClick={() => togglePlaybook(p.type)}
                className={`px-3 py-2.5 rounded-xl border text-left transition-all ${
                  active
                    ? "bg-[#8b5cf6]/15 border-[#8b5cf6] text-white"
                    : "bg-white/[0.02] border-white/10 text-white/60 hover:border-white/25"
                }`}
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-[10px] text-white/45">{p.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <GoalEditor
        goals={goals}
        onToggle={toggleGoal}
        onUpdateWeight={updateGoalWeight}
      />

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          场景 <span className="text-[#fb7185]">*</span>
        </label>
        <input
          value={scene}
          onChange={(e) => setScene(e.target.value)}
          placeholder="例：DM 私信里给好友送春节红包祝福"
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          用户痛点（v0.3 新增）
        </label>
        <textarea
          value={userProblem}
          onChange={(e) => setUserProblem(e.target.value)}
          rows={3}
          placeholder="当前用户在该场景的最痛点是什么？（如不填则不放在 prompt）"
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30 resize-none"
        />
      </div>

      <DivergenceMethodSelector
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        methodA={methodA}
        methodB={methodB}
        onMethodAChange={setMethodA}
        onMethodBChange={setMethodB}
      />

      <motion.button
        onClick={submit}
        disabled={!canSubmit}
        whileHover={{ scale: canSubmit ? 1.01 : 1 }}
        whileTap={{ scale: 0.99 }}
        className="btn-primary w-full text-base py-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            脑暴中…
          </>
        ) : (
          <>
            <Wand2 className="w-4 h-4" />
            {compareMode ? "对比发散（并发跑两种方法）" : "开始脑爆"}
          </>
        )}
      </motion.button>

      <p className="text-xs text-white/40 leading-relaxed">
        Generator 会先调实时大盘检索同场景爆款（这是我们 vs 原版 skill 的核心差异），
        再用 Claude Opus 4.7 按选定的发散方法产出 6-12 条结构化 idea，
        每条强制带 14 字段 + 真实爆款引用。
      </p>
    </div>
  );
}

function CapabilitySelector({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-white/80">
          可用能力（多选）
        </label>
        <span className="text-xs text-white/40">{selected.length} 已选</span>
      </div>
      <div className="space-y-3">
        {(Object.entries(CAPABILITIES_BY_CATEGORY) as [string, Capability[]][]).map(
          ([cat, caps]) => (
            <div key={cat}>
              <div className="text-[11px] text-white/40 mb-1.5">{cat}</div>
              <div className="flex flex-wrap gap-1.5">
                {caps.map((c) => {
                  const active = selected.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => onToggle(c.id)}
                      title={c.description}
                      className={`px-2.5 py-1 rounded-md text-[12px] transition-all ${
                        active
                          ? "bg-[#d946ef]/20 border border-[#d946ef]/40 text-white"
                          : "bg-white/[0.03] border border-white/10 text-white/55 hover:border-white/25"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function GoalEditor({
  goals,
  onToggle,
  onUpdateWeight,
}: {
  goals: BrainstormGoal[];
  onToggle: (name: string) => void;
  onUpdateWeight: (name: string, weight: number) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-white/80 mb-2">
        目标（可设权重）
      </label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {SUGGESTED_GOALS.map((name) => {
          const active = goals.some((g) => g.name === name);
          return (
            <button
              key={name}
              onClick={() => onToggle(name)}
              className={`px-2.5 py-1 rounded-md text-[12px] transition-all ${
                active
                  ? "bg-[#8b5cf6]/20 border border-[#8b5cf6]/40 text-white"
                  : "bg-white/[0.03] border border-white/10 text-white/55 hover:border-white/25"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
      {goals.length > 0 && (
        <div className="space-y-2 mt-2">
          {goals.map((g) => (
            <div key={g.name} className="flex items-center gap-3">
              <span className="text-xs text-white/70 w-20">{g.name}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={g.weight ?? 0.5}
                onChange={(e) =>
                  onUpdateWeight(g.name, parseFloat(e.target.value))
                }
                className="flex-1 accent-[#d946ef]"
              />
              <span className="text-xs text-white/55 w-10 text-right">
                {((g.weight ?? 0.5) * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DivergenceMethodSelector({
  compareMode,
  onCompareModeChange,
  methodA,
  methodB,
  onMethodAChange,
  onMethodBChange,
}: {
  compareMode: boolean;
  onCompareModeChange: (v: boolean) => void;
  methodA: DivergenceMethodId;
  methodB: DivergenceMethodId;
  onMethodAChange: (id: DivergenceMethodId) => void;
  onMethodBChange: (id: DivergenceMethodId) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-white/80">发散方法</label>
        <button
          onClick={() => onCompareModeChange(!compareMode)}
          className={`text-xs px-2 py-1 rounded transition-all ${
            compareMode
              ? "bg-[#d946ef]/20 text-[#fbcfe8] border border-[#d946ef]/40"
              : "bg-white/[0.03] text-white/55 border border-white/10 hover:border-white/25"
          }`}
        >
          {compareMode ? "✓ 对比模式" : "对比模式（双方法并发）"}
        </button>
      </div>
      <div className={compareMode ? "grid grid-cols-2 gap-2" : ""}>
        <MethodDropdown
          label={compareMode ? "方法 A" : undefined}
          value={methodA}
          onChange={onMethodAChange}
        />
        {compareMode && (
          <MethodDropdown
            label="方法 B"
            value={methodB}
            onChange={onMethodBChange}
            excludeId={methodA}
          />
        )}
      </div>
    </div>
  );
}

function MethodDropdown({
  label,
  value,
  onChange,
  excludeId,
}: {
  label?: string;
  value: DivergenceMethodId;
  onChange: (id: DivergenceMethodId) => void;
  excludeId?: DivergenceMethodId;
}) {
  return (
    <div>
      {label && <div className="text-[11px] text-white/40 mb-1">{label}</div>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as DivergenceMethodId)}
        className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm focus:border-[#8b5cf6] focus:outline-none"
      >
        {DIVERGENCE_METHODS.filter((m) => m.id !== excludeId).map((m) => (
          <option key={m.id} value={m.id} className="bg-[#0d0d12]">
            {m.name} — {m.shortLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
