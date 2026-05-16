import { NextRequest } from "next/server";
import { z } from "zod";
import { extractTemplateConcept } from "@/lib/template-review/extractor";
import { retrieveSimilarVideos } from "@/lib/review-engine/retrieval";
import { extractCommonalities } from "@/lib/review-engine/commonalities";
import { generateTemplateAuditWithLLM } from "@/lib/template-review/audit-llm";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "api/template-review" });
import {
  createRateLimiter,
  clientIp,
  rateLimitHeaders,
  ANON_AI_HEAVY,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

// P3 #3 phase 2: ANON_AI_HEAVY (10/10m sliding) —— Claude Opus template audit。
const RATE_LIMITER = createRateLimiter({
  identifier: "template-review",
  ...ANON_AI_HEAVY,
});

const Schema = z.object({
  effectName: z.string().min(1).max(200),
  playStyle: z.string().max(100).optional(),
  visualStyle: z.string().max(100).optional(),
  techStack: z.string().max(500).optional(),
  document: z.string().min(10).max(5000),
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

  const input = parsed.data;
  const encode = makeEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      try {
        // 1) 抽取结构化概念
        send({
          type: "stage",
          stage: "extract",
          message: "AI 解析脑暴文档（题材 / 玩法 / 视觉风格 / hashtags）…",
        });
        const concept = await extractTemplateConcept(input);
        send({
          type: "stage",
          stage: "extract",
          message: `识别到题材「${concept.topic}」 / 玩法「${concept.playStyle}」 / 视觉「${concept.visualStyle}」`,
          data: concept,
        });

        // 2) 检索同题材爆款（复用 v1 retrieval：本地→cache→实时）
        const { topic, videos: topicVideos } = await retrieveSimilarVideos(
          {
            topic: concept.topic,
            audience: "",
            scene: input.effectName,
            topK: 8,
          },
          (e) =>
            send({
              type: "stage",
              stage: e.stage,
              message: e.message,
              data: e.data,
            }),
        );

        // 3) 同玩法过滤（如果数据中有 playStyle 匹配，优先这些；否则用整体 top-K）
        const samePlayStyle = topicVideos.filter(
          (v) => v.playStyle === concept.playStyle,
        );
        const finalVideos =
          samePlayStyle.length >= 3 ? samePlayStyle : topicVideos;

        const commonalities = extractCommonalities(finalVideos, topic);

        // 4) Opus 7 维评审
        send({
          type: "stage",
          stage: "llm_review",
          message: `Claude Opus 4.7 评审中（含市场验证度，基于 ${finalVideos.length} 条同类爆款）…`,
        });

        const result = await generateTemplateAuditWithLLM({
          input,
          similarVideos: finalVideos,
          commonalities: {
            topic,
            playStyles: commonalities.playStyles,
            visualStyles: commonalities.visualStyles,
          },
        });

        send({
          type: "result",
          data: {
            modelId: `anthropic/${process.env.ANTHROPIC_MODEL || "claude-opus-4-7"}`,
            concept,
            retrieved: { topic, videos: finalVideos },
            result,
          },
        });
      } catch (e) {
        log.error("error", { err: e });
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
