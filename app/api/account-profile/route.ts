import { NextRequest } from "next/server";
import { z } from "zod";
import { scrapeAccountProfile } from "@/lib/account-profile/scrape";
import { analyzeAccountTopVideo } from "@/lib/account-profile/frame-analyze";
import { analyzeAccountProfile } from "@/lib/account-profile/analyze";
import { createUrlAllowlist, VERCEL_BLOB_PRESET } from "@/lib/url-allowlist";
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
export const maxDuration = 300;

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
          // P3 #2 phase 2: SSRF allowlist for downstream extractFramesAndAudio
          // frame-analyze 内部 try/catch 已把 UrlAllowlistError 当 fail-soft 返回 null
          // （旧 TikTok URL 过期等同义），不需要 route 层显式 400
          const urlAllowlist = createUrlAllowlist(VERCEL_BLOB_PRESET);
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
          console.error("[account-profile] error:", e);
          send({ type: "error", code: "internal", message: (e as Error).message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
