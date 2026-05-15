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
      data: { userVideoId: string; userPotential: MaterialPotential };
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
  partial: { userVideoId: string; userPotential: MaterialPotential } | null;
  full: AnalyzeResponseShape | null;
  videoUrls: string[] | null;
  videoFileNames: string[] | null;
  submit: (args: SubmitArgs) => Promise<void>;
};

/**
 * 把 /api/technique-match 的 NDJSON SSE 流解开，分发到三个 state slot：
 *   - stages：每个 progress event
 *   - partial：Gemini 完成后的 fast-lane payload
 *   - full：Opus 完成后的最终结果
 *
 * Task 3：输入侧数组化（videoUrls / videoFileNames）。`partial` 与
 * `AnalyzeResponseShape` 仍是单数形态，等 Task 4 与后端发射侧同步落地
 * （见 plan 窗口3 review C2）。
 */
export function useAnalyzeStream(): AnalyzeStreamState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [partial, setPartial] = useState<
    { userVideoId: string; userPotential: MaterialPotential } | null
  >(null);
  const [full, setFull] = useState<AnalyzeResponseShape | null>(null);
  const [videoUrls, setVideoUrls] = useState<string[] | null>(null);
  const [videoFileNames, setVideoFileNames] = useState<string[] | null>(null);

  const submit = async (args: SubmitArgs) => {
    setLoading(true);
    setError(null);
    setStages([]);
    setPartial(null);
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
                setPartial(event.data);
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
    partial,
    full,
    videoUrls,
    videoFileNames,
    submit,
  };
}
