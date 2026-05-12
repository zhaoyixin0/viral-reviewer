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
  },
  onProgress?: (e: RetrievalProgressEvent) => void,
): Promise<RetrievalResult> {
  const { topK = 5 } = opts;
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
        videos: rankByEngagement(local, topK),
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
      videos: rankByEngagement(cached.videos, topK),
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
        videos: rankByEngagement(live.videos, topK),
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
