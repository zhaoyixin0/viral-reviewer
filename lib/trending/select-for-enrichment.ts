import type { ViralVideo } from "@/lib/review-engine/types";

/**
 * Selects which videos to send to enrichBatch (T3, plan §4.3).
 *
 * Rule: take top-N (by views) from EACH unique hashtag (for TikTok-tagged
 * videos), plus top-N from the platform=instagram pool (no hashtag context).
 * Cap the total at maxTotal to keep weekly Gemini cost bounded.
 *
 * Stable iteration order: hashtags processed in first-seen order from the
 * input array (callers pass them sorted by hashtag rank — T1 hashtag rank 1
 * gets first crack at the budget).
 */

export type SelectOptions = {
  /** Per-hashtag-bucket cap before global cap applies. */
  topPerHashtag: number;
  /** Global cap across all buckets (weekly cost ceiling, default 15). */
  maxTotal: number;
  /**
   * Platforms eligible for per-video CutPlan enrichment. Default `["tiktok"]`
   * — Instagram requires authenticated cookies for per-video download in
   * prod (memory: video-download-stack.md). When IG cookie infra lands,
   * callers can pass `["tiktok", "instagram"]` to restore mixed-mode
   * enrichment. The IG raw videos still ride on the snapshot's `videos[]`
   * field — they are just skipped from the Gemini CutPlan budget here.
   */
  enabledPlatforms?: ViralVideo["platform"][];
};

const DEFAULT_ENABLED_PLATFORMS: ViralVideo["platform"][] = ["tiktok"];

export function selectForEnrichment(
  videos: ViralVideo[],
  opts: SelectOptions,
): ViralVideo[] {
  if (opts.maxTotal <= 0 || opts.topPerHashtag <= 0) return [];

  const enabled = opts.enabledPlatforms ?? DEFAULT_ENABLED_PLATFORMS;
  const filtered = videos.filter((v) => enabled.includes(v.platform));

  const buckets = new Map<string, ViralVideo[]>();
  const HASHTAG_KEYS: string[] = [];
  for (const v of filtered) {
    const key = v.trendingContext?.hashtag ?? `__ig:${v.platform}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      HASHTAG_KEYS.push(key);
    }
    buckets.get(key)!.push(v);
  }

  const selected: ViralVideo[] = [];
  const seen = new Set<string>();
  for (const key of HASHTAG_KEYS) {
    const bucket = buckets.get(key)!;
    bucket.sort((a, b) => b.views - a.views);
    for (const v of bucket.slice(0, opts.topPerHashtag)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      selected.push(v);
      if (selected.length >= opts.maxTotal) return selected;
    }
  }
  return selected;
}
