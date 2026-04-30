"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { InputPanel } from "@/components/review/InputPanel";
import { OutputPanel } from "@/components/review/OutputPanel";
import { ProgressTimeline } from "@/components/review/ProgressTimeline";
import { Sparkles } from "lucide-react";
import type {
  ReviewInput,
  ReviewResult,
  ViralVideo,
} from "@/lib/review-engine/types";

type RetrievedShape = {
  topic: string;
  videos: ViralVideo[];
  matched: boolean;
  source?: "local" | "cache" | "live" | "fallback";
  hashtags?: string[];
};

type ResponseShape = {
  mode: "llm" | "mock";
  modelId?: string;
  retrieved: RetrievedShape;
  result: ReviewResult;
};

export type StageEvent = {
  stage: string;
  message: string;
  data?: Record<string, unknown>;
  time: number;
};

export default function ReviewPage() {
  const [data, setData] = useState<ResponseShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageEvent[]>([]);

  const handleSubmit = async (input: ReviewInput) => {
    setLoading(true);
    setError(null);
    setStages([]);
    setData(null);

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
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
              | { type: "stage"; stage: string; message: string; data?: Record<string, unknown> }
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
            // skip malformed lines
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
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient-primary">
            AI 爆款评审
          </h1>
          <p className="mt-4 text-white/60 max-w-xl mx-auto">
            描述你的想法或上传一段草稿，AI
            会基于真实爆款数据给你一份专业评审报告。
          </p>
        </div>

        <div className="grid lg:grid-cols-[420px_1fr] gap-8">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="glass-card p-7">
              <InputPanel onSubmit={handleSubmit} isLoading={loading} />
            </div>
          </div>

          <div className="min-h-[400px]">
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
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">
                    填写左侧表单，开始评审
                  </h3>
                  <p className="text-sm text-white/60 max-w-md mx-auto">
                    点击「快速开始」可以一键填入示例题材，立刻看到完整的评审报告样式。
                  </p>
                </motion.div>
              )}

              {!loading && data && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <OutputPanel
                    result={data.result}
                    retrieved={data.retrieved}
                    mode={data.mode}
                  />
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
