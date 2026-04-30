"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, FileText } from "lucide-react";
import type { TemplateAuditInput } from "@/lib/template-review/types";

type Props = {
  onSubmit: (input: TemplateAuditInput) => void;
  isLoading: boolean;
};

const TEMPLATES = [
  {
    label: "AI 卡通脸特效",
    effectName: "AI 卡通脸变装",
    playStyle: "卡点变装",
    visualStyle: "高饱和霓虹",
    techStack: "脸部 LoRA + 风格 LoRA + 卡点剪辑",
    document: `想做一个 AI 把用户脸自动转成日漫卡通风格的特效，配合卡点变装玩法。用户拍 5 秒原视频后，特效在 BGM 鼓点处把脸切换成卡通版，结尾还原。目标是用户拍出「漫展级别」的氛围。`,
  },
  {
    label: "高蛋白早餐特效",
    effectName: "高蛋白食材自动识别",
    playStyle: "Tutorial 步骤",
    visualStyle: "Top-down 俯拍美食",
    techStack: "食材识别 Vision + 字幕高亮",
    document:
      "用户做早餐时，特效自动识别食材并叠加蛋白质含量字幕，最后给出今天的总蛋白摄入数字。希望提升健身用户黏性。",
  },
];

export function AuditPanel({ onSubmit, isLoading }: Props) {
  const [effectName, setEffectName] = useState("");
  const [playStyle, setPlayStyle] = useState("");
  const [visualStyle, setVisualStyle] = useState("");
  const [techStack, setTechStack] = useState("");
  const [doc, setDoc] = useState("");

  const useTemplate = (idx: number) => {
    const t = TEMPLATES[idx];
    if (!t) return;
    setEffectName(t.effectName);
    setPlayStyle(t.playStyle);
    setVisualStyle(t.visualStyle);
    setTechStack(t.techStack);
    setDoc(t.document);
  };

  const submit = () => {
    if (!effectName.trim() || doc.trim().length < 10) return;
    onSubmit({
      effectName: effectName.trim(),
      playStyle: playStyle.trim() || undefined,
      visualStyle: visualStyle.trim() || undefined,
      techStack: techStack.trim() || undefined,
      document: doc.trim(),
    });
  };

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

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          特效名称 <span className="text-[#fb7185]">*</span>
        </label>
        <input
          value={effectName}
          onChange={(e) => setEffectName(e.target.value)}
          placeholder="例：AI 卡通脸变装、高蛋白早餐识别"
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            玩法（可选）
          </label>
          <input
            value={playStyle}
            onChange={(e) => setPlayStyle(e.target.value)}
            placeholder="如：卡点变装"
            className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            视觉（可选）
          </label>
          <input
            value={visualStyle}
            onChange={(e) => setVisualStyle(e.target.value)}
            placeholder="如：Cinematic"
            className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          技术依赖（可选）
        </label>
        <input
          value={techStack}
          onChange={(e) => setTechStack(e.target.value)}
          placeholder="如：人脸 LoRA + 卡点剪辑 + 云渲染"
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          脑暴文档 / 完整描述 <span className="text-[#fb7185]">*</span>
        </label>
        <textarea
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          rows={9}
          placeholder="粘贴脑暴文档原文，或详细描述：用户路径 / 关键体验 / 期望结果 / 风险点..."
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30 resize-none"
        />
        <p className="text-xs text-white/40 mt-1.5">
          {doc.length} 字 · 建议 100-2000 字
        </p>
      </div>

      <motion.button
        onClick={submit}
        disabled={isLoading || !effectName.trim() || doc.trim().length < 10}
        whileHover={{ scale: isLoading ? 1 : 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="btn-primary w-full text-base py-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            评审中…
          </>
        ) : (
          <>
            <FileText className="w-4 h-4" />
            开始内部评审
          </>
        )}
      </motion.button>

      <p className="text-xs text-white/40 leading-relaxed">
        AI 会从文档抽取题材/玩法/视觉，检索同类爆款做对比，再用 Claude Opus 4.7 给出 7 维评分（含市场验证度）+ 改进建议。
      </p>
    </div>
  );
}
