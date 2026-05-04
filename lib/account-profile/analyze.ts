import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AccountFrameInsight,
  AccountProfile,
  Platform,
  ScrapeResult,
} from "./types";

const ANALYZE_SYSTEM_PROMPT = `你是 TikTok / Instagram Reels 创作者画像分析师。
基于该创作者 top 3 爆款视频的元数据 + 评论 + 可选抽帧分析，输出一份简洁、可立即被另一个评审 LLM 引用的画像。

## 输出 JSON（不要 markdown 包裹）

{
  "positioning": "一句话定位（如：以城市探店切入的美食 vlogger，强情绪铺垫风格）",
  "viralPattern": {
    "hookStyle": "前 0-3s 的钩子规律（如：永远以食物特写或人物吃惊表情开场）",
    "shotLanguage": "镜头语言风格（如：手持 + 大量特写切换，少用稳定器）",
    "pacing": "节奏风格（如：快剪 + 字幕节拍同步 BGM 鼓点）",
    "visualSignature": "视觉签名（色调 / 构图 / 主体，如：高饱和暖色 + 中心构图 + 食物为主体）"
  },
  "audiencePreferences": {
    "keywords": ["5 个粉丝评论高频出现的关键词，反映粉丝最在意的点"],
    "summary": "粉丝喜欢的点 60 字内（基于评论文本归纳）"
  },
  "hashtagPreferences": ["该创作者最常用的 5-8 个 hashtag（带 # 前缀）"],
  "confidence": 0.0-1.0
}

## 写作原则

- positioning 必须是定位 + 风格组合（"什么人 + 怎么做"），禁止泛泛的"美食博主"
- viralPattern 要从具体的视频共性归纳出来，禁止套话
- audiencePreferences.keywords 必须是真实评论里出现过的词，不能凭空编造
- 评论数据少 / 抽帧分析为空时降低 confidence；评论 < 5 条 confidence 不超过 0.5
- 所有字段简体中文，简洁有力（每段 ≤ 80 字）`;

type ParsedAnalysis = {
  positioning?: string;
  viralPattern?: {
    hookStyle?: string;
    shotLanguage?: string;
    pacing?: string;
    visualSignature?: string;
  };
  audiencePreferences?: {
    keywords?: string[];
    summary?: string;
  };
  hashtagPreferences?: string[];
  confidence?: number;
};

function buildAnalyzePayload(
  scrape: ScrapeResult,
  frameInsights: AccountFrameInsight[],
): string {
  const insightById = new Map(frameInsights.map((i) => [i.videoId, i]));

  const videos = scrape.topVideos.map((v) => {
    const insight = insightById.get(v.id);
    return {
      id: v.id,
      url: v.url,
      title: v.title,
      plays: v.plays,
      likes: v.likes,
      duration: v.duration,
      hashtags: v.hashtags,
      frameInsight: insight
        ? {
            description: insight.description,
            hookSeconds: insight.hookSeconds,
            shotLanguage: insight.shotLanguage,
            pacing: insight.pacing,
          }
        : null,
      topComments: v.comments
        .slice(0, 10)
        .map((c) => ({ text: c.text, likes: c.likes })),
    };
  });

  const totalComments = scrape.topVideos.reduce(
    (sum, v) => sum + v.comments.length,
    0,
  );
  const framesAvailable = frameInsights.length > 0;

  return JSON.stringify(
    {
      account: {
        username: scrape.username,
        platform: scrape.platform,
        totalVideosFetched: scrape.totalVideosFetched,
      },
      meta: {
        totalCommentsCollected: totalComments,
        frameAnalysisAvailable: framesAvailable,
      },
      videos,
    },
    null,
    2,
  );
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
}

function clamp01(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

function pickStringArray(x: unknown, max: number): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

export async function analyzeAccountProfile(args: {
  scrape: ScrapeResult;
  frameInsights: AccountFrameInsight[];
  cacheKey: string;
}): Promise<AccountProfile> {
  const { scrape, frameInsights, cacheKey } = args;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const payload = buildAnalyzePayload(scrape, frameInsights);
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_HAIKU_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: ANALYZE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: payload }],
  });

  const block = response.content[0];
  const text = block?.type === "text" ? block.text : "";
  let parsed: ParsedAnalysis;
  try {
    parsed = JSON.parse(stripCodeFence(text)) as ParsedAnalysis;
  } catch (e) {
    throw new Error(`account analyze JSON parse failed: ${(e as Error).message}`);
  }

  return {
    username: scrape.username,
    platform: scrape.platform as Platform,
    positioning: parsed.positioning ?? "",
    viralPattern: {
      hookStyle: parsed.viralPattern?.hookStyle ?? "",
      shotLanguage: parsed.viralPattern?.shotLanguage ?? "",
      pacing: parsed.viralPattern?.pacing ?? "",
      visualSignature: parsed.viralPattern?.visualSignature ?? "",
    },
    audiencePreferences: {
      keywords: pickStringArray(parsed.audiencePreferences?.keywords, 5),
      summary: parsed.audiencePreferences?.summary ?? "",
    },
    hashtagPreferences: pickStringArray(parsed.hashtagPreferences, 8),
    topVideos: scrape.topVideos.map((v) => ({
      id: v.id,
      url: v.url,
      cover: v.cover,
      title: v.title,
      plays: v.plays,
      likes: v.likes,
    })),
    confidence: clamp01(parsed.confidence),
    frameInsights,
    fetchedAt: new Date().toISOString(),
    cacheKey,
  };
}
