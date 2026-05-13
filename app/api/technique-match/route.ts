import { NextRequest } from "next/server";
import { z } from "zod";
import { mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import { analyzeMaterialPotential } from "@/lib/video/analyze-potential";
import { loadReferenceCutPlans } from "@/lib/sample-references";
import { matchTechniques } from "@/lib/technique-matching/match-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

const Schema = z.object({
  videoUrl: z.string().url(),
  topic: z.string().max(200).optional().default(""),
  intent: z.string().max(500).optional().default(""),
  videoId: z.string().max(120).optional(),
});

type StreamEvent =
  | { type: "stage"; stage: string; message: string; data?: unknown }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string };

function makeEncoder() {
  const enc = new TextEncoder();
  return (e: StreamEvent) => enc.encode(JSON.stringify(e) + "\n");
}

export async function POST(req: NextRequest) {
  if (!process.env.GOOGLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "google_api_key_missing" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
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
      JSON.stringify({ error: "invalid_input", details: parsed.error.format() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const { videoUrl, topic, intent, videoId } = parsed.data;
  const finalVideoId =
    videoId ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const encode = makeEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      let workDir: string | null = null;

      try {
        // ============ Stage 1: 下载视频 ============
        send({
          type: "stage",
          stage: "download",
          message: "下载视频到分析环境…",
        });
        workDir = join(tmpdir(), `tm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        await mkdir(workDir, { recursive: true });
        const videoPath = join(workDir, "input.mp4");
        const res = await fetch(videoUrl);
        if (!res.ok) {
          throw new Error(`下载视频失败 (${res.status})`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(videoPath, buf);

        // ============ Stage 2: ffprobe ============
        send({
          type: "stage",
          stage: "ffprobe",
          message: "提取视频元数据 (fps / 分辨率 / 编码) …",
        });
        const meta = await probeVideoMeta(videoPath);
        send({
          type: "stage",
          stage: "ffprobe",
          message: `元数据: ${meta.durationSec.toFixed(1)}s · ${meta.fps}fps · ${meta.width}x${meta.height} · ${meta.codec}`,
          data: meta,
        });

        // ============ Stage 3: Gemini MaterialPotential ============
        send({
          type: "stage",
          stage: "potential_stage1",
          message: "Gemini 2.5 Pro 解析视频客观结构 (CutPlan)…",
        });
        const userPotential = await analyzeMaterialPotential({
          videoPath,
          videoId: finalVideoId,
          meta,
          hints: {
            sourceUrl: videoUrl,
            userTopic: topic || undefined,
            userIntent: intent || undefined,
          },
        });
        send({
          type: "stage",
          stage: "potential_stage2",
          message: `素材分析完成: ${userPotential.detectedFormat} · ${userPotential.potential.cutPoints.length} 切点 · ${userPotential.potential.metaphorHooks.length} 隐喻钩子`,
          data: {
            detectedFormat: userPotential.detectedFormat,
            cutPointsCount: userPotential.potential.cutPoints.length,
            metaphorHooksCount: userPotential.potential.metaphorHooks.length,
          },
        });

        // ============ Stage 4: 加载爆款 CutPlan 池 ============
        send({
          type: "stage",
          stage: "load_refs",
          message: "加载爆款 CutPlan 参考池…",
        });
        const { potentialToDesiredTags } = await import("@/lib/technique-index/similarity");
        const desiredTechniques = potentialToDesiredTags({
          pushInOpportunities: userPotential.potential.pushInOpportunities ?? [],
          matchCutCandidates: userPotential.potential.matchCutCandidates ?? [],
          sceneTransitionCandidates:
            userPotential.potential.sceneTransitionCandidates ?? [],
        });
        const refs = await loadReferenceCutPlans({
          userFormat: userPotential.detectedFormat,
          userTopic: topic || undefined,
          desiredTechniques,
          limit: 5,
          // P3: 本地池不够时启用实时抓取兜底
          liveFallback: {
            draft: intent || undefined,
            videoFeatures: {
              duration: userPotential.base.durationSec,
              frameSamples: [],
              transcript: "",
              detectedHook:
                userPotential.base.dimensions.structure.hookFormat ?? "",
              detectedPlayStyle: userPotential.detectedFormat,
              detectedVisualStyle:
                userPotential.base.dimensions.audiovisual.colorGrade ?? "",
            },
          },
        });
        send({
          type: "stage",
          stage: "load_refs",
          message: `已加载 ${refs.cutPlans.length} 条爆款 (source=${refs.source})`,
          data: {
            count: refs.cutPlans.length,
            source: refs.source,
            notice: refs.notice,
          },
        });

        // ============ Stage 5: Opus 匹配引擎 ============
        send({
          type: "stage",
          stage: "match_engine",
          message: `Claude Opus 4.7 双向匹配推理 (约 90-120s) …`,
        });
        const matchResult = await matchTechniques({
          userPotential,
          referenceCutPlans: refs.cutPlans,
          userIntent: intent || undefined,
        });

        // ============ Stage 6: 结果 ============
        send({
          type: "result",
          data: {
            userVideoId: finalVideoId,
            userPotential,
            referenceSource: refs.source,
            referenceNotice: refs.notice,
            match: matchResult,
          },
        });
      } catch (e) {
        console.error("[technique-match] error:", e);
        send({ type: "error", message: (e as Error).message });
      } finally {
        if (workDir) {
          try {
            await rm(workDir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
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
