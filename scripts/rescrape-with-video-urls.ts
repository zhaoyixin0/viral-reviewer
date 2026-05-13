/**
 * Run: npx tsx --env-file=.env.local scripts/rescrape-with-video-urls.ts
 *
 * 输入 data/scraped/enriched-2026-04-29.json
 * 用 Apify 按 URL 重新抓取，拿到 videoUrl 字段，输出 data/rescrape-2026-05-13.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getApifyClient } from "@/lib/apify/client";
import type { ViralVideo } from "@/lib/review-engine/types";

type EnrichedWithVideoUrl = ViralVideo & { videoUrl: string | null };

async function rescrapeTikTok(urls: string[]): Promise<Map<string, string>> {
  const client = getApifyClient();
  const run = await client.actor("clockworks/tiktok-scraper").call({
    postURLs: urls,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const map = new Map<string, string>();
  for (const raw of items as Record<string, unknown>[]) {
    const id = (raw.id ?? raw.videoId) as string | undefined;
    // This actor (free tier) does not expose CDN download URLs.
    // webVideoUrl is the canonical page URL; yt-dlp can download from it.
    const videoUrl =
      ((raw.videoMeta as Record<string, unknown> | undefined)?.downloadAddr as
        | string
        | undefined) ??
      ((raw.video as Record<string, unknown> | undefined)?.playAddr as
        | string
        | undefined) ??
      (raw.videoUrl as string | undefined) ??
      (raw.webVideoUrl as string | undefined) ??
      null;
    if (id && videoUrl) map.set(`tt-${id}`, videoUrl);
  }
  return map;
}

async function rescrapeInstagram(urls: string[]): Promise<Map<string, string>> {
  const client = getApifyClient();
  const run = await client.actor("apify/instagram-scraper").call({
    directUrls: urls,
    resultsType: "posts",
    resultsLimit: urls.length,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const map = new Map<string, string>();
  for (const raw of items as Record<string, unknown>[]) {
    const shortcode = (raw.shortCode ?? raw.shortcode ?? raw.code) as
      | string
      | undefined;
    // This actor (free tier) does not expose CDN video stream URLs.
    // url is the canonical page URL; yt-dlp can download from it.
    const videoUrl =
      (raw.videoUrl as string | undefined) ??
      (raw.video_url as string | undefined) ??
      (raw.url as string | undefined) ??
      null;
    if (shortcode && videoUrl) map.set(`ig-${shortcode}`, videoUrl);
  }
  return map;
}

async function main() {
  const inPath = join(process.cwd(), "data", "scraped", "enriched-2026-04-29.json");
  const raw = await readFile(inPath, "utf-8");
  const videos = JSON.parse(raw) as ViralVideo[];
  console.log(`[rescrape] loaded ${videos.length} videos`);

  const ttVideos = videos.filter((v) => v.platform === "tiktok");
  const igVideos = videos.filter((v) => v.platform === "instagram");

  console.log(`[rescrape] tiktok: ${ttVideos.length}, instagram: ${igVideos.length}`);

  const ttMap = await rescrapeTikTok(ttVideos.map((v) => v.url));
  console.log(`[rescrape] tiktok videoUrl found: ${ttMap.size}/${ttVideos.length}`);
  const igMap = await rescrapeInstagram(igVideos.map((v) => v.url));
  console.log(`[rescrape] instagram videoUrl found: ${igMap.size}/${igVideos.length}`);

  const merged: EnrichedWithVideoUrl[] = videos.map((v) => ({
    ...v,
    videoUrl: (v.platform === "tiktok" ? ttMap.get(v.id) : igMap.get(v.id)) ?? null,
  }));

  const withUrl = merged.filter((v) => v.videoUrl).length;
  console.log(`[rescrape] total with videoUrl: ${withUrl}/${merged.length}`);

  const outPath = join(process.cwd(), "data", "rescrape-2026-05-13.json");
  await writeFile(outPath, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`[rescrape] wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
