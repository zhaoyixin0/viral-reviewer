"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Scissors, Info } from "lucide-react";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { InputPanel } from "@/components/technique-match/InputPanel";
import { UserDiagnosis } from "@/components/technique-match/UserDiagnosis";
import { PriorityActions } from "@/components/technique-match/PriorityActions";
import { ReferenceReports } from "@/components/technique-match/ReferenceReports";
import { GlobalDoNots } from "@/components/technique-match/GlobalDoNots";
import { ProgressTimeline } from "@/components/review/ProgressTimeline";
import type { StageEvent } from "@/app/review/page";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

type ResponseShape = {
  userVideoId: string;
  userPotential: MaterialPotential;
  referenceSource: "sample" | "database";
  referenceNotice?: string;
  match: TechniqueMatchingResult;
};

export default function TechniqueMatchPage() {
  const [data, setData] = useState<ResponseShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageEvent[]>([]);

  const handleSubmit = async (args: {
    videoUrl: string;
    topic: string;
    intent: string;
  }) => {
    setLoading(true);
    setError(null);
    setStages([]);
    setData(null);

    try {
      const res = await fetch("/api/technique-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `请求失败 (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as
              | {
                  type: "stage";
                  stage: string;
                  message: string;
                  data?: Record<string, unknown>;
                }
              | { type: "result"; data: ResponseShape }
              | { type: "error"; message: string };

            if (event.type === "stage") {
              setStages((prev) => [
                ...prev,
                {
                  stage: event.stage,
                  message: event.message,
                  data: event.data,
                  time: Date.now(),
                },
              ]);
            } else if (event.type === "result") {
              setData(event.data);
            } else if (event.type === "error") {
              setError(event.message);
            }
          } catch {
            /* skip malformed lines */
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-6 lg:px-10 py-12">
        <div className="mb-10 text-center">
          <span className="pill mb-4">
            <Scissors className="w-3.5 h-3.5 text-[#d946ef]" />
            剪辑参考 · Gemini × Opus 双模型
          </span>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient-primary">
            AI 看你的素材，给出可执行剪辑清单
          </h1>
          <p className="mt-4 text-white/60 max-w-2xl mx-auto">
            Gemini 2.5 Pro 原生看视频解析素材潜力，Opus 4.7
            对照真实爆款，**只推荐你的素材真正能学的剪辑技法**，按时间轴排序。
          </p>
        </div>

        <div className="grid lg:grid-cols-[420px_1fr] gap-8">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="glass-card p-7">
              <InputPanel onSubmit={handleSubmit} isLoading={loading} />
            </div>
          </div>

          <div className="min-h-[400px] space-y-6">
            <AnimatePresence mode="wait">
              {(loading || (stages.length > 0 && !data && !error)) && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <ProgressTimeline stages={stages} />
                </motion.div>
              )}

              {error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-card p-8 border border-[#f43f5e]/30"
                >
                  <div className="text-[#f43f5e] font-semibold mb-2">出错了</div>
                  <p className="text-sm text-white/70">{error}</p>
                </motion.div>
              )}

              {!loading && !error && !data && stages.length === 0 && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-card p-12 text-center"
                >
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] mb-5">
                    <Scissors className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">
                    上传你的视频草稿
                  </h3>
                  <p className="text-sm text-white/60 max-w-md mx-auto">
                    AI 会看完整段视频，找出你的素材能学什么、不能学什么，输出具体到秒的剪辑改动建议。
                  </p>
                </motion.div>
              )}

              {!loading && data && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-6"
                >
                  {data.referenceSource === "sample" && data.referenceNotice && (
                    <div className="rounded-lg p-3 bg-[#22d3ee]/10 border border-[#22d3ee]/30 flex items-start gap-2">
                      <Info className="w-4 h-4 text-[#22d3ee] shrink-0 mt-0.5" />
                      <p className="text-xs text-white/75 leading-relaxed">
                        {data.referenceNotice}
                      </p>
                    </div>
                  )}
                  <UserDiagnosis potential={data.userPotential} />
                  <PriorityActions match={data.match} />
                  <GlobalDoNots items={data.match.globalDoNots} />
                  <ReferenceReports match={data.match} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
