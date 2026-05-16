import "server-only";
import { put, head } from "@/lib/storage";
import type { ViralVideo } from "@/lib/review-engine/types";
import { getIsoWeek } from "@/lib/utils/iso-week";

const CACHE_PREFIX = "topic-cache";

function topicSlug(topic: string): string {
  return encodeURIComponent(
    topic
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .slice(0, 80),
  );
}

function cacheKey(topic: string): string {
  return `${CACHE_PREFIX}/${topicSlug(topic)}-${getIsoWeek()}.json`;
}

export type TopicCacheEntry = {
  topic: string;
  hashtags: string[];
  videos: ViralVideo[];
  cachedAt: string;
  week: string;
};

export async function readTopicCache(
  topic: string,
): Promise<TopicCacheEntry | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const key = cacheKey(topic);
  try {
    const meta = await head(key);
    if (!meta?.url) return null;
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as TopicCacheEntry;
  } catch {
    return null;
  }
}

export async function writeTopicCache(args: {
  topic: string;
  hashtags: string[];
  videos: ViralVideo[];
}): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const entry: TopicCacheEntry = {
    topic: args.topic,
    hashtags: args.hashtags,
    videos: args.videos,
    cachedAt: new Date().toISOString(),
    week: getIsoWeek(),
  };
  try {
    await put(cacheKey(args.topic), JSON.stringify(entry), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (e) {
    console.error("[topic-cache] write failed:", (e as Error).message);
  }
}
