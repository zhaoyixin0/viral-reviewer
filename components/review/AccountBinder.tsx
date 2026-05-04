"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Link2,
  Loader2,
  RefreshCw,
  Unlink,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type {
  AccountProfile,
  Platform,
} from "@/lib/account-profile/types";

type Props = {
  profile: AccountProfile | null;
  onProfileChange: (profile: AccountProfile | null) => void;
};

type Stage = {
  stage: string;
  message: string;
};

type RunState =
  | { kind: "idle" }
  | { kind: "running"; stages: Stage[] }
  | { kind: "error"; message: string };

const ERROR_MAP: Record<string, string> = {
  user_not_found: "找不到这个账号，检查拼写或试试别的",
  private_account: "这个账号是私密的，无法分析",
  rate_limited: "Apify 限流了，等几分钟再试",
  no_videos: "这个账号还没有作品，无法生成画像",
  apify_error: "Apify 抓取出错",
  internal: "内部错误",
};

export function AccountBinder({ profile, onProfileChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [username, setUsername] = useState("");
  const [run, setRun] = useState<RunState>({ kind: "idle" });

  const isRunning = run.kind === "running";

  const startBind = async (forceRefresh = false) => {
    const handle = username.trim().replace(/^@+/, "");
    if (!handle) return;
    setRun({ kind: "running", stages: [] });

    try {
      const res = await fetch("/api/account-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, username: handle, forceRefresh }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        setRun({
          kind: "error",
          message: ERROR_MAP[err.error] || err.message || `请求失败 (${res.status})`,
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const r = await reader.read();
        done = r.done;
        if (r.value) buffer += decoder.decode(r.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "stage") {
              setRun((prev) =>
                prev.kind === "running"
                  ? {
                      ...prev,
                      stages: [
                        ...prev.stages,
                        { stage: event.stage, message: event.message },
                      ],
                    }
                  : prev,
              );
            } else if (event.type === "result") {
              const next: AccountProfile = event.data.profile;
              onProfileChange(next);
              setRun({ kind: "idle" });
              setExpanded(false);
            } else if (event.type === "error") {
              setRun({
                kind: "error",
                message: ERROR_MAP[event.code] || event.message,
              });
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch (e) {
      setRun({ kind: "error", message: (e as Error).message });
    }
  };

  const unbind = () => {
    onProfileChange(null);
    setUsername("");
    setRun({ kind: "idle" });
    setExpanded(false);
  };

  const refresh = () => {
    if (!profile) return;
    setUsername(profile.username);
    setPlatform(profile.platform);
    setExpanded(true);
    void startBind(true);
  };

  if (profile) {
    return (
      <div className="glass-card p-5 border border-[#22c55e]/25">
        <BoundDisplay
          profile={profile}
          onUnbind={unbind}
          onRefresh={refresh}
          running={isRunning}
          stages={run.kind === "running" ? run.stages : []}
        />
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#8b5cf6]/30 to-[#d946ef]/30 flex items-center justify-center">
            <Link2 className="w-4 h-4 text-[#fbcfe8]" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-white">
              绑定你的账号（可选）
            </div>
            <div className="text-xs text-white/50">
              让 AI 用你已有的粉丝偏好和爆款规律优化建议
            </div>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-white/50" />
        ) : (
          <ChevronDown className="w-4 h-4 text-white/50" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-5 space-y-4">
              <PlatformTabs value={platform} onChange={setPlatform} />
              <UsernameInput
                value={username}
                onChange={setUsername}
                onSubmit={() => startBind(false)}
                disabled={isRunning}
                platform={platform}
              />
              {isRunning && <ProgressList stages={run.stages} />}
              {run.kind === "error" && (
                <div className="flex items-start gap-2 text-sm text-[#fda4af]">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{run.message}</span>
                </div>
              )}
              <p className="text-[11px] text-white/40 leading-relaxed">
                Apify 抓 top 3 作品 + 各 top 10 评论 → Haiku 综合分析镜头
                / 节奏 / 粉丝偏好 → 缓存 7 天。第一次约 60-120 秒。
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlatformTabs({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (p: Platform) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["tiktok", "instagram"] as const).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${
            value === p
              ? "bg-[#8b5cf6]/15 border-[#8b5cf6] text-white"
              : "bg-white/[0.02] border-white/10 text-white/60 hover:border-white/25"
          }`}
        >
          {p === "tiktok" ? "TikTok" : "Instagram"}
        </button>
      ))}
    </div>
  );
}

function UsernameInput({
  value,
  onChange,
  onSubmit,
  disabled,
  platform,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  platform: Platform;
}) {
  const placeholder =
    platform === "tiktok" ? "@your_handle" : "@your_handle";
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !disabled) onSubmit();
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 focus:border-[#8b5cf6] focus:outline-none text-white placeholder:text-white/30 disabled:opacity-50"
      />
      <button
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        className="btn-primary px-5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {disabled ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            分析
          </>
        )}
      </button>
    </div>
  );
}

function ProgressList({ stages }: { stages: Stage[] }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/10 p-4 space-y-1.5">
      {stages.map((s, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          {i === stages.length - 1 ? (
            <Loader2 className="w-3.5 h-3.5 text-[#d946ef] animate-spin flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-[#22c55e] flex-shrink-0 mt-0.5" />
          )}
          <span className="text-white/70">{s.message}</span>
        </div>
      ))}
    </div>
  );
}

function BoundDisplay({
  profile,
  onUnbind,
  onRefresh,
  running,
  stages,
}: {
  profile: AccountProfile;
  onUnbind: () => void;
  onRefresh: () => void;
  running: boolean;
  stages: Stage[];
}) {
  const top1 = profile.topVideos[0];
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        {top1?.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={top1.cover}
            alt={profile.username}
            className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-white/10"
          />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-white">
              @{profile.username}
            </span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">
              {profile.platform === "tiktok" ? "TikTok" : "Instagram"}
            </span>
            <span className="text-[11px] text-white/45">
              · 置信度 {(profile.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-xs text-white/70 leading-relaxed line-clamp-2">
            {profile.positioning}
          </p>
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button
            onClick={onRefresh}
            disabled={running}
            title="重新分析"
            className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`}
            />
          </button>
          <button
            onClick={onUnbind}
            title="解绑"
            className="p-1.5 rounded text-white/50 hover:text-[#fda4af] hover:bg-[#f43f5e]/10"
          >
            <Unlink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {profile.audiencePreferences.keywords.length > 0 && (
        <div className="flex items-start gap-2 text-xs">
          <span className="text-white/40 flex-shrink-0">粉丝喜欢</span>
          <div className="flex flex-wrap gap-1.5">
            {profile.audiencePreferences.keywords.map((k) => (
              <span
                key={k}
                className="px-2 py-0.5 rounded bg-[#d946ef]/15 text-[#fbcfe8] text-[11px]"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {profile.viralPattern.hookStyle && (
        <div className="flex items-start gap-2 text-xs">
          <span className="text-white/40 flex-shrink-0">爆款规律</span>
          <span className="text-white/65">{profile.viralPattern.hookStyle}</span>
        </div>
      )}

      {running && <ProgressList stages={stages} />}
    </div>
  );
}
