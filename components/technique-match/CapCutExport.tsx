"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";
import { Download, Loader2, FileVideo, Info, Music, X } from "lucide-react";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

type Props = {
  /** 按上传全集索引的视频 URL 数组；N=1 也是单元素数组。POST body 同步发数组，
   *  schema 的 C1 兼容层（preprocess）会回填 videoUrl 单字段。 */
  videoUrls: string[];
  /** 与 videoUrls 同序对齐的用户原始文件名；缺失元素由服务端退化为 input.mp4。 */
  videoFileNames?: ReadonlyArray<string | undefined>;
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
  videoUrls,
  videoFileNames,
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
      // 同时发数组 + 单值 —— schema preprocess 会双向归一，但发齐对 server 端
      // 兼容旧/新 route 实现都安全。videoFileNames 全 undefined 时不发，让
      // server 端走 input.mp4 退化逻辑。
      const cleanFileNames = videoFileNames?.filter(
        (n): n is string => typeof n === "string" && n.length > 0,
      );
      const hasFileNames =
        cleanFileNames !== undefined &&
        cleanFileNames.length === videoUrls.length;
      const res = await fetch("/api/compile-capcut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: projectName.trim() || fallbackName,
          videoUrl: videoUrls[0],
          videoUrls,
          ...(hasFileNames
            ? {
                videoFileName: cleanFileNames[0],
                videoFileNames: cleanFileNames,
              }
            : {}),
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
        把上面的剪辑清单直接编译成 CapCut 桌面项目。zip 里包含
        {videoUrls.length > 1
          ? `你上传的 ${videoUrls.length} 段视频`
          : "你的视频"}
        、按时间轴排好的切镜点、push-in/pull-out 动画、字幕轨
        {`，可选 BGM 配乐`}。解压后运行 setup 脚本即可一键打开。
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
            <strong className="text-white/75">怎么用：</strong>
            <div className="mt-0.5 text-white/50">
              解压 zip 后，Windows 双击{" "}
              <span className="font-mono text-white/45">setup.bat</span>，macOS
              运行{" "}
              <span className="font-mono text-white/45">setup.sh</span>
              ，等它显示"完成"，再打开 CapCut 即可。
            </div>
            <div className="mt-1.5 text-white/50">
              脚本会自动把项目放进 CapCut 目录并修好素材路径——纯本地操作、不联网。详见
              zip 里的 README.txt。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
