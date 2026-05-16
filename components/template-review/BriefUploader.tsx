"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload, FileText, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { upload } from "@/lib/storage/upload-client";
import type { ExtractedBrief } from "@/lib/template-review/brief-extract";

type Props = {
  onExtracted: (extracted: ExtractedBrief, fileName: string) => void;
  disabled?: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string; percentage: number }
  | { kind: "extracting"; fileName: string }
  | { kind: "ok"; fileName: string; brief: ExtractedBrief }
  | { kind: "error"; message: string };

const MAX_BYTES = 100 * 1024 * 1024;

export function BriefUploader({ onExtracted, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);

  const reset = () => setStatus({ kind: "idle" });

  const handleFile = async (file: File) => {
    if (file.type !== "application/pdf") {
      setStatus({ kind: "error", message: "只支持 PDF 文件" });
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus({
        kind: "error",
        message: `文件超过 ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩或拆分`,
      });
      return;
    }

    setStatus({ kind: "uploading", fileName: file.name, percentage: 0 });

    let blobUrl: string;
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/template-brief-upload",
        contentType: file.type,
        onUploadProgress: ({ percentage }) => {
          setStatus((s) =>
            s.kind === "uploading"
              ? { ...s, percentage: Math.round(percentage) }
              : s,
          );
        },
      });
      blobUrl = blob.url;
    } catch (e) {
      setStatus({
        kind: "error",
        message: `上传失败：${(e as Error).message}`,
      });
      return;
    }

    setStatus({ kind: "extracting", fileName: file.name });

    try {
      const res = await fetch("/api/template-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl, fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const msg = mapErrorMessage(data.error, data.message);
        setStatus({ kind: "error", message: msg });
        return;
      }
      setStatus({ kind: "ok", fileName: file.name, brief: data.extracted });
      onExtracted(data.extracted, file.name);
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const onClick = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  };

  const isLoading =
    status.kind === "uploading" || status.kind === "extracting";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white/80">
          上传 brief 文档（可选）
        </span>
        <span className="text-xs text-white/40">PDF · ≤ 100MB · 30 页内</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={onChange}
        className="hidden"
      />

      {status.kind !== "ok" ? (
        <div
          onClick={onClick}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`
            border-2 border-dashed rounded-xl p-6 text-center cursor-pointer
            transition-all
            ${dragOver ? "border-[#d946ef] bg-[#d946ef]/5" : "border-white/15 hover:border-white/30 bg-white/[0.02]"}
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          `}
        >
          {isLoading ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-white/70">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">
                  {status.kind === "uploading"
                    ? `上传中：${status.fileName} (${status.percentage}%)`
                    : `Haiku 正在解析「${status.fileName}」…`}
                </span>
              </div>
              {status.kind === "uploading" && (
                <div className="w-full max-w-xs mx-auto h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] transition-all"
                    style={{ width: `${status.percentage}%` }}
                  />
                </div>
              )}
            </div>
          ) : status.kind === "error" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-[#f43f5e]">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">{status.message}</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                }}
                className="text-xs text-white/50 underline hover:text-white/80"
              >
                重新选择
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload className="w-6 h-6 mx-auto text-white/40" />
              <p className="text-sm text-white/70">
                拖拽 PDF 到这里，或<span className="text-[#d946ef]"> 点击选择 </span>
              </p>
              <p className="text-xs text-white/40">
                支持脑暴 brief / 立项文档（飞书导出 PDF 也行）
              </p>
            </div>
          )}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/5 p-4"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#22c55e] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 text-sm text-white/85 truncate">
                  <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{status.fileName}</span>
                </div>
                <button
                  onClick={reset}
                  className="text-xs text-white/50 underline hover:text-white/80 flex-shrink-0"
                >
                  重传
                </button>
              </div>
              <ExtractedSummary brief={status.brief} />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function ExtractedSummary({ brief }: { brief: ExtractedBrief }) {
  return (
    <div className="space-y-1.5 text-xs text-white/60">
      <div className="flex items-center gap-2">
        <span className="text-white/40">置信度</span>
        <ConfidenceBar value={brief.confidence} />
        <span className="text-white/50">{(brief.confidence * 100).toFixed(0)}%</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {brief.capabilities.length > 0 ? (
          brief.capabilities.slice(0, 5).map((c) => (
            <span
              key={c}
              className="px-2 py-0.5 rounded bg-[#8b5cf6]/15 text-[#c4b5fd] text-[11px]"
            >
              {c}
            </span>
          ))
        ) : (
          <span className="text-white/40 text-[11px]">未抽到能力字段</span>
        )}
      </div>
      {brief.scene && (
        <div className="text-white/55">
          <span className="text-white/40">场景：</span>
          {brief.scene}
        </div>
      )}
      {brief.userProblem && (
        <div className="text-white/55">
          <span className="text-white/40">痛点：</span>
          {brief.userProblem}
        </div>
      )}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const color =
    pct >= 0.7
      ? "bg-[#22c55e]"
      : pct >= 0.4
        ? "bg-[#fbbf24]"
        : "bg-[#f43f5e]";
  return (
    <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

function mapErrorMessage(error: string, message: string): string {
  switch (error) {
    case "too_many_pages":
      return "PDF 超过 30 页限制，请拆分后上传";
    case "empty_text":
      return "PDF 文本为空 — 可能是扫描版/图片版，请上传文字版";
    case "parse_failed":
      return `PDF 解析失败：${message}`;
    case "too_large":
      return "文件太大，请压缩到 4MB 以内";
    case "invalid_mime":
      return "只支持 PDF 文件";
    case "llm_failed":
      return `LLM 抽取失败：${message}`;
    default:
      return message || "上传失败";
  }
}
