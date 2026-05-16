import { NextRequest } from "next/server";
import { z } from "zod";
import { retrieveSimilarVideos } from "@/lib/review-engine/retrieval";
import {
  generateBrainstormSingle,
  generateCompareSummary,
  detectDiversityWarning,
} from "@/lib/template-review/brainstorm-llm";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "api/template-brainstorm" });
import type {
  BrainstormInput,
  BrainstormResult,
} from "@/lib/template-review/types";
import type { DivergenceMethodId } from "@/lib/template-review/divergence-methods";
import {
  createRateLimiter,
  clientIp,
  rateLimitHeaders,
  ANON_AI_HEAVY,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

// P3 #3 phase 2: ANON_AI_HEAVY (10/10m sliding) —— Claude Opus brainstorm。
// Inline check（stream 启动前），与 technique-match / account-profile 同模式。
const RATE_LIMITER = createRateLimiter({
  identifier: "template-brainstorm",
  ...ANON_AI_HEAVY,
});

const METHOD_IDS = [
  "scamper",
  "first_principles",
  "inversion",
  "cross_domain",
  "extreme",
  "metaphor",
  "constraint_removal",
] as const;

const MethodSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("single"),
    methodId: z.enum(METHOD_IDS),
  }),
  z.object({
    mode: z.literal("compare"),
    methodA: z.enum(METHOD_IDS),
    methodB: z.enum(METHOD_IDS),
  }),
]);

const Schema = z.object({
  capabilities: z.array(z.string()).max(20).optional().default([]),
  playbookTypes: z
    .array(z.enum(["A", "B", "C"]))
    .min(1)
    .max(3)
    .optional()
    .default(["A"]),
  goals: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        weight: z.number().min(0).max(1).optional(),
      }),
    )
    .max(8)
    .optional()
    .default([]),
  scene: z.string().min(1).max(200),
  userProblem: z.string().max(500).optional().default(""),
  briefSummary: z.string().max(3000).optional().default(""),
  method: MethodSchema,
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
    return new Response(JSON.stringify({ error: "anthropic_key_missing" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
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

  const input = parsed.data as BrainstormInput;
  const encode = makeEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      try {
        send({
          type: "stage",
          stage: "retrieval",
          message: `检索同场景真实爆款数据（scene="${input.scene}"）…`,
        });

        const retrieved = await retrieveSimilarVideos(
          {
            topic: undefined,
            audience: input.userProblem,
            scene: input.scene,
            draft: input.briefSummary || undefined,
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

        send({
          type: "stage",
          stage: "retrieval_done",
          message: `已注入 ${retrieved.videos.length} 条爆款样本（topic=${retrieved.topic}, source=${retrieved.source}）`,
        });

        const result = await runBrainstorm({
          input,
          viralVideos: retrieved.videos,
          topicMatched: retrieved.matched,
          send,
        });

        send({
          type: "result",
          data: {
            modelId: `anthropic/${process.env.ANTHROPIC_MODEL || "claude-opus-4-7"}`,
            retrieved: {
              topic: retrieved.topic,
              source: retrieved.source,
              matched: retrieved.matched,
            },
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

async function runBrainstorm(args: {
  input: BrainstormInput;
  viralVideos: import("@/lib/review-engine/types").ViralVideo[];
  topicMatched: boolean;
  send: (e: StreamEvent) => void;
}): Promise<BrainstormResult> {
  const { input, viralVideos, topicMatched, send } = args;
  const method = input.method;

  if (method.mode === "single") {
    send({
      type: "stage",
      stage: "generate",
      message: `Opus 4.7 用「${methodName(method.methodId)}」发散中…`,
    });
    const out = await generateBrainstormSingle({
      input,
      methodId: method.methodId,
      viralVideos,
      topicMatched,
    });
    const diversityWarning = detectDiversityWarning(out.ideas);
    return {
      mode: "single",
      methodId: method.methodId,
      ideas: out.ideas,
      ruleCheck: out.ruleCheck,
      diversityWarning,
      referenceVideos: viralVideos,
    };
  }

  send({
    type: "stage",
    stage: "generate",
    message: `Opus 4.7 并发跑「${methodName(method.methodA)}」+「${methodName(method.methodB)}」对比…`,
  });
  const [outA, outB] = await Promise.all([
    generateBrainstormSingle({
      input,
      methodId: method.methodA,
      viralVideos,
      topicMatched,
    }),
    generateBrainstormSingle({
      input,
      methodId: method.methodB,
      viralVideos,
      topicMatched,
    }),
  ]);

  send({
    type: "stage",
    stage: "compare_summary",
    message: "Haiku 4.5 写气质差异总结 + 推荐方向…",
  });
  const compare = await generateCompareSummary({
    input,
    ideasA: outA.ideas,
    ideasB: outB.ideas,
    methodAId: method.methodA,
    methodBId: method.methodB,
  });

  const diversityWarning = detectDiversityWarning([
    ...outA.ideas,
    ...outB.ideas,
  ]);

  return {
    mode: "compare",
    methodA: {
      id: method.methodA,
      ideas: outA.ideas,
      ruleCheck: outA.ruleCheck,
    },
    methodB: {
      id: method.methodB,
      ideas: outB.ideas,
      ruleCheck: outB.ruleCheck,
    },
    compareSummary: compare.summary,
    recommendedMethod: compare.recommended,
    diversityWarning,
    referenceVideos: viralVideos,
  };
}

function methodName(id: DivergenceMethodId): string {
  const map: Record<DivergenceMethodId, string> = {
    scamper: "SCAMPER",
    first_principles: "第一性原理",
    inversion: "逆向思维",
    cross_domain: "跨域类比",
    extreme: "极限情境",
    metaphor: "隐喻类比",
    constraint_removal: "消除约束",
  };
  return map[id];
}
