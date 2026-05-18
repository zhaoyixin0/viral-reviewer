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
};

export function selectForEnrichment(
  videos: ViralVideo[],
  opts: SelectOptions,
): ViralVideo[] {
  if (opts.maxTotal <= 0 || opts.topPerHashtag <= 0) return [];

  const buckets = new Map<string, ViralVideo[]>();
  const HASHTAG_KEYS: string[] = [];
  for (const v of videos) {
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
