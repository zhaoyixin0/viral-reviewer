"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { AuditPanel } from "@/components/template-review/AuditPanel";
import { AuditOutput } from "@/components/template-review/AuditOutput";
import { ExplorePanel } from "@/components/template-review/ExplorePanel";
import { ExploreOutput } from "@/components/template-review/ExploreOutput";
import { BrainstormPanel } from "@/components/template-review/BrainstormPanel";
import { BrainstormOutput } from "@/components/template-review/BrainstormOutput";
import { ProgressTimeline } from "@/components/review/ProgressTimeline";
import { ClipboardList, Compass, Sparkles, Wand2 } from "lucide-react";
import type {
  BrainstormInput,
  BrainstormResult,
  ExploreFilter,
  ExploreResult,
  TemplateAuditInput,
  TemplateAuditResult,
} from "@/lib/template-review/types";
import type { ViralVideo } from "@/lib/review-engine/types";
import type { StageEvent } from "@/app/review/page";

type Tab = "audit" | "explore" | "brainstorm";

type AuditResponse = {
  modelId?: string;
  concept: { topic: string; playStyle: string; visualStyle: string };
  retrieved: { topic: string; videos: ViralVideo[] };
  result: TemplateAuditResult;
};

type ExploreResponse = {
  modelId?: string;
  filter: ExploreFilter;
  corpusSize: number;
  result: ExploreResult;
};

type BrainstormResponse = {
  modelId?: string;
  retrieved: { topic: string; source: string; matched: boolean };
  result: BrainstormResult;
};

export default function TemplateReviewPage() {
  const [tab, setTab] = useState<Tab>("audit");
  const [auditData, setAuditData] = useState<AuditResponse | null>(null);
  const [exploreData, setExploreData] = useState<ExploreResponse | null>(null);
  const [brainstormData, setBrainstormData] =
    useState<BrainstormResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageEvent[]>([]);

  async function consumeStream<T>(
    res: Response,
    setData: (v: T) => void,
  ): Promise<void> {
    if (!res.body) throw new Error("no response body");
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
            | { type: "result"; data: T }
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
  }

  const handleAuditSubmit = async (input: TemplateAuditInput) => {
    setLoading(true);
    setError(null);
    setStages([]);
    setAuditData(null);
    setExploreData(null);
    try {
      const res = await fetch("/api/template-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `请求失败 (${res.status})`);
      }
      await consumeStream<AuditResponse>(res, setAuditData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleExploreSubmit = async (filter: ExploreFilter) => {
    setLoading(true);
    setError(null);
    setStages([]);
    setAuditData(null);
    setExploreData(null);
    setBrainstormData(null);
    try {
      const res = await fetch("/api/template-explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filter),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `请求失败 (${res.status})`);
      }
      await consumeStream<ExploreResponse>(res, setExploreData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleBrainstormSubmit = async (input: BrainstormInput) => {
    setLoading(true);
    setError(null);
    setStages([]);
    setAuditData(null);
    setExploreData(null);
    setBrainstormData(null);
    try {
      const res = await fetch("/api/template-brainstorm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `请求失败 (${res.status})`);
      }
      await consumeStream<BrainstormResponse>(res, setBrainstormData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (t: Tab) => {
    if (loading) return;
    setTab(t);
    setStages([]);
    setError(null);
    setAuditData(null);
    setExploreData(null);
    setBrainstormData(null);
  };

  const hasOutput = auditData || exploreData || brainstormData;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-6 lg:px-10 py-12">
        <div className="mb-10 text-center">
          <span className="pill mb-4">
            <Sparkles className="w-3.5 h-3.5 text-[#d946ef]" />
            内部工具 · TikTok 特效产品团队
          </span>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient-primary">
            模板审核
          </h1>
          <p className="mt-4 text-white/60 max-w-2xl mx-auto">
            基于真实大盘爆款数据，审核脑暴文档是否符合上线标准；
            或在脑暴前给出值得做的特效赛道方向。
          </p>
        </div>

        <div className="flex justify-center mb-8">
          <div className="glass-card p-1.5 inline-flex">
            {(
              [
                {
                  key: "brainstorm" as const,
                  label: "脑爆生成",
                  icon: Wand2,
                  desc: "Generator v0.3",
                },
                {
                  key: "audit" as const,
                  label: "审核脑暴",
                  icon: ClipboardList,
                  desc: "评估已有脑暴",
                },
                {
                  key: "explore" as const,
                  label: "探索方向",
                  icon: Compass,
                  desc: "脑暴前找方向",
                },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                className={`flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium transition-all ${
                  tab === t.key
                    ? "bg-gradient-to-r from-[#8b5cf6]/30 to-[#d946ef]/30 text-white shadow-[0_0_18px_-2px_rgba(217,70,239,0.4)]"
                    : "text-white/60 hover:text-white"
                }`}
              >
                <t.icon className="w-4 h-4" />
                <div className="text-left">
                  <div>{t.label}</div>
                  <div className="text-[10px] text-white/45">{t.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-[420px_1fr] gap-8">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="glass-card p-7">
              {tab === "audit" && (
                <AuditPanel
                  onSubmit={handleAuditSubmit}
                  isLoading={loading}
                />
              )}
              {tab === "explore" && (
                <ExplorePanel
                  onSubmit={handleExploreSubmit}
                  isLoading={loading}
                />
              )}
              {tab === "brainstorm" && (
                <BrainstormPanel
                  onSubmit={handleBrainstormSubmit}
                  isLoading={loading}
                />
              )}
            </div>
          </div>

          <div className="min-h-[400px]">
            <AnimatePresence mode="wait">
              {(loading || (stages.length > 0 && !hasOutput && !error)) && (
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

              {!loading && !error && !hasOutput && stages.length === 0 && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-card p-12 text-center"
                >
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] mb-5">
                    {tab === "audit" && (
                      <ClipboardList className="w-6 h-6 text-white" />
                    )}
                    {tab === "explore" && (
                      <Compass className="w-6 h-6 text-white" />
                    )}
                    {tab === "brainstorm" && (
                      <Wand2 className="w-6 h-6 text-white" />
                    )}
                  </div>
                  <h3 className="text-xl font-semibold mb-2">
                    {tab === "audit" && "粘贴脑暴文档，开始评审"}
                    {tab === "explore" && "选择筛选条件（或不选），扫描大盘"}
                    {tab === "brainstorm" && "上传 brief 或填四件套，开始脑爆"}
                  </h3>
                  <p className="text-sm text-white/60 max-w-md mx-auto">
                    {tab === "audit" &&
                      "AI 会从文档抽取题材 / 玩法 / 视觉，检索同类爆款做对比，输出 7 维评分 + 改进建议。"}
                    {tab === "explore" &&
                      "Opus 4.7 会基于本周爆款大盘 + 平台动态，给你 5-8 条值得做的特效赛道。"}
                    {tab === "brainstorm" &&
                      "PDF brief 自动抽 4 件套预填表单，调实时大盘做对标，按你选的发散方法产出 6-12 条结构化 idea。"}
                  </p>
                </motion.div>
              )}

              {!loading && auditData && (
                <motion.div
                  key="audit-result"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <AuditOutput
                    result={auditData.result}
                    concept={auditData.concept}
                    modelId={auditData.modelId}
                  />
                </motion.div>
              )}

              {!loading && exploreData && (
                <motion.div
                  key="explore-result"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <ExploreOutput
                    result={exploreData.result}
                    modelId={exploreData.modelId}
                    corpusSize={exploreData.corpusSize}
                    filter={{
                      topic: exploreData.filter.topic,
                      playStyle: exploreData.filter.playStyle,
                      platform: exploreData.filter.platform,
                    }}
                  />
                </motion.div>
              )}

              {!loading && brainstormData && (
                <motion.div
                  key="brainstorm-result"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <BrainstormOutput
                    result={brainstormData.result}
                    modelId={brainstormData.modelId}
                    retrieved={brainstormData.retrieved}
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
