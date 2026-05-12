"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { upload } from "@vercel/blob/client";
import { Sparkles, Upload, Loader2, Film } from "lucide-react";

type Stage = "idle" | "uploading" | "submitting";

type Props = {
  onSubmit: (args: { videoUrl: string; topic: string; intent: string }) => void;
  isLoading: boolean;
};

const STAGE_TEXT: Record<Stage, string> = {
  idle: "开始 AI 剪辑分析",
  uploading: "上传视频…",
  submitting: "AI 分析中…",
};

const MAX_BYTES = 30 * 1024 * 1024;

export function InputPanel({ onSubmit, isLoading }: Props) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [topic, setTopic] = useState("");
  const [intent, setIntent] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [stageError, setStageError] = useState<string | null>(null);

  const handleFile = (f: File | null) => {
    setStageError(null);
    if (!f) {
      setVideoFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setStageError(
        `文件超过 30MB（${(f.size / 1024 / 1024).toFixed(1)}MB），请压缩后再传`,
      );
      return;
    }
    setVideoFile(f);
  };

  const handleSubmit = async () => {
    if (!videoFile) return;
    setStageError(null);
    try {
      setStage("uploading");
      const blob = await upload(videoFile.name, videoFile, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: videoFile.type || "video/mp4",
      });

      setStage("submitting");
      onSubmit({
        videoUrl: blob.url,
        topic: topic.trim(),
        intent: intent.trim(),
      });
    } catch (e) {
      setStageError((e as Error).message);
    } finally {
      setStage("idle");
    }
  };

  const busy = isLoading || stage !== "idle";
  const buttonText =
    stage !== "idle"
      ? STAGE_TEXT[stage]
      : isLoading
        ? "AI 分析中…"
        : STAGE_TEXT.idle;

  return (
    <div className="space-y-5">
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
              MP4 / MOV / WebM · 最大 30MB · Gemini 2.5 Pro 视频理解
            </div>
          </div>
        </label>
        {stageError && (
          <p className="mt-2 text-xs text-[#f43f5e]">{stageError}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          题材（可选）
        </label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="例：旅行 vlog / 美食探店 / 健身日常"
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          你想做什么样的视频？（可选）
        </label>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          rows={3}
          placeholder="例：想做一段巴厘岛旅行 vlog，希望视觉冲击强一些。"
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30 resize-none"
        />
        <p className="text-[11px] text-white/40 mt-1.5">
          AI 会根据你的意图调整 P0/P1/P2 优先级和反向建议
        </p>
      </div>

      <motion.button
        onClick={handleSubmit}
        disabled={busy || !videoFile}
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

      <div className="glass-card p-4 space-y-2 bg-white/[0.02]">
        <div className="flex items-center gap-2 text-xs text-white/60">
          <Film className="w-3.5 h-3.5" />
          <span className="font-medium">AI 会怎么分析你的素材：</span>
        </div>
        <ul className="text-[11px] text-white/55 space-y-1 list-disc pl-4">
          <li>Gemini 2.5 Pro 原生视频理解（不是抽帧）</li>
          <li>识别每个镜头、转场、镜头运动、BGM 节拍</li>
          <li>找出 5-15 个适合切换的时间点</li>
          <li>分析画面与 BGM 歌词的隐喻关联</li>
          <li>Opus 4.7 对照爆款，给出适配 / 不适配判断</li>
          <li>输出按时间轴排序的可执行剪辑清单</li>
        </ul>
        <p className="text-[10px] text-white/40 mt-2">
          预计 2-4 分钟。请保持页面打开。
        </p>
      </div>
    </div>
  );
}
