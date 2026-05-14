"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";
import { Download, Loader2, FileVideo, Info, Music, X } from "lucide-react";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

type Props = {
  videoUrl: string;
  userPotential: MaterialPotential;
  match: TechniqueMatchingResult;
  defaultProjectName?: string;
};

type Stage = "idle" | "uploading_bgm" | "compiling";

const STAGE_TEXT: Record<Stage, string> = {
  idle: "下载 CapCut 项目 zip",
  uploading_bgm: "上传 BGM 到 Blob…",
  compiling: "编译中（30-60s，下载视频 + 打 zip）…",
};

const MAX_BGM_BYTES = 30 * 1024 * 1024;

export function CapCutExport({
  videoUrl,
  userPotential,
  match,
  defaultProjectName,
}: Props) {
  const fallbackName = `viral-reviewer-${userPotential.detectedFormat}-${new Date().toISOString().slice(0, 10)}`;
  const [projectName, setProjectName] = useState(
    defaultProjectName ?? fallbackName,
  );
  const [bgmFile, setBgmFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleBgmFile = (f: File | null) => {
    setError(null);
    if (!f) {
      setBgmFile(null);
      return;
    }
    if (f.size > MAX_BGM_BYTES) {
      setError(
        `BGM 超过 30MB（${(f.size / 1024 / 1024).toFixed(1)}MB），请压缩后再传`,
      );
      return;
    }
    setBgmFile(f);
  };

  const handleExport = async () => {
    setError(null);
    try {
      let bgmUrl: string | null = null;
      if (bgmFile) {
        setStage("uploading_bgm");
        const blob = await upload(bgmFile.name, bgmFile, {
          access: "public",
          handleUploadUrl: "/api/upload",
          contentType: bgmFile.type || "audio/mpeg",
        });
        bgmUrl = blob.url;
      }

      setStage("compiling");
      const res = await fetch("/api/compile-capcut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: projectName.trim() || fallbackName,
          videoUrl,
          bgmUrl,
          userPotential,
          match,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message ?? `编译失败 (${res.status})`);
      }

      // server 把 zip 写 Blob 返回 downloadUrl，前端从 CDN 直接下载（绕开 4.5MB function limit）
      const { url, filename } = (await res.json()) as {
        url: string;
        filename: string;
      };
      const a = document.createElement("a");
      a.href = url;
      // cross-origin URL 下浏览器忽略 a.download，真正触发"下载而非预览"的是
      // Blob downloadUrl 自带的 Content-Disposition: attachment 头。a.download
      // 仅作同源场景的提示；target=_blank 防止下载导航占用当前 tab。
      a.download = filename;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage("idle");
    }
  };

  const busy = stage !== "idle";

  return (
    <div className="glass-card p-6 bg-gradient-to-br from-[#22d3ee]/10 to-[#8b5cf6]/10 border border-[#22d3ee]/30">
      <div className="flex items-center gap-2 mb-3">
        <FileVideo className="w-4 h-4 text-[#22d3ee]" />
        <h3 className="text-base font-semibold">一键导出到 CapCut</h3>
        <span className="text-xs text-white/45">Phase 5.5</span>
      </div>

      <p className="text-xs text-white/65 mb-4 leading-relaxed">
        把上面的剪辑清单直接编译成 CapCut 桌面项目。zip 里包含你的视频、按时间轴排好的切镜点、push-in/pull-out
        动画、字幕轨{`，可选 BGM 配乐`}。解压到 CapCut Projects 目录即可一键打开。
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-white/70 mb-1.5">
            项目名
          </label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder={fallbackName}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 focus:border-[#22d3ee] focus:outline-none text-sm text-white placeholder:text-white/30"
          />
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Music className="w-3.5 h-3.5 text-[#d946ef]" />
            <label className="text-xs font-medium text-white/70">
              BGM 配乐文件（可选）
            </label>
          </div>
          <label className="relative block">
            <input
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/m4a,audio/aac,audio/x-m4a"
              onChange={(e) => handleBgmFile(e.target.files?.[0] ?? null)}
              className="sr-only peer"
            />
            <div className="px-4 py-3 rounded-lg bg-white/[0.04] border border-dashed border-white/15 hover:border-[#d946ef] hover:bg-white/[0.06] transition-all cursor-pointer text-center">
              <div className="text-xs text-white/70">
                {bgmFile
                  ? `${bgmFile.name} (${(bgmFile.size / 1024 / 1024).toFixed(1)} MB)`
                  : "点击选择 mp3 / wav / m4a · 不上传则用视频自带音轨"}
              </div>
            </div>
          </label>
          {bgmFile && (
            <button
              onClick={() => setBgmFile(null)}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-white/45 hover:text-white/75"
            >
              <X className="w-3 h-3" />
              清除已选 BGM
            </button>
          )}
          <p className="text-[10px] text-white/45 mt-1.5 leading-relaxed">
            从上方"AI 推荐配乐"卡片找到合适音乐 → TikTok 下载 / 自己的音乐库选 →
            上传到这里，AI 把它和视频一起打进 CapCut 项目的独立音轨。最大 30MB。
          </p>
        </div>

        <button
          onClick={handleExport}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-gradient-to-r from-[#22d3ee] to-[#8b5cf6] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {STAGE_TEXT[stage]}
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              {STAGE_TEXT.idle}
            </>
          )}
        </button>

        {error && <p className="text-xs text-[#f43f5e] mt-2">{error}</p>}

        <div className="flex items-start gap-2 mt-3 text-[11px] text-white/55 leading-relaxed">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#22d3ee]" />
          <div>
            <strong className="text-white/75">解压位置：</strong>
            <div className="font-mono mt-0.5 text-[10px]">
              Windows:{" "}
              <span className="text-white/45">
                %LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\
              </span>
            </div>
            <div className="font-mono text-[10px]">
              macOS:{" "}
              <span className="text-white/45">
                ~/Movies/CapCut/User Data/Projects/com.lveditor.draft/
              </span>
            </div>
            <div className="mt-1.5 text-white/50">
              zip 里有 README.txt 详细说明。第一次打开如果提示"找不到素材"，点
              materials/input.mp4 (和 bgm.mp3 如果有) 即可。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
