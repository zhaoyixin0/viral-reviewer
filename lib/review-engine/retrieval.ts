import "server-only";
import type { ViralVideo } from "./types";
import { loadVideos } from "@/lib/data/load-videos";
import {
  readTopicCache,
  writeTopicCache,
} from "@/lib/topic-cache/blob-cache";
import {
  researchTopicLive,
  type ResearchProgress,
} from "@/lib/research/topic-research";

const TOPIC_KEYWORDS: Record<string, string[]> = {
  早餐健身: ["健身", "早餐", "fitness", "breakfast", "蛋白", "protein", "增肌", "减脂"],
  变装秀: ["变装", "transition", "outfit", "glowup", "穿搭", "化妆", "makeup"],
  宠物日常: ["狗", "猫", "宠物", "dog", "cat", "pet", "puppy"],
  "旅行 vlog": ["旅行", "travel", "vlog", "东京", "巴黎", "纽约", "出差", "city walk"],
  料理教程: ["做饭", "料理", "cooking", "recipe", "菜谱", "tutorial", "厨房"],
  办公室搞笑: ["办公室", "office", "上班", "打工", "实习", "wfh", "周一"],
};

function detectTopic(input: string): string | null {
  const text = input.toLowerCase();
  let best: string | null = null;
  let bestScore = 0;
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const score = keywords.reduce(
      (s, kw) => s + (text.includes(kw.toLowerCase()) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return bestScore > 0 ? best : null;
}

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
};

export type RetrievalStage =
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

  emit({
    stage: "local_lookup",
    message: "在本地爆款库中检索同题材…",
  });

  const allVideos = await loadVideos();

  // 1) 本地精确匹配
  if (userTopic && allVideos.some((v) => v.topic === userTopic)) {
    return {
      topic: userTopic,
      videos: rankByEngagement(
        allVideos.filter((v) => v.topic === userTopic),
        topK,
      ),
      matched: true,
      source: "local",
    };
  }

  // 2) 用户没填题材时用关键词推断
  if (!userTopic) {
    const combined = [opts.audience, opts.scene, opts.draft]
      .filter(Boolean)
      .join(" ");
    const detected = detectTopic(combined);
    if (detected && allVideos.some((v) => v.topic === detected)) {
      return {
        topic: detected,
        videos: rankByEngagement(
          allVideos.filter((v) => v.topic === detected),
          topK,
        ),
        matched: true,
        source: "local",
      };
    }
  }

  // 3) 本地没有 → 用户给了明确题材，查 Blob 周缓存
  if (userTopic) {
    emit({
      stage: "cache_hit",
      message: `本周缓存中查找「${userTopic}」爆款样本…`,
    });
    const cached = await readTopicCache(userTopic);
    if (cached && cached.videos.length > 0) {
      emit({
        stage: "cache_hit",
        message: `命中本周缓存：${cached.videos.length} 条`,
        data: { week: cached.week, hashtags: cached.hashtags },
      });
      return {
        topic: userTopic,
        videos: rankByEngagement(cached.videos, topK),
        matched: true,
        source: "cache",
        hashtags: cached.hashtags,
      };
    }

    // 4) Cache miss → 实时搜索
    emit({
      stage: "live_research",
      message: `缓存未命中，实时搜索 TikTok / Instagram「${userTopic}」爆款…`,
    });
    try {
      const live = await researchTopicLive(userTopic, (p: ResearchProgress) => {
        emit({
          stage: "live_research",
          message: p.message,
          data: p.data as Record<string, unknown> | undefined,
        });
      });

      if (live.videos.length > 0) {
        await writeTopicCache({
          topic: userTopic,
          hashtags: live.hashtags,
          videos: live.videos,
        });
        return {
          topic: userTopic,
          videos: rankByEngagement(live.videos, topK),
          matched: true,
          source: "live",
          hashtags: live.hashtags,
        };
      }
    } catch (e) {
      console.error("[retrieval] live research failed:", e);
    }
  }

  // 5) Fallback：跨题材通用爆款
  emit({
    stage: "fallback",
    message: "未能找到同题材样本，使用跨题材通用爆款 + 平台规律给出建议",
  });
  return {
    topic: userTopic || "通用",
    videos: rankByEngagement(allVideos, topK),
    matched: false,
    source: "fallback",
  };
}
