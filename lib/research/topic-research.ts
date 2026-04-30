import "server-only";
import {
  scrapeInstagramByHashtag,
  scrapeTikTokByHashtag,
} from "@/lib/apify/scrapers";
import { generateHashtagsForTopic } from "./hashtag-generator";
import { enrichBatch } from "./enrich-one";
import type { ViralVideo } from "@/lib/review-engine/types";

export type ResearchProgress = {
  stage:
    | "hashtags"
    | "scraping_tiktok"
    | "scraping_instagram"
    | "enriching"
    | "done";
  message: string;
  data?: { hashtags?: string[]; rawCount?: number; enrichedCount?: number };
};

export type ResearchResult = {
  topic: string;
  hashtags: string[];
  videos: ViralVideo[]; // top-10（TT 5 + IG 5），按 views 排序
};

/**
 * 实时按题材搜索 TikTok + Instagram 爆款。
 *
 * Flow:
 *   1. LLM 把题材翻译成 5-6 个真实 hashtag
 *   2. Apify TT/IG 各抓 5 条
 *   3. Haiku 富化（playStyle / visualStyle / hook）
 *   4. 返回结构化 ViralVideo[]
 */
export async function researchTopicLive(
  topic: string,
  onProgress?: (p: ResearchProgress) => void,
): Promise<ResearchResult> {
  const emit = (p: ResearchProgress) => {
    try {
      onProgress?.(p);
    } catch {
      /* ignore */
    }
  };

  // 1) hashtags
  emit({ stage: "hashtags", message: `生成「${topic}」相关 hashtag…` });
  let hashtags: string[];
  try {
    hashtags = await generateHashtagsForTopic(topic);
  } catch {
    // 兜底：把 topic 直接当一个 hashtag
    hashtags = [topic.replace(/\s+/g, "").toLowerCase()];
  }
  emit({
    stage: "hashtags",
    message: `已选 hashtag: ${hashtags.join(", ")}`,
    data: { hashtags },
  });

  // 2) TikTok scrape (top 5 by views, fewer hashtags = faster)
  emit({
    stage: "scraping_tiktok",
    message: "在 TikTok 搜索同题材爆款…",
  });
  let tiktokVideos: ViralVideo[] = [];
  try {
    const ttHashtags = hashtags.slice(0, 3);
    const raw = await scrapeTikTokByHashtag({
      hashtags: ttHashtags,
      topic,
      resultsPerPage: 8,
    });
    tiktokVideos = [...raw]
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);
  } catch (e) {
    console.error("[topic-research] TikTok scrape failed:", e);
  }

  // 3) Instagram scrape
  emit({
    stage: "scraping_instagram",
    message: "在 Instagram Reels 搜索同题材爆款…",
  });
  let instagramVideos: ViralVideo[] = [];
  try {
    const igHashtags = hashtags.slice(0, 2);
    const raw = await scrapeInstagramByHashtag({
      hashtags: igHashtags,
      topic,
      resultsLimit: 10,
    });
    instagramVideos = [...raw]
      .filter((v) => v.views > 0 || v.likes > 0)
      .sort((a, b) => b.views - a.views || b.likes - a.likes)
      .slice(0, 5);
  } catch (e) {
    console.error("[topic-research] Instagram scrape failed:", e);
  }

  const merged = [...tiktokVideos, ...instagramVideos];

  // 4) Enrich with Haiku
  emit({
    stage: "enriching",
    message: `分析 ${merged.length} 条视频的玩法/视觉/hook…`,
    data: { rawCount: merged.length },
  });
  const enriched = await enrichBatch(merged, 5);

  emit({
    stage: "done",
    message: `搜索完成：${enriched.length} 条同题材爆款`,
    data: { enrichedCount: enriched.length },
  });

  return { topic, hashtags, videos: enriched };
}
