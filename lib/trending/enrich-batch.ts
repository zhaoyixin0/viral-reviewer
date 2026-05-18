import "server-only";
import type { CutPlan } from "@/lib/cut-plan/schema";
import type { ViralVideo } from "@/lib/review-engine/types";
import {
  enrichTrendingVideo,
  type EnrichOptions,
} from "./enrich-trending-video";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "trending/enrich-batch" });

export type EnrichBatchOptions = {
  /** Max concurrent Gemini File API workflows. Default 3 (~5/s rate-limit safe). */
  concurrency?: number;
  /** Hard cap on videos processed (cost budget). Default 15 per L3+ plan §4.3. */
  maxVideos?: number;
  /** Per-video transient retry count (D5=B). Default 1. */
  retries?: number;
  /** Backoff before retry, ms. Default 5000. */
  retryBackoffMs?: number;
  /** Forward AbortController signal so cron-route can interrupt mid-batch. */
  signal?: AbortSignal;
  /** Pass-through to enrichTrendingVideo (tmpDir / downloadTimeoutMs override). */
  enrichOptions?: EnrichOptions;
};

export type EnrichBatchResult = {
  plans: Array<{ video: ViralVideo; cutPlan: CutPlan }>;
  failures: Array<{ videoId: string; reason: string }>;
};

/**
 * Classify a failure reason string into retryable vs non-retryable.
 *
 * Heuristic (intentionally permissive): treat anything we cannot prove is a
 * permanent 4xx as transient. yt-dlp wraps timeouts and connection resets
 * inside generic strings, and Gemini File API surfaces transient 5xx as
 * "Gemini file processing failed" — both should retry.
 *
 * Non-retryable signals: explicit 4xx codes (not 408 / 429), invalid input,
 * unsupported format. These would burn quota without helping.
 */
function isRetryable(reason: string): boolean {
  const lower = reason.toLowerCase();
  if (/\b4(?:0[0-7]|1[0-79]|2[0-8])\b/.test(lower)) return false;
  if (lower.includes("invalid") || lower.includes("unsupported")) return false;
  return true;
}

/**
 * Sleep that resolves early if the signal aborts.
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Batch enrichment with hand-rolled concurrency control (no p-limit dep, per
 * L3+ plan zero-dep mandate) and per-video transient retry (D5=B).
 *
 * Reliability contract (per memory stage2-failure-loses-stage1): failures are
 * collected into a parallel array; the caller (T3 cron route) MUST persist
 * Stage 1 video metadata even when enrichment fully fails — passing an empty
 * insight rather than dropping the snapshot.
 */
export async function enrichBatch(
  videos: ViralVideo[],
  opts: EnrichBatchOptions = {},
): Promise<EnrichBatchResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const maxVideos = Math.max(0, opts.maxVideos ?? 15);
  const retries = Math.max(0, opts.retries ?? 1);
  const retryBackoffMs = Math.max(0, opts.retryBackoffMs ?? 5000);
  const signal = opts.signal;

  const queue = videos.slice(0, maxVideos);
  const plans: EnrichBatchResult["plans"] = [];
  const failures: EnrichBatchResult["failures"] = [];

  let cursor = 0;

  async function processOne(video: ViralVideo): Promise<void> {
    let lastReason = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) {
        failures.push({ videoId: video.id, reason: "aborted" });
        return;
      }
      const r = await enrichTrendingVideo(video, opts.enrichOptions);
      if (r.ok) {
        plans.push({ video, cutPlan: r.cutPlan });
        return;
      }
      lastReason = r.reason;
      if (attempt >= retries) break;
      if (!isRetryable(r.reason)) {
        log.warn("non-retryable enrichment failure", {
          videoId: video.id,
          reason: r.reason,
        });
        break;
      }
      log.warn("transient enrichment failure, retrying", {
        videoId: video.id,
        attempt: attempt + 1,
        reason: r.reason,
      });
      await sleep(retryBackoffMs, signal);
    }
    failures.push({ videoId: video.id, reason: lastReason });
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (signal?.aborted) return;
      const idx = cursor++;
      if (idx >= queue.length) return;
      await processOne(queue[idx]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return { plans, failures };
}
