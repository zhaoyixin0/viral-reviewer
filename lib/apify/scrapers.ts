import { getApifyClient } from "./client";
import {
  normalizeInstagramItem,
  normalizeTikTokItem,
  normalizeTikTokTrendingHashtag,
} from "./normalize";
import type { ViralVideo } from "@/lib/review-engine/types";
import type { TrendingHashtag } from "@/lib/trending/types";

/**
 * Race an in-flight Apify SDK promise against an AbortSignal so the cron-route
 * watchdog can bail out of JS-side waits. The Apify actor itself keeps running
 * on Apify's servers (SDK has no native abort), but the local Promise rejects
 * promptly with AbortError, releasing the cron pipeline to write partial data.
 */
function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Run TikTok scraper for a list of hashtags or search terms.
 * Uses clockworks/tiktok-scraper (popular, well-maintained Apify actor).
 */
export async function scrapeTikTokByHashtag(opts: {
  hashtags: string[];
  topic: string;
  resultsPerPage?: number;
  signal?: AbortSignal;
}): Promise<ViralVideo[]> {
  const client = getApifyClient();
  const { hashtags, topic, resultsPerPage = 20, signal } = opts;

  const run = await raceAbort(
    client.actor("clockworks/tiktok-scraper").call({
      hashtags,
      resultsPerPage,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    }),
    signal,
  );

  const { items } = await raceAbort(
    client.dataset(run.defaultDatasetId).listItems(),
    signal,
  );

  return (items as Record<string, unknown>[])
    .map((item) => normalizeTikTokItem(item, topic))
    .filter((v): v is ViralVideo => v !== null);
}

/**
 * Run Instagram scraper for hashtags or profiles.
 * Uses apify/instagram-scraper.
 */
export async function scrapeInstagramByHashtag(opts: {
  hashtags: string[];
  topic: string;
  resultsLimit?: number;
  signal?: AbortSignal;
}): Promise<ViralVideo[]> {
  const client = getApifyClient();
  const { hashtags, topic, resultsLimit = 20, signal } = opts;

  const run = await raceAbort(
    client.actor("apify/instagram-hashtag-scraper").call({
      hashtags,
      resultsLimit,
    }),
    signal,
  );

  const { items } = await raceAbort(
    client.dataset(run.defaultDatasetId).listItems(),
    signal,
  );

  // IG hashtag scraper 返回 image + video 混合，不过滤 type，让 normalize 全接
  return (items as Record<string, unknown>[])
    .map((item) => normalizeInstagramItem(item, topic))
    .filter((v): v is ViralVideo => v !== null);
}

/**
 * Stage 1: 抓 TikTok 趋势 hashtag 榜(clockworks/tiktok-trends-scraper)。
 * 该 actor 返回的是热门 hashtag 排行榜(rank/viewCount/videoCount/…),不是视频
 * —— 见 P1.7 probe 实测 + spec v4。Stage 2 用这些 hashtag 喂 scrapeTikTokByHashtag。
 * actor 输入键(countryCode / maxItems)以 P1.7 probe 验证为准。
 *
 * `maxItems` 为**必填**(无默认值)—— 抓取量是 fetch.ts 的成本决策,
 * 由调用方传入 `TT_TRENDING_FETCH_LIMIT` 常量(architect M1:不在此处留魔法数)。
 */
export async function scrapeTikTokTrendingHashtags(opts: {
  countryCode?: string;
  maxItems: number;
  signal?: AbortSignal;
}): Promise<{ hashtags: TrendingHashtag[]; runId: string }> {
  const client = getApifyClient();
  const { countryCode = "US", maxItems, signal } = opts;

  const run = await raceAbort(
    client.actor("clockworks/tiktok-trends-scraper").call({
      countryCode,
      maxItems,
    }),
    signal,
  );

  const { items } = await raceAbort(
    client.dataset(run.defaultDatasetId).listItems(),
    signal,
  );
  const hashtags = (items as Record<string, unknown>[])
    .map((item) => normalizeTikTokTrendingHashtag(item))
    .filter((h): h is TrendingHashtag => h !== null)
    .sort((a, b) => a.rank - b.rank);

  return { hashtags, runId: run.id };
}
