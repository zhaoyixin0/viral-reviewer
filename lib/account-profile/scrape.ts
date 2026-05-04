import "server-only";
import { getApifyClient } from "@/lib/apify/client";
import {
  AccountScrapeException,
  type AccountComment,
  type AccountVideo,
  type Platform,
  type ScrapeProgress,
  type ScrapeResult,
} from "./types";

const TOP_VIDEOS_DEFAULT = 3;
const COMMENTS_PER_VIDEO_DEFAULT = 10;
const PROFILE_FETCH_LIMIT = 30;

function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function safeNumber(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

// ===== TikTok =====

function normalizeTikTokVideo(raw: Record<string, unknown>): AccountVideo | null {
  const id = (raw.id ?? raw.videoId ?? raw.itemId) as string | undefined;
  const url =
    (raw.webVideoUrl ?? raw.shareUrl ?? raw.videoUrl ?? raw.url) as
      | string
      | undefined;
  if (!id || !url) return null;

  const videoMeta = (raw.videoMeta as Record<string, unknown>) ?? {};
  const stats = (raw.stats as Record<string, unknown>) ?? {};
  const tagsRaw = (raw.hashtags ?? []) as Array<Record<string, unknown> | string>;
  const tags = tagsRaw
    .map((t) => (typeof t === "string" ? t : safeString((t as Record<string, unknown>).name)))
    .filter(Boolean)
    .slice(0, 8);

  return {
    id: `tt-${id}`,
    url,
    cover:
      safeString(videoMeta.coverUrl) ||
      safeString(raw.coverUrl) ||
      safeString(raw.thumbnailUrl),
    title: safeString(raw.text ?? raw.desc ?? raw.title).slice(0, 200),
    plays: safeNumber(stats.playCount ?? raw.playCount ?? raw.views),
    likes: safeNumber(stats.diggCount ?? raw.diggCount ?? raw.likes),
    commentsCount: safeNumber(stats.commentCount ?? raw.commentCount),
    duration: Math.max(0, safeNumber(videoMeta.duration ?? raw.duration)),
    publishedAt:
      safeString(raw.createTimeISO) ||
      new Date().toISOString().slice(0, 10),
    hashtags: tags.map((t) => (t.startsWith("#") ? t : `#${t}`)),
    comments: [],
    videoDownloadUrl:
      safeString(videoMeta.downloadAddr) ||
      safeString(videoMeta.playAddr) ||
      undefined,
  };
}

function normalizeTikTokComment(
  raw: Record<string, unknown>,
): { videoUrl: string; comment: AccountComment } | null {
  const text = safeString(raw.text ?? raw.comment);
  if (!text) return null;
  const videoUrl =
    safeString(raw.videoWebUrl) ||
    safeString(raw.postUrl) ||
    safeString(raw.itemUrl);
  if (!videoUrl) return null;
  const handle = safeString(
    (raw.user as Record<string, unknown> | undefined)?.uniqueId ??
      raw.uniqueId ??
      raw.username,
  );
  return {
    videoUrl,
    comment: {
      text: text.slice(0, 300),
      likes: safeNumber(raw.diggCount ?? raw.likes ?? raw.likeCount),
      authorHandle: handle ? `@${handle.replace(/^@+/, "")}` : undefined,
    },
  };
}

async function fetchTikTokProfileVideos(username: string): Promise<AccountVideo[]> {
  const client = getApifyClient();
  let run;
  try {
    run = await client.actor("clockworks/tiktok-scraper").call({
      profiles: [username],
      resultsPerPage: PROFILE_FETCH_LIMIT,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    });
  } catch (e) {
    throw new AccountScrapeException({
      kind: "apify_error",
      platform: "tiktok",
      username,
      message: (e as Error).message,
    });
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const videos = (items as Record<string, unknown>[])
    .map(normalizeTikTokVideo)
    .filter((v): v is AccountVideo => v !== null);
  return videos;
}

async function fetchTikTokComments(
  videoUrls: string[],
  perVideo: number,
): Promise<Record<string, AccountComment[]>> {
  if (videoUrls.length === 0) return {};
  const client = getApifyClient();
  let run;
  try {
    run = await client.actor("clockworks/tiktok-comments-scraper").call({
      postURLs: videoUrls,
      commentsPerPost: perVideo,
    });
  } catch (e) {
    console.error("[account-scrape] tiktok comments failed:", e);
    return {};
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const grouped: Record<string, AccountComment[]> = {};
  for (const item of items as Record<string, unknown>[]) {
    const norm = normalizeTikTokComment(item);
    if (!norm) continue;
    if (!grouped[norm.videoUrl]) grouped[norm.videoUrl] = [];
    grouped[norm.videoUrl].push(norm.comment);
  }
  for (const url of Object.keys(grouped)) {
    grouped[url] = grouped[url]
      .sort((a, b) => b.likes - a.likes)
      .slice(0, perVideo);
  }
  return grouped;
}

// ===== Instagram =====

function normalizeInstagramVideo(raw: Record<string, unknown>): AccountVideo | null {
  const shortcode = (raw.shortCode ?? raw.shortcode ?? raw.code ?? raw.id) as
    | string
    | undefined;
  const explicitUrl = (raw.url ?? raw.permalink ?? raw.link) as string | undefined;
  const url =
    explicitUrl ??
    (shortcode ? `https://www.instagram.com/p/${shortcode}/` : undefined);
  if (!url) return null;
  const id = shortcode ?? url.split("/").filter(Boolean).pop() ?? `${Date.now()}`;

  const tagsRaw = (raw.hashtags ?? []) as Array<string | { name?: string }>;
  const tags = tagsRaw
    .map((t) => (typeof t === "string" ? t : t.name ?? ""))
    .filter(Boolean)
    .slice(0, 8);

  return {
    id: `ig-${id}`,
    url,
    cover:
      safeString(raw.displayUrl) ||
      safeString(raw.thumbnailUrl) ||
      safeString(raw.imageUrl),
    title: safeString(raw.caption ?? raw.title).slice(0, 200),
    plays: safeNumber(raw.videoPlayCount ?? raw.videoViewCount ?? raw.playsCount),
    likes: safeNumber(raw.likesCount ?? raw.likes),
    commentsCount: safeNumber(raw.commentsCount ?? raw.comments),
    duration: Math.max(0, safeNumber(raw.videoDuration ?? raw.duration)),
    publishedAt:
      safeString(raw.timestamp).slice(0, 10) ||
      new Date().toISOString().slice(0, 10),
    hashtags: tags.map((t) => (t.startsWith("#") ? t : `#${t}`)),
    comments: [],
    videoDownloadUrl: safeString(raw.videoUrl) || undefined,
  };
}

function normalizeInstagramComment(
  raw: Record<string, unknown>,
): { postUrl: string; comment: AccountComment } | null {
  const text = safeString(raw.text);
  if (!text) return null;
  const postUrl =
    safeString(raw.postUrl) ||
    safeString(raw.url) ||
    safeString(raw.parentPostUrl);
  if (!postUrl) return null;
  const handle = safeString(
    (raw.owner as Record<string, unknown> | undefined)?.username ??
      raw.ownerUsername ??
      raw.username,
  );
  return {
    postUrl,
    comment: {
      text: text.slice(0, 300),
      likes: safeNumber(raw.likesCount ?? raw.likes),
      authorHandle: handle ? `@${handle.replace(/^@+/, "")}` : undefined,
    },
  };
}

async function fetchInstagramProfileVideos(
  username: string,
): Promise<AccountVideo[]> {
  const client = getApifyClient();
  let run;
  try {
    run = await client.actor("apify/instagram-scraper").call({
      directUrls: [`https://www.instagram.com/${username}/`],
      resultsType: "posts",
      resultsLimit: PROFILE_FETCH_LIMIT,
      addParentData: false,
    });
  } catch (e) {
    throw new AccountScrapeException({
      kind: "apify_error",
      platform: "instagram",
      username,
      message: (e as Error).message,
    });
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return (items as Record<string, unknown>[])
    .filter((item) => {
      const t = item.type ?? item.productType;
      return t === "Video" || t === "clips" || !!item.videoUrl;
    })
    .map(normalizeInstagramVideo)
    .filter((v): v is AccountVideo => v !== null);
}

async function fetchInstagramComments(
  postUrls: string[],
  perPost: number,
): Promise<Record<string, AccountComment[]>> {
  if (postUrls.length === 0) return {};
  const client = getApifyClient();
  let run;
  try {
    run = await client.actor("apify/instagram-comment-scraper").call({
      directUrls: postUrls,
      resultsLimit: perPost * postUrls.length,
    });
  } catch (e) {
    console.error("[account-scrape] instagram comments failed:", e);
    return {};
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const grouped: Record<string, AccountComment[]> = {};
  for (const item of items as Record<string, unknown>[]) {
    const norm = normalizeInstagramComment(item);
    if (!norm) continue;
    if (!grouped[norm.postUrl]) grouped[norm.postUrl] = [];
    grouped[norm.postUrl].push(norm.comment);
  }
  for (const url of Object.keys(grouped)) {
    grouped[url] = grouped[url]
      .sort((a, b) => b.likes - a.likes)
      .slice(0, perPost);
  }
  return grouped;
}

// ===== 统一入口 =====

export async function scrapeAccountProfile(
  platform: Platform,
  rawUsername: string,
  options?: {
    topVideosCount?: number;
    commentsPerVideo?: number;
  },
  onProgress?: (e: ScrapeProgress) => void,
): Promise<ScrapeResult> {
  const username = normalizeUsername(rawUsername);
  if (!username) {
    throw new AccountScrapeException({
      kind: "user_not_found",
      username: rawUsername,
      message: "username is empty after normalization",
    });
  }
  const topN = options?.topVideosCount ?? TOP_VIDEOS_DEFAULT;
  const cpv = options?.commentsPerVideo ?? COMMENTS_PER_VIDEO_DEFAULT;

  const emit = (e: ScrapeProgress) => {
    try {
      onProgress?.(e);
    } catch {
      /* ignore */
    }
  };

  emit({
    stage: "profile_fetching",
    message: `从 ${platform} 抓取 @${username} 最近 ${PROFILE_FETCH_LIMIT} 条作品…`,
  });

  const allVideos =
    platform === "tiktok"
      ? await fetchTikTokProfileVideos(username)
      : await fetchInstagramProfileVideos(username);

  if (allVideos.length === 0) {
    throw new AccountScrapeException({
      kind: "no_videos",
      platform,
      username,
      message: `no videos found for @${username} on ${platform}`,
    });
  }

  const topVideos = [...allVideos]
    .sort((a, b) => b.plays - a.plays || b.likes - a.likes)
    .slice(0, topN);

  emit({
    stage: "profile_done",
    message: `已选 top ${topVideos.length} 视频（按播放量）`,
    data: {
      total: allVideos.length,
      top: topVideos.map((v) => ({ url: v.url, plays: v.plays })),
    },
  });

  emit({
    stage: "comments_fetching",
    message: `抓取 ${topVideos.length} 条视频各 top ${cpv} 评论…`,
  });

  const commentMap =
    platform === "tiktok"
      ? await fetchTikTokComments(
          topVideos.map((v) => v.url),
          cpv,
        )
      : await fetchInstagramComments(
          topVideos.map((v) => v.url),
          cpv,
        );

  const enriched = topVideos.map((v) => ({
    ...v,
    comments: commentMap[v.url] ?? [],
  }));

  const totalComments = enriched.reduce((sum, v) => sum + v.comments.length, 0);

  emit({
    stage: "comments_done",
    message: `共抓到 ${totalComments} 条评论`,
    data: { totalComments },
  });

  return {
    username,
    platform,
    topVideos: enriched,
    totalVideosFetched: allVideos.length,
  };
}
