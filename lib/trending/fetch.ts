import "server-only";
import {
  scrapeTikTokTrendingHashtags,
  scrapeTikTokByHashtag,
  scrapeInstagramByHashtag,
} from "@/lib/apify/scrapers";
import { enrichBatch } from "@/lib/research/enrich-one";
import { classifyTopics } from "./topic-classifier";
import { loadVideos } from "@/lib/data/load-videos";
import { currentWeek } from "./snapshot-store";
import {
  TRENDING_SCHEMA_VERSION,
  type PlatformMeta,
  type TrendingHashtag,
  type TrendingSnapshot,
} from "./types";
import { IG_HOT_HASHTAGS } from "./ig-hot-hashtags";
import type { ViralVideo } from "@/lib/review-engine/types";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "trending/fetch" });

// spec「成本估算 → 钉死的抓取参数」段定义的常量 —— 调大会线性涨成本,不要随意改
const TT_TRENDING_FETCH_LIMIT = 20;  // Stage 1 趋势榜抓回条数;Stage 1 是单 run,成本与条数基本无关,20 给 top-5 选取留余量
const TT_TRENDING_HASHTAG_COUNT = 5; // Stage 2 从 Stage 1 的 20 条里取 top-5 hashtag
const TT_VIDEOS_PER_HASHTAG = 30;    // 每个趋势 hashtag 抓 30 条视频
const IG_RESULTS_LIMIT = 50;

function failedMeta(source: PlatformMeta["source"]): PlatformMeta {
  return { source, actorRun: "", rawCount: 0, enrichedCount: 0, ok: false };
}

/**
 * TikTok 两阶段:Stage 1 抓趋势 hashtag 榜 → 取 top-N → Stage 2 按 rank 升序
 * 复用 scrapeTikTokByHashtag 抓视频 + 打 trendingContext(首次命中锁定,见 spec 2.6)。
 *
 * ok 判定(architect H2,符合 spec 5.1「不写空快照」):
 * - Stage 1 抛错 → ok=false
 * - Stage 1 成功但 Stage 2 全部 hashtag 抓取失败(有 hashtag 却 0 视频)→ ok=false
 *   —— 否则会写一份「TikTok 成功但 0 视频」的假成功快照
 * - Stage 1 成功且 Stage 2 至少抓到 1 条 → ok=true(部分 hashtag 失败是软降级)
 */
async function fetchTikTokTwoStage(): Promise<{
  hashtags: TrendingHashtag[];
  videos: ViralVideo[];
  runId: string;
  ok: boolean;
}> {
  let hashtags: TrendingHashtag[] = [];
  let runId = "";
  try {
    const stage1 = await scrapeTikTokTrendingHashtags({
      maxItems: TT_TRENDING_FETCH_LIMIT,
    });
    hashtags = stage1.hashtags;
    runId = stage1.runId;
  } catch (e) {
    log.error("TikTok Stage 1 failed", { err: e });
    return { hashtags: [], videos: [], runId: "", ok: false };
  }

  // Stage 2:按 rank 升序遍历 top-N hashtag,首次命中锁定 trendingContext。
  // 2026-05-17 cron 504 fix (W2-G + W4-H1): parallelize Apify scrape calls
  // via Promise.allSettled — serial loop (5 × ~30-60s = 150-300s) was top
  // contributor to Cloud Scheduler 180s deadline exceeded. Parallel collapses
  // to ~max-of-slowest (~30-60s). Rank-based first-hit-wins dedup preserved
  // by processing results in topHashtags index order (NOT settle order).
  const topHashtags = hashtags.slice(0, TT_TRENDING_HASHTAG_COUNT);
  const seen = new Set<string>();
  const videos: ViralVideo[] = [];
  const scrapeResults = await Promise.allSettled(
    topHashtags.map((h) =>
      scrapeTikTokByHashtag({
        hashtags: [h.name],
        topic: "",
        resultsPerPage: TT_VIDEOS_PER_HASHTAG,
      }),
    ),
  );
  for (let i = 0; i < topHashtags.length; i++) {
    const h = topHashtags[i];
    const result = scrapeResults[i];
    if (result.status === "rejected") {
      log.error("TikTok Stage 2 failed", { hashtag: h.name, err: result.reason });
      continue;
    }
    for (const v of result.value) {
      if (seen.has(v.id)) continue; // 首次命中锁定:已属更高 rank hashtag 的不覆盖
      seen.add(v.id);
      videos.push({
        ...v,
        trendingContext: { hashtag: h.name, hashtagRank: h.rank },
      });
    }
  }

  // architect H2:有 hashtag 但 Stage 2 一条视频都没抓到 → 视为 TikTok 失败,
  // 不让「TikTok 成功但 0 视频」的假成功快照落盘。
  const ok = !(topHashtags.length > 0 && videos.length === 0);
  if (!ok) {
    log.error("TikTok Stage 2 produced 0 videos, marking TikTok failed", {
      hashtagCount: topHashtags.length,
    });
  }
  return { hashtags, videos, runId, ok };
}

/**
 * 抓 TikTok 趋势(两阶段)+ IG 热门 hashtag 代理 → enrichBatch 富化 → Haiku 题材标签
 * → 合并成一份 TrendingSnapshot(不落盘,落盘交给调用方 + snapshot-store)。
 *
 * 容错:单平台失败 → 该平台 meta.ok=false + partial=true,另一平台继续。
 * 两个平台都失败 → throw(调用方据此跳过写空快照,避免覆盖上周好数据)。
 */
export async function fetchTrendingSnapshot(): Promise<TrendingSnapshot> {
  let trendingHashtags: TrendingHashtag[] = [];
  let ttVideos: ViralVideo[] = [];
  let ttMeta: PlatformMeta = failedMeta("trends-actor");
  let igVideos: ViralVideo[] = [];
  let igMeta: PlatformMeta = failedMeta("hashtag-proxy");

  const [ttResult, igResult] = await Promise.allSettled([
    fetchTikTokTwoStage(),
    scrapeInstagramByHashtag({
      hashtags: IG_HOT_HASHTAGS,
      topic: "",
      resultsLimit: IG_RESULTS_LIMIT,
    }),
  ]);

  if (ttResult.status === "fulfilled") {
    const tt = ttResult.value;
    // architect H2:即使 tt.ok=false(Stage 2 全挂),只要 Stage 1 成功拿到了
    // hashtag 榜,trendingHashtags 仍保留落盘 —— hashtag 榜独立有价值(spec 2.8)。
    trendingHashtags = tt.hashtags;
    ttVideos = tt.videos;
    ttMeta = {
      source: "trends-actor",
      actorRun: tt.runId,        // Stage 1 run id(spec L2)
      rawCount: tt.videos.length, // Stage 2 视频数(spec L2)
      enrichedCount: 0,
      ok: tt.ok,                 // Stage 1 失败 / Stage 2 全失败 → false
    };
  } else {
    // fetchTikTokTwoStage 内部已 catch Stage 1 错误并返回 ok:false,
    // 走到这里是 fetchTikTokTwoStage 本身的意外 throw —— 防御性分支。
    log.error("TikTok unexpected rejection", { reason: ttResult.reason });
  }

  if (igResult.status === "fulfilled") {
    igVideos = igResult.value;
    igMeta = {
      source: "hashtag-proxy",
      actorRun: "",
      rawCount: igVideos.length,
      enrichedCount: 0,
      ok: true,
    };
  } else {
    log.error("Instagram scrape failed", { reason: igResult.reason });
  }

  if (!ttMeta.ok && !igMeta.ok) {
    throw new Error("[trending/fetch] both platforms failed — skip writing snapshot");
  }

  // 富化(playStyle / visualStyle / hook)+ 题材标签
  const merged = [...ttVideos, ...igVideos];
  const libraryTopics = Array.from(
    new Set((await loadVideos()).map((v) => v.topic)),
  );
  const enriched = await enrichBatch(merged);
  const classified = await classifyTopics(enriched, libraryTopics);

  ttMeta.enrichedCount = classified.filter((v) => v.platform === "tiktok").length;
  igMeta.enrichedCount = classified.filter((v) => v.platform === "instagram").length;

  return {
    schemaVersion: TRENDING_SCHEMA_VERSION,
    week: currentWeek(),
    capturedAt: new Date().toISOString(),
    trendingHashtags,
    videos: classified,
    meta: {
      tiktok: ttMeta,
      instagram: igMeta,
      partial: !ttMeta.ok || !igMeta.ok,
    },
  };
}
