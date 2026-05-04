"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { upload } from "@vercel/blob/client";
import { Sparkles, Upload, FileText, Loader2 } from "lucide-react";
import { ALL_TOPICS } from "@/data/seed/viral-videos";
import type { ReviewInput } from "@/lib/review-engine/types";

type Mode = "text" | "video";

type Stage = "idle" | "uploading" | "analyzing" | "submitting";

type Props = {
  onSubmit: (input: ReviewInput) => void;
  isLoading: boolean;
};

const TEMPLATES = [
  {
    label: "早餐健身视频想法",
    topic: "早餐健身",
    audience: "想增肌的 20-30 岁年轻人",
    scene: "厨房 / 晨间",
    draft: "想拍一条 30 秒的高蛋白早餐 vlog，展示制作过程和成品。",
  },
  {
    label: "宠物日常 prank",
    topic: "宠物日常",
    audience: "养宠物的年轻女性",
    scene: "家里客厅",
    draft: "藏起来看狗狗找不到我会怎么反应。",
  },
];

const STAGE_TEXT: Record<Stage, string> = {
  idle: "开始 AI 评审",
  uploading: "上传视频…",
  analyzing: "AI 抽帧 + 视觉分析…",
  submitting: "评审中…",
};

const MAX_BYTES = 200 * 1024 * 1024;

export function InputPanel({ onSubmit, isLoading }: Props) {
  const [mode, setMode] = useState<Mode>("text");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [scene, setScene] = useState("");
  const [draft, setDraft] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [stageError, setStageError] = useState<string | null>(null);

  const useTemplate = (idx: number) => {
    const t = TEMPLATES[idx];
    if (!t) return;
    setMode("text");
    setTopic(t.topic);
    setAudience(t.audience);
    setScene(t.scene);
    setDraft(t.draft);
  };

  const handleFile = (f: File | null) => {
    setStageError(null);
    if (!f) {
      setVideoFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setStageError(
        `文件超过 ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB（${(f.size / 1024 / 1024).toFixed(1)}MB），请压缩后再传`,
      );
      return;
    }
    setVideoFile(f);
  };

  const submitText = () => {
    if (!topic.trim()) return;
    onSubmit({
      type: "text",
      topic: topic.trim(),
      audience: audience.trim(),
      scene: scene.trim(),
      draft: draft.trim() || undefined,
    });
  };

  const submitVideo = async () => {
    if (!topic.trim() || !videoFile) return;
    setStageError(null);

    try {
      // Step 1: client-direct upload to Vercel Blob (bypasses 4.5MB function body limit)
      setStage("uploading");
      const blob = await upload(videoFile.name, videoFile, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: videoFile.type || "video/mp4",
      });

      // Step 2: analyze
      setStage("analyzing");
      const anRes = await fetch("/api/analyze-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: blob.url,
          topic: topic.trim(),
          audience: audience.trim(),
          scene: scene.trim(),
        }),
      });
      if (!anRes.ok) {
        const err = await anRes.json().catch(() => ({}));
        throw new Error(err.message || `视频分析失败 (${anRes.status})`);
      }
      const reviewInput = (await anRes.json()) as ReviewInput;

      // Step 3: review
      setStage("submitting");
      onSubmit(reviewInput);
    } catch (e) {
      setStageError((e as Error).message);
    } finally {
      setStage("idle");
    }
  };

  const handleSubmit = () => {
    if (mode === "text") submitText();
    else submitVideo();
  };

  const busy = isLoading || stage !== "idle";
  const buttonText = stage !== "idle" ? STAGE_TEXT[stage] : isLoading ? "评审中…" : STAGE_TEXT.idle;

  return (
    <div className="space-y-5">
      {/* Mode toggle */}
      <div className="glass-card p-1.5 inline-flex w-full">
        {(
          [
            { key: "text", label: "描述想法", icon: FileText },
            { key: "video", label: "上传草稿", icon: Upload },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              mode === m.key
                ? "bg-white/10 text-white"
                : "text-white/60 hover:text-white"
            }`}
          >
            <m.icon className="w-4 h-4" />
            {m.label}
          </button>
        ))}
      </div>

      {/* Templates */}
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
          题材 <span className="text-[#fb7185]">*</span>
        </label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          list="topics"
          placeholder="例：早餐健身、变装秀、宠物日常..."
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30"
        />
        <datalist id="topics">
          {ALL_TOPICS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            目标受众
          </label>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="例：20-30 岁健身爱好者"
            className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            场景
          </label>
          <input
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            placeholder="例：厨房 / 晨间"
            className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30"
          />
        </div>
      </div>

      {mode === "text" ? (
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            草稿描述（可选）
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder="详细描述你的想法、镜头计划、想表达什么..."
            className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30 resize-none"
          />
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            视频草稿 <span className="text-[#fb7185]">*</span>
          </label>
          <label className="relative block">
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              className="sr-only peer"
            />
            <div className="px-6 py-10 rounded-xl bg-white/[0.04] border border-dashed border-white/15 hover:border-[#8b5cf6] hover:bg-white/[0.06] transition-all cursor-pointer text-center">
              <Upload className="w-6 h-6 mx-auto mb-2 text-white/40" />
              <div className="text-sm text-white/70">
                {videoFile
                  ? `${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)} MB)`
                  : "点击或拖拽视频文件到这里"}
              </div>
              <div className="text-xs text-white/40 mt-1">
                MP4 / MOV / WebM · 最大 200MB · AI 自动抽帧 + 视觉分析
              </div>
            </div>
          </label>
          {stageError && (
            <p className="mt-2 text-xs text-[#f43f5e]">{stageError}</p>
          )}
        </div>
      )}

      <motion.button
        onClick={handleSubmit}
        disabled={busy || !topic.trim() || (mode === "video" && !videoFile)}
        whileHover={{ scale: busy ? 1 : 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="btn-primary w-full text-base py-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {buttonText}
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            {STAGE_TEXT.idle}
          </>
        )}
      </motion.button>

      <p className="text-xs text-white/40 leading-relaxed">
        {mode === "text"
          ? "提交后系统会从 TikTok / Instagram 真实爆款库中检索同题材 top-5，提炼共性公式，再由 Claude Opus 4.7 给出 6 维评分、按秒时间轴与四段式建议。"
          : "上传后系统会先把视频存到 Vercel Blob，FFmpeg 抽 6 帧 + 音轨，Claude Haiku 看帧 + Whisper 转录，再交给 Opus 4.7 评审。预计 1-3 分钟。"}
      </p>
    </div>
  );
}
