import { NextRequest } from "next/server";
import { z } from "zod";
import { scrapeAccountProfile } from "@/lib/account-profile/scrape";
import { analyzeAccountTopVideo } from "@/lib/account-profile/frame-analyze";
import { analyzeAccountProfile } from "@/lib/account-profile/analyze";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "api/account-profile" });
import {
  createUrlAllowlist,
  TIKTOK_INSTAGRAM_CDN_PRESET,
} from "@/lib/url-allowlist";
import {
  createRateLimiter,
  clientIp,
  rateLimitHeaders,
  STREAM_HEAVY,
} from "@/lib/rate-limit";
import {
  buildAccountCacheKey,
  readAccountProfileCache,
  writeAccountProfileCache,
} from "@/lib/account-profile/cache";
import {
  AccountScrapeException,
  type AccountFrameInsight,
  type AccountProfile,
  type Platform,
} from "@/lib/account-profile/types";

export const runtime = "nodejs";

// P3 #3 phase 2: STREAM_HEAVY (3/10m fixed) —— NDJSON stream + Apify scrape +
// Claude analyze + frame extract，单请求 30-60s 长占用。
// Inline check（**stream 启动前**）—— 一旦 controller.enqueue 开始，HTTP 200
// 已 commit，无法再回 429。参考 P3 #2 phase 2 SSRF 同模式（f59080f）。
const RATE_LIMITER = createRateLimiter({
  identifier: "account-profile",
  ...STREAM_HEAVY,
});

const Schema = z.object({
  platform: z.enum(["tiktok", "instagram"]),
  username: z.string().min(1).max(80),
  forceRefresh: z.boolean().optional().default(false),
});

type StreamEvent =
  | { type: "stage"; stage: string; message: string; data?: unknown }
  | { type: "result"; data: unknown }
  | { type: "error"; code: string; message: string };

function makeEncoder() {
  const enc = new TextEncoder();
  return (event: StreamEvent) => enc.encode(JSON.stringify(event) + "\n");
}

export async function POST(req: NextRequest) {
  if (!process.env.APIFY_TOKEN) {
    return new Response(JSON.stringify({ error: "apify_not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "anthropic_key_missing" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "invalid_input",
        details: parsed.error.format(),
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  // P3 #3 phase 2: rate-limit inline check —— 必须在 stream 启动前。
  // W3 verdict §D：失败响应 shape 与 wrapper (lib/rate-limit/middleware.ts:24)
  // 完全一致，方便客户端统一 429 handling。
  const rlResult = await RATE_LIMITER.check(clientIp(req));
  const rlHeaders = rateLimitHeaders(rlResult);
  if (!rlResult.success) {
    return new Response(
      JSON.stringify({ error: "rate_limited", limit: rlResult.limit }),
      {
        status: 429,
        headers: { ...rlHeaders, "content-type": "application/json" },
      },
    );
  }

  const { platform, username, forceRefresh } = parsed.data;
  const encode = makeEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      try {
        if (!forceRefresh) {
          send({
            stage: "cache_lookup",
            type: "stage",
            message: "查询缓存（本周已抓取过的画像）…",
          });
          const cached = await readAccountProfileCache(
            platform as Platform,
            username,
          );
          if (cached) {
            send({
              type: "stage",
              stage: "cache_hit",
              message: `命中缓存：${cached.fetchedAt.slice(0, 10)} 抓取`,
            });
            send({
              type: "result",
              data: { profile: cached, source: "cache" },
            });
            controller.close();
            return;
          }
        }

        const scrape = await scrapeAccountProfile(
          platform as Platform,
          username,
          { topVideosCount: 3, commentsPerVideo: 10 },
          (e) =>
            send({
              type: "stage",
              stage: e.stage,
              message: e.message,
              data: e.data,
            }),
        );

        send({
          type: "stage",
          stage: "frame_analysis",
          message: "下载 top 1 视频抽帧分析镜头语言（失败将降级为只用封面）…",
        });

        const frameInsights: AccountFrameInsight[] = [];
        const top1 = scrape.topVideos[0];
        if (top1?.videoDownloadUrl) {
          // P3 #2 phase 2.5：用 TIKTOK_INSTAGRAM_CDN_PRESET（不是 GCS_PRESET）
          // —— top1.videoDownloadUrl 来自 Apify scrape，host 是 TT/IG 媒体 CDN
          // (`*.tiktokcdn.com` / `*.tiktokcdn-us.com` / `*.tiktokcdn-eu.com` /
          // `*.cdninstagram.com` / `*.fbcdn.net`)。phase 2 误用 GCS_PRESET
          // 导致 100% host_denied 静默退化，本 commit 修复。frame-analyze 内部 try/catch
          // 把 UrlAllowlistError 当 fail-soft 返回 null（与"网络失败 / URL 过期"同义）。
          const urlAllowlist = createUrlAllowlist(TIKTOK_INSTAGRAM_CDN_PRESET);
          const insight = await analyzeAccountTopVideo(
            top1.videoDownloadUrl,
            top1.id,
            { urlAllowlist },
          );
          if (insight) frameInsights.push(insight);
        }

        send({
          type: "stage",
          stage: "frame_analysis_done",
          message:
            frameInsights.length > 0
              ? "抽帧分析成功"
              : "抽帧失败 / 视频不可下载，仅基于封面 + 标题 + 评论分析",
        });

        send({
          type: "stage",
          stage: "synthesis",
          message: "Haiku 4.5 综合 cover + 评论 + 抽帧产出画像…",
        });

        const cacheKey = buildAccountCacheKey(platform as Platform, username);
        const profile: AccountProfile = await analyzeAccountProfile({
          scrape,
          frameInsights,
          cacheKey,
        });

        send({
          type: "stage",
          stage: "cache_write",
          message: "缓存画像（7 天有效）…",
        });
        await writeAccountProfileCache(profile);

        send({
          type: "result",
          data: { profile, source: "fresh" },
        });
      } catch (e) {
        if (e instanceof AccountScrapeException) {
          send({
            type: "error",
            code: e.detail.kind,
            message: e.detail.message,
          });
        } else {
          log.error("error", { err: e });
          send({ type: "error", code: "internal", message: (e as Error).message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...rlHeaders,
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
