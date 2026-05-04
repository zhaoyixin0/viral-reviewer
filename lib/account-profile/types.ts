export type Platform = "tiktok" | "instagram";

export type AccountComment = {
  text: string;
  likes: number;
  authorHandle?: string;
};

export type AccountVideo = {
  id: string;
  url: string;
  cover: string;
  title: string;
  plays: number;
  likes: number;
  commentsCount: number;
  duration: number;
  publishedAt: string;
  hashtags: string[];
  comments: AccountComment[];
  /** 临时下载 URL —— 拿到后必须立即用于抽帧，几小时内会过期 */
  videoDownloadUrl?: string;
};

export type ScrapeResult = {
  username: string;
  platform: Platform;
  topVideos: AccountVideo[];
  totalVideosFetched: number;
};

export type ScrapeProgress = {
  stage:
    | "profile_fetching"
    | "profile_done"
    | "comments_fetching"
    | "comments_done";
  message: string;
  data?: Record<string, unknown>;
};

export type ScrapeErrorKind =
  | "user_not_found"
  | "private_account"
  | "rate_limited"
  | "no_videos"
  | "apify_error";

export type ScrapeErrorDetail = {
  kind: ScrapeErrorKind;
  message: string;
  username?: string;
  platform?: Platform;
};

export class AccountScrapeException extends Error {
  readonly detail: ScrapeErrorDetail;
  constructor(detail: ScrapeErrorDetail) {
    super(detail.kind);
    this.detail = detail;
  }
}

// ===== 综合分析输出（Stage 2 写入；Stage 0 不产出，先占位） =====

export type AccountFrameInsight = {
  videoId: string;
  description: string;
  hookSeconds?: string;
  shotLanguage?: string;
  pacing?: string;
};

export type AccountProfile = {
  username: string;
  platform: Platform;
  /** 风格定位（一句话） */
  positioning: string;
  /** 爆款共性（前 0-3s 钩子 / 镜头语言 / 节奏） */
  viralPattern: {
    hookStyle: string;
    shotLanguage: string;
    pacing: string;
    visualSignature: string;
  };
  /** 粉丝偏好 5 个关键词 + 一句话 */
  audiencePreferences: {
    keywords: string[];
    summary: string;
  };
  /** 标签偏好 */
  hashtagPreferences: string[];
  /** 引用的 top videos */
  topVideos: Array<{
    id: string;
    url: string;
    cover: string;
    title: string;
    plays: number;
    likes: number;
  }>;
  /** 0-1，抽样数据丰富度 */
  confidence: number;
  /** 抽帧分析（仅 top 1 视频）— 如果失败则空 */
  frameInsights: AccountFrameInsight[];
  /** 缓存 metadata */
  fetchedAt: string;
  cacheKey: string;
};
