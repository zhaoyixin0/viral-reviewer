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
  videoUrl: string;
  videoFileName: string;
  topic: string;
  intent: string;
};

export type AnalyzeStreamState = {
  loading: boolean;
  error: string | null;
  stages: StageEvent[];
  partial: { userVideoId: string; userPotential: MaterialPotential } | null;
  full: AnalyzeResponseShape | null;
  videoUrl: string | null;
  videoFileName: string | null;
  submit: (args: SubmitArgs) => Promise<void>;
};

/**
 * 把 /api/technique-match 的 NDJSON SSE 流解开，分发到三个 state slot：
 *   - stages：每个 progress event
 *   - partial：Gemini 完成后的 fast-lane payload
 *   - full：Opus 完成后的最终结果
 */
export function useAnalyzeStream(): AnalyzeStreamState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [partial, setPartial] = useState<
    { userVideoId: string; userPotential: MaterialPotential } | null
  >(null);
  const [full, setFull] = useState<AnalyzeResponseShape | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);

  const submit = async (args: SubmitArgs) => {
    setLoading(true);
    setError(null);
    setStages([]);
    setPartial(null);
    setFull(null);
    setVideoUrl(args.videoUrl);
    setVideoFileName(args.videoFileName);

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
    videoUrl,
    videoFileName,
    submit,
  };
}
