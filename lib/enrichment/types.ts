import type { CutPlan } from "@/lib/cut-plan/schema";

export type EnrichmentJob = {
  videoId: string;
  videoPath: string;
  platform: string;
  topic: string;
  durationSec: number;
};

export type EnrichmentSuccess = {
  ok: true;
  videoId: string;
  cutPlan: CutPlan;
  elapsedMs: number;
};

export type EnrichmentFailure = {
  ok: false;
  videoId: string;
  reason: string;
  stage: "ffprobe" | "gemini" | "schema" | "write" | "unknown";
};

export type EnrichmentResult = EnrichmentSuccess | EnrichmentFailure;

export type BatchProgress = {
  total: number;
  done: number;
  ok: number;
  failed: number;
  skipped: number;
};
