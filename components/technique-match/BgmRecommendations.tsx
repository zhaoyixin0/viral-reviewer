"use client";

import { Music, ExternalLink, Search, Sparkles } from "lucide-react";
import type { RecommendedBgm } from "@/lib/technique-matching/types";

type Props = {
  bgms: RecommendedBgm[];
  /** 当前用户已选 BGM 的搜索关键词（用于高亮） */
  onPickKeyword?: (keyword: string) => void;
};

const KIND_LABEL: Record<string, { label: string; color: string }> = {
  trending_sound: { label: "TikTok 热门", color: "#22d3ee" },
  specific_track: { label: "具体歌曲", color: "#8b5cf6" },
  vibe_category: { label: "Vibe 风格", color: "#f59e0b" },
};

export function BgmRecommendations({ bgms, onPickKeyword }: Props) {
  if (bgms.length === 0) return null;

  const sorted = [...bgms].sort((a, b) =>
    a.priority === "P0" && b.priority === "P1" ? -1 : 1,
  );

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-1">
        <Music className="w-4 h-4 text-[#d946ef]" />
        <h3 className="text-base font-semibold">AI 推荐配乐</h3>
        <span className="text-xs text-white/45">
          {sorted.length} 首 · 综合你的素材 vibe + 爆款规律
        </span>
      </div>
      <p className="text-xs text-white/55 mb-4 leading-relaxed">
        点 TikTok 搜索链接找到原曲，下载下来在下方"导出 CapCut"区域上传，AI
        会把你的素材 + 这首 BGM 一起编译成可直接打开的 CapCut 项目。
      </p>

      <div className="space-y-3">
        {sorted.map((bgm, i) => {
          const kindMeta = KIND_LABEL[bgm.kind] ?? {
            label: bgm.kind,
            color: "#94a3b8",
          };
          return (
            <div
              key={i}
              className="rounded-xl p-4 bg-white/[0.03] border border-white/[0.06]"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded"
                      style={{
                        background: `${kindMeta.color}22`,
                        color: kindMeta.color,
                        border: `1px solid ${kindMeta.color}44`,
                      }}
                    >
                      {kindMeta.label}
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background:
                          bgm.priority === "P0"
                            ? "rgba(244,63,94,0.15)"
                            : "rgba(245,158,11,0.15)",
                        color: bgm.priority === "P0" ? "#fb7185" : "#f59e0b",
                      }}
                    >
                      {bgm.priority}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white">
                    {bgm.name}
                    {bgm.artist && (
                      <span className="ml-2 text-white/50 text-xs">
                        · {bgm.artist}
                      </span>
                    )}
                  </p>
                </div>
                {bgm.searchUrl && (
                  <a
                    href={bgm.searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] text-xs text-white/70 hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    搜索
                  </a>
                )}
              </div>

              <p className="text-xs text-white/65 mb-2 leading-relaxed">
                <span className="text-white/40">理由：</span>
                {bgm.reasoning}
              </p>

              {bgm.searchKeywords.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  <Search className="w-3 h-3 text-white/40" />
                  {bgm.searchKeywords.map((kw) => (
                    <button
                      key={kw}
                      onClick={() => onPickKeyword?.(kw)}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.08] transition-colors"
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              )}

              {bgm.fromReferenceId && (
                <p className="mt-2 text-[10px] text-white/35">
                  ← 来自爆款 {bgm.fromReferenceId}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg p-3 bg-[#d946ef]/10 border border-[#d946ef]/30 flex items-start gap-2">
        <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#d946ef]" />
        <p className="text-[11px] text-white/70 leading-relaxed">
          <strong className="text-white/90">怎么用：</strong>
          点搜索 → 在 TikTok 听到 trending sound →
          手机/桌面录屏或第三方下载 mp3 → 回到下方"导出 CapCut" → 上传 BGM →
          AI 把音乐和素材一起打进 CapCut 项目里
        </p>
      </div>
    </div>
  );
}
