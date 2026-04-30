import { getApifyClient } from "./client";
import { normalizeInstagramItem, normalizeTikTokItem } from "./normalize";
import type { ViralVideo } from "@/lib/review-engine/types";

/**
 * Run TikTok scraper for a list of hashtags or search terms.
 * Uses clockworks/tiktok-scraper (popular, well-maintained Apify actor).
 */
export async function scrapeTikTokByHashtag(opts: {
  hashtags: string[];
  topic: string;
  resultsPerPage?: number;
}): Promise<ViralVideo[]> {
  const client = getApifyClient();
  const { hashtags, topic, resultsPerPage = 20 } = opts;

  const run = await client.actor("clockworks/tiktok-scraper").call({
    hashtags,
    resultsPerPage,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

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
}): Promise<ViralVideo[]> {
  const client = getApifyClient();
  const { hashtags, topic, resultsLimit = 20 } = opts;

  const run = await client.actor("apify/instagram-hashtag-scraper").call({
    hashtags,
    resultsLimit,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  // IG hashtag scraper 返回 image + video 混合，不过滤 type，让 normalize 全接
  return (items as Record<string, unknown>[])
    .map((item) => normalizeInstagramItem(item, topic))
    .filter((v): v is ViralVideo => v !== null);
}
