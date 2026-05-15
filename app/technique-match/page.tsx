"use client";

import { Scissors } from "lucide-react";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { InputPanel } from "@/components/technique-match/InputPanel";
import { AnalyzeResults } from "@/components/technique-match/ResultsArea";
import { useAnalyzeStream } from "@/components/technique-match/useAnalyzeStream";

export default function TechniqueMatchPage() {
  const stream = useAnalyzeStream();

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
              <InputPanel onSubmit={stream.submit} isLoading={stream.loading} />
            </div>
          </div>

          <div className="min-h-[400px]">
            <AnalyzeResults
              loading={stream.loading}
              error={stream.error}
              stages={stream.stages}
              partials={stream.partials}
              full={stream.full}
              videoUrl={stream.videoUrls?.[0] ?? null}
              videoFileName={stream.videoFileNames?.[0] ?? null}
            />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
