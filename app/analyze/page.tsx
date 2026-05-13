"use client";

import { Sparkles } from "lucide-react";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { InputPanel } from "@/components/technique-match/InputPanel";
import { AnalyzeResults } from "@/components/technique-match/ResultsArea";
import { useAnalyzeStream } from "@/components/technique-match/useAnalyzeStream";

/**
 * /analyze · 统一分析入口（合并 /review 的渐进披露 + /technique-match 的深度匹配）
 *
 * 数据 pipeline 走 /api/technique-match：
 *   - Gemini 2.5 Pro 看视频（fast lane，约 30-60s）→ partial event → UserDiagnosis
 *   - Opus 4.7 双向匹配爆款（deep lane，约 90-120s）→ result event → 完整报告
 *
 * 用户体验：上传素材后 ~30s 看到第一份可读的素材诊断，再等 2 分钟拿到爆款
 * 对标、可执行优先级、配乐推荐和 CapCut 导出。
 */
export default function AnalyzePage() {
  const stream = useAnalyzeStream();

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-6 lg:px-10 py-12">
        <div className="mb-10 text-center">
          <span className="pill mb-4">
            <Sparkles className="w-3.5 h-3.5 text-[#22d3ee]" />
            统一分析入口 · Gemini × Opus 渐进披露
          </span>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient-primary">
            上传素材 · 30s 拿初判 · 2 分钟拿剪辑清单
          </h1>
          <p className="mt-4 text-white/60 max-w-2xl mx-auto">
            Gemini 2.5 Pro 30 秒看完你的素材，先给你「视频本身能做成什么」的快速诊断；
            Opus 4.7 再用 90 秒对照真实爆款，告诉你「哪些技法值得学，哪些不要学」。
          </p>
        </div>

        <div className="grid lg:grid-cols-[420px_1fr] gap-8">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="glass-card p-7">
              <InputPanel onSubmit={stream.submit} isLoading={stream.loading} />
            </div>
          </div>

          <div className="min-h-[400px]">
            <AnalyzeResults
              loading={stream.loading}
              error={stream.error}
              stages={stream.stages}
              partial={stream.partial}
              full={stream.full}
              videoUrl={stream.videoUrl}
              emptyTitle="上传你的视频素材"
              emptySubtitle="Gemini 先 30 秒给你素材诊断，Opus 再 2 分钟给你完整的爆款对标 + 可执行剪辑清单。"
            />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
