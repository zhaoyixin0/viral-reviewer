"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { upload } from "@vercel/blob/client";
import { Sparkles, Upload, Loader2, Film, X } from "lucide-react";

type Stage = "idle" | "uploading" | "submitting";

type Props = {
  onSubmit: (args: {
    videoUrls: string[];
    videoFileNames: string[];
    topic: string;
    intent: string;
  }) => void;
  isLoading: boolean;
};

const STAGE_TEXT: Record<Stage, string> = {
  idle: "开始 AI 剪辑分析",
  uploading: "上传视频…",
  submitting: "AI 分析中…",
};

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_FILES = 6;

function fileKey(f: File): string {
  return `${f.name}|${f.size}`;
}

export function InputPanel({ onSubmit, isLoading }: Props) {
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [topic, setTopic] = useState("");
  const [intent, setIntent] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [stageError, setStageError] = useState<string | null>(null);

  const addFiles = (incoming: File[]) => {
    const messages: string[] = [];
    const valid: File[] = [];

    for (const f of incoming) {
      if (f.size > MAX_BYTES) {
        messages.push(
          `${f.name}（${(f.size / 1024 / 1024).toFixed(1)}MB）超过 30MB，已跳过`,
        );
        continue;
      }
      valid.push(f);
    }

    setVideoFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const merged = [...prev];
      let dupeCount = 0;
      for (const f of valid) {
        const k = fileKey(f);
        if (seen.has(k)) {
          dupeCount += 1;
          continue;
        }
        seen.add(k);
        merged.push(f);
      }
      if (dupeCount > 0) {
        messages.push(`已忽略 ${dupeCount} 个重复文件（同名+同大小）`);
      }
      if (merged.length > MAX_FILES) {
        const truncated = merged.length - MAX_FILES;
        messages.push(`最多 ${MAX_FILES} 个素材，超出的 ${truncated} 个已忽略`);
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });

    setStageError(messages.length > 0 ? messages.join("；") : null);
  };

  const handleRemove = (idx: number) => {
    setVideoFiles((prev) => prev.filter((_, i) => i !== idx));
    setStageError(null);
  };

  const handleSubmit = async () => {
    if (videoFiles.length === 0) return;
    setStageError(null);
    try {
      setStage("uploading");
      const results = await Promise.allSettled(
        videoFiles.map((f) =>
          upload(f.name, f, {
            access: "public",
            handleUploadUrl: "/api/upload",
            contentType: f.type || "video/mp4",
          }),
        ),
      );

      const urls: string[] = [];
      const failed: { name: string; reason: string }[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          urls.push(r.value.url);
        } else {
          const reason =
            r.reason instanceof Error ? r.reason.message : "未知错误";
          failed.push({ name: videoFiles[i].name, reason });
        }
      });

      if (failed.length > 0) {
        setStageError(
          `上传失败（全部素材必须成功才进入分析）：${failed
            .map((f) => `${f.name}（${f.reason}）`)
            .join("；")}`,
        );
        return;
      }

      setStage("submitting");
      onSubmit({
        videoUrls: urls,
        videoFileNames: videoFiles.map((f) => f.name),
        topic: topic.trim(),
        intent: intent.trim(),
      });
    } catch (e) {
      setStageError(e instanceof Error ? e.message : "上传出错");
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

  const canAddMore = videoFiles.length < MAX_FILES;

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">
          视频草稿 <span className="text-[#fb7185]">*</span>
          <span className="ml-2 text-xs font-normal text-white/40">
            {videoFiles.length}/{MAX_FILES}
          </span>
        </label>
        <label
          className={`relative block ${canAddMore ? "" : "opacity-50 pointer-events-none"}`}
        >
          <input
            type="file"
            multiple
            accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) addFiles(files);
              e.target.value = "";
            }}
            disabled={!canAddMore}
            className="sr-only peer"
          />
          <div className="px-6 py-10 rounded-xl bg-white/[0.04] border border-dashed border-white/15 hover:border-[#8b5cf6] hover:bg-white/[0.06] transition-all cursor-pointer text-center">
            <Upload className="w-6 h-6 mx-auto mb-2 text-white/40" />
            <div className="text-sm text-white/70">
              {canAddMore
                ? "点击选择视频文件（可多选）"
                : `已选满 ${MAX_FILES} 个，删除后可继续添加`}
            </div>
            <div className="text-xs text-white/40 mt-1">
              MP4 / MOV / WebM · 单个 ≤ 30MB · 最多 {MAX_FILES} 个 · Gemini 2.5
              Pro 视频理解
            </div>
          </div>
        </label>
        {stageError && (
          <p className="mt-2 text-xs text-[#f43f5e]">{stageError}</p>
        )}

        {videoFiles.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {videoFiles.map((f, idx) => (
              <li
                key={`${f.name}|${f.size}|${idx}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs"
              >
                <span className="w-5 shrink-0 text-white/40 tabular-nums">
                  {idx + 1}.
                </span>
                <span className="flex-1 truncate text-white/85">{f.name}</span>
                <span className="shrink-0 text-white/45 tabular-nums">
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  disabled={busy}
                  className="p-1 rounded hover:bg-white/[0.08] text-white/45 hover:text-[#f43f5e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label={`删除 ${f.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
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
        disabled={busy || videoFiles.length === 0}
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
