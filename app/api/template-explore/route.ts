import { NextRequest } from "next/server";
import { z } from "zod";
import { loadVideos } from "@/lib/data/load-videos";
import { generateExploreWithLLM } from "@/lib/template-review/explore-llm";
import {
  createRateLimiter,
  clientIp,
  rateLimitHeaders,
  ANON_AI_HEAVY,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

// P3 #3 phase 2: ANON_AI_HEAVY (10/10m sliding) —— Claude Opus explore。
const RATE_LIMITER = createRateLimiter({
  identifier: "template-explore",
  ...ANON_AI_HEAVY,
});

const Schema = z.object({
  topic: z.string().max(100).optional(),
  playStyle: z.string().max(100).optional(),
  platform: z.enum(["tiktok", "instagram"]).optional(),
  context: z.string().max(500).optional(),
});

type StreamEvent =
  | { type: "stage"; stage: string; message: string; data?: unknown }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string };

function makeEncoder() {
  const enc = new TextEncoder();
  return (event: StreamEvent) => enc.encode(JSON.stringify(event) + "\n");
}

export async function POST(req: NextRequest) {
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
      JSON.stringify({ error: "invalid_input", details: parsed.error.format() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  // P3 #3 phase 2: rate-limit inline check — stream 启动前。
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

  const filter = parsed.data;
  const encode = makeEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      try {
        send({
          type: "stage",
          stage: "load_corpus",
          message: "加载本周富化爆款库…",
        });
        const videos = await loadVideos();

        send({
          type: "stage",
          stage: "aggregate",
          message: `聚合 ${videos.length} 条数据，按题材 / 玩法 / 视觉风格切片…`,
          data: { totalVideos: videos.length },
        });

        send({
          type: "stage",
          stage: "llm_explore",
          message: `Claude Opus 4.7 分析大盘 + 生成方向推荐（数据驱动 + 趋势推断）…`,
        });

        const result = await generateExploreWithLLM({ filter, videos });

        send({
          type: "result",
          data: {
            modelId: `anthropic/${process.env.ANTHROPIC_MODEL || "claude-opus-4-7"}`,
            filter,
            corpusSize: videos.length,
            result,
          },
        });
      } catch (e) {
        console.error("[template-explore] error:", e);
        send({ type: "error", message: (e as Error).message });
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
