"use client";

import { useState } from "react";
import type { StageEvent } from "@/app/review/page";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { AnalyzeResponseShape } from "./ResultsArea";

type StreamEvent =
  | { type: "stage"; stage: string; message: string; data?: Record<string, unknown> }
  | {
      type: "partial";
      phase: "potential";
      data: {
        materialIndex: number;
        totalMaterials: number;
        userVideoId: string;
        userPotential: MaterialPotential;
      };
    }
  | { type: "result"; data: AnalyzeResponseShape }
  | { type: "error"; message: string };

export type SubmitArgs = {
  videoUrls: string[];
  videoFileNames: string[];
  topic: string;
  intent: string;
};

export type AnalyzeStreamState = {
  loading: boolean;
  error: string | null;
  stages: StageEvent[];
  /**
   * 按上传全集 materialIndex 索引的 partial 池。null = 该 index 还没分析完
   * （或最终失败）。第一个 partial event 到达时按 totalMaterials 预填 null，
   * 后续按 materialIndex 写入 —— Task 13 渲染 N 个 UserDiagnosis 时能直接遍历。
   */
  partials: (MaterialPotential | null)[];
  full: AnalyzeResponseShape | null;
  videoUrls: string[] | null;
  videoFileNames: string[] | null;
  submit: (args: SubmitArgs) => Promise<void>;
};

/**
 * 把 /api/technique-match 的 NDJSON SSE 流解开，分发到三个 state slot：
 *   - stages：每个 progress event
 *   - partials：Gemini 完成后的 fast-lane payload（按 materialIndex 索引）
 *   - full：Opus 完成后的最终结果
 *
 * Task 4：partial / result / AnalyzeResponseShape 全部数组化，与后端 N 视频
 * 并行分析的发射形态对齐（窗口3 review C2 follow-up）。
 */
export function useAnalyzeStream(): AnalyzeStreamState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [partials, setPartials] = useState<(MaterialPotential | null)[]>([]);
  const [full, setFull] = useState<AnalyzeResponseShape | null>(null);
  const [videoUrls, setVideoUrls] = useState<string[] | null>(null);
  const [videoFileNames, setVideoFileNames] = useState<string[] | null>(null);

  const submit = async (args: SubmitArgs) => {
    setLoading(true);
    setError(null);
    setStages([]);
    setPartials([]);
    setFull(null);
    setVideoUrls(args.videoUrls);
    setVideoFileNames(args.videoFileNames);

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
            const event = JSON.parse(line) as StreamEvent;
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
            } else if (event.type === "partial") {
              if (event.phase === "potential") {
                const { materialIndex, totalMaterials, userPotential } =
                  event.data;
                setPartials((prev) => {
                  const next =
                    prev.length === totalMaterials
                      ? [...prev]
                      : Array.from(
                          { length: totalMaterials },
                          (_, i) => prev[i] ?? null,
                        );
                  next[materialIndex] = userPotential;
                  return next;
                });
              }
            } else if (event.type === "result") {
              setFull(event.data);
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

  return {
    loading,
    error,
    stages,
    partials,
    full,
    videoUrls,
    videoFileNames,
    submit,
  };
}
