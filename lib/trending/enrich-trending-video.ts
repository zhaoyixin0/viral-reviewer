import "server-only";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CutPlan } from "@/lib/cut-plan/schema";
import type { ViralVideo } from "@/lib/review-engine/types";
import { downloadVideo } from "@/lib/enrichment/video-downloader";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import { understandVideoAsCutPlan } from "@/lib/video/gemini-understand";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "trending/enrich-trending-video" });

export type EnrichResult =
  | { ok: true; cutPlan: CutPlan }
  | { ok: false; reason: string };

export type EnrichOptions = {
  /** Override temp directory root. Defaults to OS tmpdir. */
  tmpDir?: string;
  /** yt-dlp single-attempt timeout (ms). Default 90s, matches video-downloader. */
  downloadTimeoutMs?: number;
};

/**
 * Per-week Gemini enrichment for one trending video (T1, plan §2).
 *
 * Pipeline: yt-dlp → ffprobe → Gemini 2.5 Pro → CutPlan.
 *
 * Scope deviation (per memory feedback_scope_deviation_document): plan §2.3
 * specified `plain fetch + storage.googleapis.com host hard-check`. That works
 * for technique-match (where URLs are our own GCS uploads) but not here —
 * `ViralVideo.url` for TikTok/Instagram is the *post page URL* (e.g.
 * `https://www.tiktok.com/@u/video/123`, see lib/apify/normalize.ts:16) which a
 * plain GET cannot resolve into an mp4. Existing `lib/enrichment/video-downloader.ts`
 * already solves this with yt-dlp (per memory video-download-stack); reusing it
 * keeps zero npm dep churn and the well-tested 2-retry / 90s-timeout policy.
 *
 * Transient retry (D5=B) is handled one layer up in enrichBatch — this helper
 * surfaces a single classified failure reason for the caller to decide on.
 */
export async function enrichTrendingVideo(
  video: ViralVideo,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const workRoot = opts.tmpDir ?? tmpdir();
  const workDir = join(
    workRoot,
    `enrich-${video.id}-${Date.now().toString(36)}`,
  );
  const outPath = join(workDir, `${video.id}.mp4`);

  await mkdir(workDir, { recursive: true });

  try {
    const dl = await downloadVideo(video.url, outPath, {
      timeoutMs: opts.downloadTimeoutMs ?? 90_000,
    });
    if (!dl.ok) {
      return { ok: false, reason: `download_failed: ${dl.reason}` };
    }

    let meta;
    try {
      meta = await probeVideoMeta(dl.path);
    } catch (e) {
      return {
        ok: false,
        reason: `ffprobe_failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    try {
      // W3 C8 P1a: surface trending hashtag context to Gemini. The shared
      // GeminiUnderstandInput.hints schema (lib/video/gemini-understand.ts, W2
      // owned, read-only per window-4.md lock) doesn't declare a knownHashtag
      // field — the prompt builder only iterates sourceUrl / knownTitle /
      // knownBgm / knownTags. Verified at lib/video/gemini-understand.ts:174-179
      // per memory feedback_verify_http_behavior_assumptions. Injecting the
      // hashtag into knownTags (prefixed `#`) is the zero-shared-file-edit path
      // and feeds Gemini the same trending signal via the existing pipe.
      const hashtag = video.trendingContext?.hashtag;
      const knownTags = hashtag
        ? [`#${hashtag}`, ...(video.tags ?? [])]
        : video.tags;

      const cutPlan = await understandVideoAsCutPlan({
        videoPath: dl.path,
        videoId: video.id,
        meta,
        hints: {
          sourceUrl: video.url,
          knownTitle: video.title,
          knownBgm: video.bgm,
          knownTags,
        },
      });
      return { ok: true, cutPlan };
    } catch (e) {
      return {
        ok: false,
        reason: `gemini_failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } finally {
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch (e) {
      log.warn("tmp cleanup failed", { workDir, err: e });
    }
  }
}
