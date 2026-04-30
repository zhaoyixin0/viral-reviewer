import { NextRequest } from "next/server";
import { z } from "zod";
import { retrieveSimilarVideos } from "@/lib/review-engine/retrieval";
import { extractCommonalities } from "@/lib/review-engine/commonalities";
import { buildMockReview } from "@/lib/review-engine/mock";
import {
  generateReviewWithLLM,
  selectModel,
} from "@/lib/review-engine/llm";
import type { ReviewInput } from "@/lib/review-engine/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const TextInputSchema = z.object({
  type: z.literal("text"),
  topic: z.string().min(1).max(200),
  audience: z.string().max(200).optional().default(""),
  scene: z.string().max(200).optional().default(""),
  draft: z.string().max(4000).optional(),
});

const VideoInputSchema = z.object({
  type: z.literal("video"),
  topic: z.string().min(1).max(200),
  audience: z.string().max(200).optional().default(""),
  scene: z.string().max(200).optional().default(""),
  videoFeatures: z.object({
    duration: z.number(),
    frameSamples: z.array(
      z.object({ timestamp: z.number(), description: z.string() }),
    ),
    transcript: z.string(),
    detectedHook: z.string(),
    detectedPlayStyle: z.string(),
    detectedVisualStyle: z.string(),
  }),
});

const RequestSchema = z.union([TextInputSchema, VideoInputSchema]);

type StreamEvent =
  | { type: "stage"; stage: string; message: string; data?: unknown }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string };

function makeEncoder() {
  const enc = new TextEncoder();
  return (event: StreamEvent) => enc.encode(JSON.stringify(event) + "\n");
}

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "invalid_input", details: parsed.error.format() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const input = parsed.data as ReviewInput;
  const encode = makeEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      try {
        const { topic, videos, matched, source, hashtags } =
          await retrieveSimilarVideos(
            {
              topic: input.topic,
              audience: input.audience,
              scene: input.scene,
              draft: input.type === "text" ? input.draft : undefined,
              topK: 5,
            },
            (e) =>
              send({
                type: "stage",
                stage: e.stage,
                message: e.message,
                data: e.data,
              }),
          );

        const formula = extractCommonalities(videos, topic);
        const selection = selectModel();

        send({
          type: "stage",
          stage: "llm_review",
          message: selection
            ? `${selection.provider}/${selection.modelId} 评审中（reasoning model 通常 80-120s）…`
            : "无可用 LLM key，使用规则引擎兜底",
        });

        let result;
        let mode: "llm" | "mock" = "mock";
        let modelId: string | undefined;

        if (selection) {
          try {
            result = await generateReviewWithLLM({
              input,
              videos,
              formula,
              matched,
              selection,
            });
            mode = "llm";
            modelId = `${selection.provider}/${selection.modelId}`;
          } catch (e) {
            console.error("[review] LLM failed, falling back to mock:", e);
            result = buildMockReview(input, formula);
          }
        } else {
          result = buildMockReview(input, formula);
        }

        send({
          type: "result",
          data: {
            mode,
            modelId,
            retrieved: { topic, videos, matched, source, hashtags },
            result,
          },
        });
      } catch (e) {
        console.error("[review] error:", e);
        send({ type: "error", message: (e as Error).message });
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
