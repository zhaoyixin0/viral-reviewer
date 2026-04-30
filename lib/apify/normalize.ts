import type { ViralVideo } from "@/lib/review-engine/types";

/**
 * 把 Apify TikTok scraper 返回的 raw item 归一化为 ViralVideo。
 *
 * 输入字段名来自 clockworks/tiktok-scraper actor schema。
 * 不同 actor 字段名略有差异，会做容错。
 */
export function normalizeTikTokItem(
  raw: Record<string, unknown>,
  topic: string,
): ViralVideo | null {
  const id = (raw.id ?? raw.videoId ?? raw.itemId) as string | undefined;
  const url =
    (raw.webVideoUrl ?? raw.shareUrl ?? raw.videoUrl ?? raw.url) as
      | string
      | undefined;
  if (!id || !url) return null;

  const title = (raw.text ?? raw.desc ?? raw.title ?? "") as string;
  const cover = (raw.videoMeta as Record<string, unknown> | undefined)?.coverUrl ??
    raw.coverUrl ??
    raw.thumbnailUrl ??
    "";
  const author = (raw.authorMeta as Record<string, unknown> | undefined) ?? raw.author ?? {};
  const handle = (typeof author === "object" && author !== null && "name" in author
    ? (author as Record<string, unknown>).name
    : "") as string;

  const stats = (raw.stats as Record<string, unknown>) ?? {};
  const views = Number(stats.playCount ?? raw.playCount ?? raw.views ?? 0);
  const likes = Number(stats.diggCount ?? raw.diggCount ?? raw.likes ?? 0);
  const comments = Number(stats.commentCount ?? raw.commentCount ?? 0);
  const shares = Number(stats.shareCount ?? raw.shareCount ?? 0);
  const duration = Number(
    (raw.videoMeta as Record<string, unknown> | undefined)?.duration ??
      raw.duration ??
      0,
  );
  const tagsRaw = (raw.hashtags ?? []) as Array<Record<string, unknown> | string>;
  const tags = tagsRaw.map((t) =>
    typeof t === "string" ? t : ((t.name ?? "") as string),
  );

  const music = (raw.musicMeta as Record<string, unknown> | undefined) ?? {};
  const bgm =
    (music.musicName as string) ??
    (raw.musicName as string) ??
    "Original sound";

  return {
    id: `tt-${id}`,
    platform: "tiktok",
    url: url as string,
    cover: cover as string,
    title: title.slice(0, 100),
    description: title,
    topic,
    tags: tags.filter(Boolean).map((t) => `#${t}`).slice(0, 6),
    views,
    likes,
    comments,
    shares,
    duration: Math.max(duration, 0),
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "需要 LLM 二次提取",
    bgm,
    authorHandle: handle ? `@${handle.replace(/^@+/, "")}` : "@unknown",
    publishedAt:
      typeof raw.createTimeISO === "string"
        ? raw.createTimeISO
        : new Date().toISOString().slice(0, 10),
  };
}

/**
 * Instagram scraper item -> ViralVideo
 * 输入字段来自 apify/instagram-scraper / apify/instagram-reel-scraper
 */
export function normalizeInstagramItem(
  raw: Record<string, unknown>,
  topic: string,
): ViralVideo | null {
  // hashtag-scraper 返回的字段不固定 — 多种 fallback
  const shortcode = (raw.shortCode ?? raw.shortcode ?? raw.code ?? raw.id) as
    | string
    | undefined;
  const explicitUrl = (raw.url ?? raw.permalink ?? raw.link) as string | undefined;
  const url =
    explicitUrl ??
    (shortcode ? `https://www.instagram.com/p/${shortcode}/` : undefined);
  if (!url) return null;

  const idKey = shortcode ?? url.split("/").filter(Boolean).pop() ?? `${Date.now()}`;

  const title = (raw.caption ?? raw.title ?? raw.text ?? "") as string;
  const cover = (raw.displayUrl ??
    raw.thumbnailUrl ??
    raw.imageUrl ??
    raw.thumbnailSrc ??
    "") as string;
  const handle = (raw.ownerUsername ??
    raw.username ??
    (raw.owner as { username?: string } | undefined)?.username ??
    "unknown") as string;

  const views = Number(
    raw.videoViewCount ??
      raw.videoPlayCount ??
      raw.views ??
      raw.playsCount ??
      0,
  );
  const likes = Number(
    raw.likesCount ??
      raw.likes ??
      (raw.edge_liked_by as { count?: number } | undefined)?.count ??
      0,
  );
  const comments = Number(
    raw.commentsCount ??
      raw.comments ??
      (raw.edge_media_to_comment as { count?: number } | undefined)?.count ??
      0,
  );
  const duration = Number(raw.videoDuration ?? raw.duration ?? 0);
  const tagsRaw = (raw.hashtags ?? []) as Array<string | { name?: string }>;
  const tags = tagsRaw
    .map((t) => (typeof t === "string" ? t : t.name ?? ""))
    .filter(Boolean)
    .slice(0, 6)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));

  return {
    id: `ig-${idKey}`,
    platform: "instagram",
    url,
    cover,
    title: title.slice(0, 100),
    description: title,
    topic,
    tags,
    views,
    likes,
    comments,
    shares: 0,
    duration: Math.max(duration, 0),
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "需要 LLM 二次提取",
    bgm:
      (raw.musicInfo as { song_name?: string } | undefined)?.song_name ??
      "Original audio",
    authorHandle: `@${handle.replace(/^@+/, "")}`,
    publishedAt:
      typeof raw.timestamp === "string"
        ? raw.timestamp.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
  };
}
