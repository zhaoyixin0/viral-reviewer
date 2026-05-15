import "server-only";
import type { ReviewInputVideo, ViralVideo } from "./types";
import { loadVideos } from "@/lib/data/load-videos";
import {
  readTopicCache,
  writeTopicCache,
} from "@/lib/topic-cache/blob-cache";
import {
  researchTopicLive,
  type ResearchProgress,
} from "@/lib/research/topic-research";
import {
  inferTopic,
  type InferredTopic,
} from "@/lib/research/topic-inference";

function rankByEngagement(pool: ViralVideo[], topK: number): ViralVideo[] {
  return [...pool]
    .map((v) => ({
      v,
      engagementRate:
        (v.likes + v.comments * 5 + v.shares * 10) / Math.max(v.views, 1),
    }))
    .sort((a, b) => b.v.views - a.v.views || b.engagementRate - a.engagementRate)
    .slice(0, topK)
    .map((x) => x.v);
}

export type VideoSignature = {
  playStyle?: string;
  visualStyle?: string;
  hook?: string;
  duration?: number;
};

function tokens(s: string | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[（）()【】\[\],.;:!?，。、；：！？\-_/]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function similarityScore(v: ViralVideo, sig: VideoSignature): number {
  let s = 0;
  s += 0.4 * jaccard(tokens(v.playStyle), tokens(sig.playStyle));
  s += 0.3 * jaccard(tokens(v.visualStyle), tokens(sig.visualStyle));
  s += 0.2 * jaccard(tokens(v.hook), tokens(sig.hook));
  if (sig.duration && v.duration > 0) {
    const diff = Math.abs(v.duration - sig.duration);
    s += 0.1 * Math.max(0, 1 - diff / 30);
  }
  return s;
}

/**
 * 同 topic 池子里聚类采样：按 playStyle 分桶，round-robin 取一条直到拼满。
 * 文字模式（没有 videoSignature）下用，让两条同品类输入拿到风格多样化的 benchmark。
 */
function diversifyByCluster(pool: ViralVideo[], topK: number): ViralVideo[] {
  if (pool.length <= topK) return rankByEngagement(pool, topK);
  const buckets = new Map<string, ViralVideo[]>();
  for (const v of pool) {
    const key = (v.playStyle || "unknown").trim() || "unknown";
    const arr = buckets.get(key);
    if (arr) arr.push(v);
    else buckets.set(key, [v]);
  }
  const sortedBuckets = [...buckets.values()].map((b) =>
    [...b].sort((x, y) => y.views - x.views),
  );
  const result: ViralVideo[] = [];
  let i = 0;
  let progressed = true;
  while (result.length < topK && progressed) {
    progressed = false;
    for (const b of sortedBuckets) {
      if (result.length >= topK) break;
      if (i < b.length) {
        result.push(b[i]);
        progressed = true;
      }
    }
    i++;
  }
  return result;
}

/**
 * 视频模式：一半挑"最像 user 视频"做正面对标，一半挑"最不像"做反差/破局对标，
 * 让两条不同视频即使同 topic 也拿到真正不同的 benchmark 集合。
 */
function rankBySignature(
  pool: ViralVideo[],
  sig: VideoSignature,
  topK: number,
): ViralVideo[] {
  if (pool.length <= topK) return rankByEngagement(pool, topK);
  const scored = pool.map((v) => ({ v, sim: similarityScore(v, sig) }));
  const closestN = Math.ceil(topK / 2);
  const closest = [...scored]
    .sort((a, b) => b.sim - a.sim || b.v.views - a.v.views)
    .slice(0, closestN)
    .map((x) => x.v);
  const closestIds = new Set(closest.map((v) => v.id));
  const rest = [...scored]
    .filter((x) => !closestIds.has(x.v.id))
    .sort((a, b) => a.sim - b.sim || b.v.views - a.v.views)
    .slice(0, topK - closest.length)
    .map((x) => x.v);
  return [...closest, ...rest];
}

function pickFromTopicPool(
  pool: ViralVideo[],
  sig: VideoSignature | undefined,
  topK: number,
): ViralVideo[] {
  if (sig && (sig.playStyle || sig.visualStyle || sig.hook || sig.duration)) {
    return rankBySignature(pool, sig, topK);
  }
  return diversifyByCluster(pool, topK);
}

/** snapshot 兜底层：高置信题材标签的最低阈值。低于此值的视频不进 /analyze 匹配。 */
const SNAPSHOT_CONFIDENCE_THRESHOLD = 0.6;
/** snapshot 兜底层：canonicalTopic 与视频 topic 的 jaccard 模糊匹配最低分。 */
const SNAPSHOT_TOPIC_MATCH_THRESHOLD = 0.2;

/**
 * 从全局 trending snapshot 里按用户题材模糊匹配采样。
 * 纯函数：先按 topicConfidence 过滤（只信高置信标签，architect M3），
 * 再用已有的 jaccard 对 canonicalTopic 与 v.topic 算重叠分，
 * 取超阈值的、按 views 降序的 top-K。全部不命中 → 返回空数组（调用方据此走 live）。
 */
export function pickSnapshotMatches(
  snapshotVideos: ViralVideo[],
  canonicalTopic: string,
  topK: number,
): ViralVideo[] {
  const topicTokens = tokens(canonicalTopic);
  return snapshotVideos
    .filter((v) => (v.topicConfidence ?? 0) >= SNAPSHOT_CONFIDENCE_THRESHOLD)
    .map((v) => ({ v, score: jaccard(topicTokens, tokens(v.topic)) }))
    .filter((x) => x.score >= SNAPSHOT_TOPIC_MATCH_THRESHOLD)
    .sort((a, b) => b.v.views - a.v.views)
    .slice(0, topK)
    .map((x) => x.v);
}

export type RetrievalSource = "local" | "cache" | "live" | "fallback";

export type RetrievalResult = {
  topic: string;
  videos: ViralVideo[];
  matched: boolean;
  source: RetrievalSource;
  hashtags?: string[];
  inference?: InferredTopic;
};

export type RetrievalStage =
  | "topic_inference"
  | "local_lookup"
  | "cache_hit"
  | "live_research"
  | "ready"
  | "fallback";

export type RetrievalProgressEvent = {
  stage: RetrievalStage;
  message: string;
  data?: Record<string, unknown>;
};

export async function retrieveSimilarVideos(
  opts: {
    topic?: string;
    audience?: string;
    scene?: string;
    draft?: string;
    videoFeatures?: ReviewInputVideo["videoFeatures"];
    topK?: number;
    videoSignature?: VideoSignature;
  },
  onProgress?: (e: RetrievalProgressEvent) => void,
): Promise<RetrievalResult> {
  const { topK = 5, videoSignature } = opts;
  const userTopic = opts.topic?.trim() ?? "";
  const emit = (e: RetrievalProgressEvent) => {
    try {
      onProgress?.(e);
    } catch {
      /* ignore */
    }
  };

  const allVideos = await loadVideos();
  const libraryTopics = Array.from(new Set(allVideos.map((v) => v.topic)));

  // 1) LLM 强制题材推断（归一化或新题材识别）
  emit({
    stage: "topic_inference",
    message: opts.videoFeatures
      ? "AI 解析视频内容与用户描述，判断真实题材…"
      : "AI 解析用户描述，判断视频题材…",
  });

  let inference: InferredTopic;
  try {
    inference = await inferTopic({
      userTopic: opts.topic,
      audience: opts.audience,
      scene: opts.scene,
      draft: opts.draft,
      videoFeatures: opts.videoFeatures,
      libraryTopics,
    });
    emit({
      stage: "topic_inference",
      message: inference.isFromLibrary
        ? `AI 识别题材为「${inference.canonicalTopic}」（命中本地爆款库）`
        : `AI 识别题材为「${inference.canonicalTopic}」（库内未覆盖，将实时搜索 TikTok/Instagram）`,
      data: {
        canonicalTopic: inference.canonicalTopic,
        isFromLibrary: inference.isFromLibrary,
        reasoning: inference.reasoning,
      },
    });
  } catch (e) {
    console.error("[retrieval] topic inference failed:", e);
    // 兜底：用用户填的 topic；若用户也没填，走 fallback
    const fallback = userTopic || "通用";
    inference = {
      canonicalTopic: fallback,
      isFromLibrary:
        !!userTopic && allVideos.some((v) => v.topic === userTopic),
    };
    emit({
      stage: "topic_inference",
      message: `AI 推断失败，使用「${fallback}」继续检索`,
    });
  }

  const canonicalTopic = inference.canonicalTopic;

  // 2) 本地精确匹配（仅当 LLM 归一化到库内时尝试）
  if (inference.isFromLibrary) {
    const local = allVideos.filter((v) => v.topic === canonicalTopic);
    if (local.length > 0) {
      emit({
        stage: "local_lookup",
        message: `命中本地爆款库 ${local.length} 条同题材样本`,
      });
      return {
        topic: canonicalTopic,
        videos: pickFromTopicPool(local, videoSignature, topK),
        matched: true,
        source: "local",
        inference,
      };
    }
  }

  // 3) Blob 周缓存
  emit({
    stage: "cache_hit",
    message: `本周缓存中查找「${canonicalTopic}」爆款样本…`,
  });
  const cached = await readTopicCache(canonicalTopic);
  if (cached && cached.videos.length > 0) {
    emit({
      stage: "cache_hit",
      message: `命中本周缓存：${cached.videos.length} 条`,
      data: { week: cached.week, hashtags: cached.hashtags },
    });
    return {
      topic: canonicalTopic,
      videos: pickFromTopicPool(cached.videos, videoSignature, topK),
      matched: true,
      source: "cache",
      hashtags: cached.hashtags,
      inference,
    };
  }

  // 4) Cache miss → 实时搜索 TikTok + Instagram top 10（TT 5 + IG 5）
  emit({
    stage: "live_research",
    message: `缓存未命中，实时搜索 TikTok / Instagram「${canonicalTopic}」爆款…`,
  });
  try {
    const live = await researchTopicLive(canonicalTopic, (p: ResearchProgress) => {
      emit({
        stage: "live_research",
        message: p.message,
        data: p.data as Record<string, unknown> | undefined,
      });
    });

    if (live.videos.length > 0) {
      await writeTopicCache({
        topic: canonicalTopic,
        hashtags: live.hashtags,
        videos: live.videos,
      });
      return {
        topic: canonicalTopic,
        videos: pickFromTopicPool(live.videos, videoSignature, topK),
        matched: true,
        source: "live",
        hashtags: live.hashtags,
        inference,
      };
    }
  } catch (e) {
    console.error("[retrieval] live research failed:", e);
  }

  // 5) Fallback：跨题材通用爆款
  emit({
    stage: "fallback",
    message: "未能找到同题材样本，使用跨题材通用爆款 + 平台规律给出建议",
  });
  return {
    topic: canonicalTopic,
    videos: rankByEngagement(allVideos, topK),
    matched: false,
    source: "fallback",
    inference,
  };
}
