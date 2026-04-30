"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Compass, Loader2 } from "lucide-react";
import { ALL_TOPICS } from "@/data/seed/viral-videos";
import type { ExploreFilter } from "@/lib/template-review/types";

type Props = {
  onSubmit: (filter: ExploreFilter) => void;
  isLoading: boolean;
};

const PLAY_STYLES = [
  "前后对比",
  "卡点变装",
  "Tutorial 步骤",
  "POV 剧情",
  "Day in the life",
  "First time 反应",
  "Prank 整蛊",
  "声音玩梗",
  "情感叙事",
];

export function ExplorePanel({ onSubmit, isLoading }: Props) {
  const [topic, setTopic] = useState("");
  const [playStyle, setPlayStyle] = useState("");
  const [platform, setPlatform] = useState<"" | "tiktok" | "instagram">("");
  const [context, setContext] = useState("");

  const submit = () => {
    onSubmit({
      topic: topic || undefined,
      playStyle: playStyle || undefined,
      platform: platform || undefined,
      context: context.trim() || undefined,
    });
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-white/65 leading-relaxed">
        基于本周富化爆款大盘，AI 给你 5-8 条值得做的特效赛道推荐。
        全部不填 = 大盘整体扫描；筛选条件 = 在该子领域深挖。
      </p>

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          题材（可选）
        </label>
        <select
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white"
        >
          <option value="">全部题材</option>
          {ALL_TOPICS.map((t) => (
            <option key={t} value={t} className="bg-[#101018]">
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          玩法（可选）
        </label>
        <select
          value={playStyle}
          onChange={(e) => setPlayStyle(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white"
        >
          <option value="">全部玩法</option>
          {PLAY_STYLES.map((s) => (
            <option key={s} value={s} className="bg-[#101018]">
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          平台（可选）
        </label>
        <div className="flex gap-2">
          {(
            [
              { v: "" as const, label: "全部" },
              { v: "tiktok" as const, label: "TikTok" },
              { v: "instagram" as const, label: "Instagram" },
            ] as const
          ).map((p) => (
            <button
              key={p.label}
              onClick={() => setPlatform(p.v)}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm transition-all ${
                platform === p.v
                  ? "bg-gradient-to-r from-[#8b5cf6]/40 to-[#d946ef]/40 border border-[#d946ef]/50 text-white"
                  : "bg-white/[0.04] border border-white/10 text-white/65 hover:bg-white/[0.08]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          团队约束（可选）
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={3}
          placeholder="例：我们团队擅长 AI 渲染，云特效预算紧张..."
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30 resize-none"
        />
      </div>

      <motion.button
        onClick={submit}
        disabled={isLoading}
        whileHover={{ scale: isLoading ? 1 : 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="btn-primary w-full text-base py-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            分析中…
          </>
        ) : (
          <>
            <Compass className="w-4 h-4" />
            扫描大盘 + 推荐方向
          </>
        )}
      </motion.button>

      <p className="text-xs text-white/40 leading-relaxed">
        Opus 4.7 会先看你筛出的子集真实数据，再叠加平台动态训练知识，给出
        5-8 条值得做的特效赛道（数据驱动 / LLM 推断分别标注）。
      </p>
    </div>
  );
}
