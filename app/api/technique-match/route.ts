import { NextRequest } from "next/server";
import { mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import { analyzeMaterialPotential } from "@/lib/video/analyze-potential";
import { loadReferenceCutPlans } from "@/lib/sample-references";
import { matchTechniques } from "@/lib/technique-matching/match-engine";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import {
  createUrlAllowlist,
  fetchWithAllowlist,
  UrlAllowlistError,
  VERCEL_BLOB_PRESET,
} from "@/lib/url-allowlist";
import {
  createRateLimiter,
  clientIp,
  rateLimitHeaders,
  STREAM_HEAVY,
} from "@/lib/rate-limit";
import { Schema } from "./schema";

export const runtime = "nodejs";
export const maxDuration = 300;

// P3 #3 phase 2: STREAM_HEAVY (3/10m fixed) —— NDJSON stream + multi-video
// Claude analyze + frame extract，单请求 20-60s。Inline check **stream 启动前**。
const RATE_LIMITER = createRateLimiter({
  identifier: "technique-match",
  ...STREAM_HEAVY,
});

type StreamEvent =
  | { type: "stage"; stage: string; message: string; data?: unknown }
  | { type: "partial"; phase: "potential"; data: unknown }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string };

function makeEncoder() {
  const enc = new TextEncoder();
  return (e: StreamEvent) => enc.encode(JSON.stringify(e) + "\n");
}

function modeOf(values: string[]): string {
  const counter = new Map<string, number>();
  for (const v of values) counter.set(v, (counter.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = -1;
  for (const [v, c] of counter) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
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

  const { videoUrls, topic, intent, videoId } = parsed.data;
  const totalMaterials = videoUrls.length;

  // P3 #3 phase 2: rate-limit inline check —— **必须**在 stream 启动前 + 在 SSRF
  // batch check 之前。两个 check 的失败 shape 都是 wrapper-equivalent Response，
  // 一旦 stream 启动就回不去（同 SSRF 设计语义）。
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

  // P3 #2 phase 2 + phase 3.5：SSRF allowlist + DNS rebinding batch check —— **必须**
  // 在 stream 启动前做（W3 phase 3.5 verdict 5357c41 §A2：all-or-nothing 语义,
  // 任一 deny → 整 batch 拒）。本路由返回 NDJSON stream，一旦 controller 开始 enqueue
  // 就 HTTP 200，无法再回 400。pre-stream batch checkAsync + in-stream fetchWithAllowlist
  // 双重防御：第一层防绝大多数攻击，第二层防 stream 启动后 DNS rebind 时间窗。
  const urlAllowlist = createUrlAllowlist(VERCEL_BLOB_PRESET);
  try {
    await Promise.all(
      videoUrls.map(async (url) => {
        const result = await urlAllowlist.checkAsync(url);
        if (!result.ok) {
          throw new UrlAllowlistError(result.reason, url, {
            resolvedIp: result.resolvedIp,
            cause: result.cause,
          });
        }
      }),
    );
  } catch (e) {
    if (e instanceof UrlAllowlistError) {
      if (e.reason === "dns_resolve_failed") {
        console.warn(
          `[url-allowlist] dns_resolve_failed url=${e.url} cause=${e.cause ?? "?"} route=technique-match`,
        );
        return new Response(
          JSON.stringify({
            error: "dns_resolve_failed",
            message: "无法解析 URL（DNS 解析失败），稍后重试",
          }),
          {
            status: 502,
            headers: {
              "content-type": "application/json",
              "Retry-After": "5",
            },
          },
        );
      }
      if (e.reason === "resolved_private_ip") {
        // SECURITY EVENT (W3 verdict §C): DNS rebinding 尝试。response 同 url_denied
        // 防 SSRF probe，server console.error 触发运维 alert。
        console.error(
          `[url-allowlist] resolved_private_ip url=${e.url} resolvedIp=${e.resolvedIp ?? "?"} route=technique-match`,
        );
      } else {
        console.warn(
          `[url-allowlist] denied url=${e.url} reason=${e.reason} route=technique-match`,
        );
      }
      return new Response(
        JSON.stringify({
          error: "url_denied",
          message: "提供的 URL 不在允许列表中",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    throw e;
  }

  const baseVideoId =
    videoId ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userVideoIds = videoUrls.map((_, i) =>
    totalMaterials === 1 ? baseVideoId : `${baseVideoId}-${i}`,
  );

  const encode = makeEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      let workDir: string | null = null;

      try {
        // ============ Stage 1: 并行下载 N 个视频 ============
        send({
          type: "stage",
          stage: "download",
          message: `下载 ${totalMaterials} 个视频到分析环境…`,
          data: { totalMaterials },
        });
        workDir = join(
          tmpdir(),
          `tm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        await mkdir(workDir, { recursive: true });
        const videoPaths = videoUrls.map((_, i) =>
          join(workDir as string, `input-${i}.mp4`),
        );
        await Promise.all(
          videoUrls.map(async (url, i) => {
            // Phase 3.5 (W3 verdict 5357c41 §B3): fetchWithAllowlist 在 stream
            // 内防 DNS rebind 时间窗（pre-stream check 与 in-stream fetch 之间
            // attacker 可能 rebind DNS）。UrlAllowlistError 会冒泡到 stream catch。
            const res = await fetchWithAllowlist(url, urlAllowlist);
            if (!res.ok) {
              throw new Error(
                `下载视频 ${i + 1}/${totalMaterials} 失败 (${res.status})`,
              );
            }
            const buf = Buffer.from(await res.arrayBuffer());
            await writeFile(videoPaths[i], buf);
          }),
        );

        // ============ Stage 2: 并行 ffprobe ============
        send({
          type: "stage",
          stage: "ffprobe",
          message: `提取 ${totalMaterials} 个视频元数据…`,
        });
        const metas = await Promise.all(
          videoPaths.map((p) => probeVideoMeta(p)),
        );
        send({
          type: "stage",
          stage: "ffprobe",
          message: `元数据完成: ${metas.map((m, i) => `素材 ${i + 1} ${m.durationSec.toFixed(1)}s/${m.fps}fps`).join("，")}`,
          data: {
            metas: metas.map((m) => ({
              durationSec: m.durationSec,
              fps: m.fps,
              width: m.width,
              height: m.height,
              codec: m.codec,
            })),
          },
        });

        // ============ Stage 3: 并行 Gemini MaterialPotential ============
        send({
          type: "stage",
          stage: "potential_stage1",
          message: `Gemini 2.5 Pro 并行解析 ${totalMaterials} 个素材…`,
          data: { totalMaterials },
        });

        type AnalyzeOutcome =
          | { ok: true; index: number; userPotential: MaterialPotential }
          | { ok: false; index: number; error: string };

        const analyzeResults: AnalyzeOutcome[] = await Promise.all(
          videoPaths.map((videoPath, i): Promise<AnalyzeOutcome> =>
            analyzeMaterialPotential({
              videoPath,
              videoId: userVideoIds[i],
              meta: metas[i],
              // 多视频路由：120s poll 上限让卡死视频快速 fail，避免拖累整批
              maxPollAttempts: 24,
              hints: {
                sourceUrl: videoUrls[i],
                userTopic: topic || undefined,
                userIntent: intent || undefined,
              },
            }).then(
              (userPotential): AnalyzeOutcome => {
                // 渐进披露：完成一个立刻 send partial，前端按 materialIndex 填位
                send({
                  type: "partial",
                  phase: "potential",
                  data: {
                    materialIndex: i,
                    totalMaterials,
                    userVideoId: userVideoIds[i],
                    userPotential,
                  },
                });
                return { ok: true, index: i, userPotential };
              },
              (err: Error): AnalyzeOutcome => {
                send({
                  type: "stage",
                  stage: "analyze_error",
                  message: `素材 ${i + 1}/${totalMaterials} 分析失败: ${err.message}`,
                  data: {
                    materialIndex: i,
                    userVideoId: userVideoIds[i],
                    error: err.message,
                  },
                });
                return { ok: false, index: i, error: err.message };
              },
            ),
          ),
        );

        // 按上传全集索引产出数组：成功 = MaterialPotential，失败 = null 占位（I6）
        const userPotentials: (MaterialPotential | null)[] = analyzeResults.map(
          (r) => (r.ok ? r.userPotential : null),
        );
        const failedVideoIndexes = analyzeResults
          .filter((r) => !r.ok)
          .map((r) => r.index);
        const successful = analyzeResults.flatMap((r) =>
          r.ok ? [{ index: r.index, userPotential: r.userPotential }] : [],
        );

        if (successful.length === 0) {
          throw new Error("全部素材分析失败，无法继续匹配");
        }

        send({
          type: "stage",
          stage: "potential_stage2",
          message: `素材分析完成: ${successful.length}/${totalMaterials} 成功${
            failedVideoIndexes.length > 0
              ? `（失败 index: ${failedVideoIndexes.join(", ")}）`
              : ""
          }`,
          data: {
            successCount: successful.length,
            failedVideoIndexes,
          },
        });

        // ============ Stage 4: 加载爆款 CutPlan 池 ============
        send({
          type: "stage",
          stage: "load_refs",
          message: "加载爆款 CutPlan 参考池…",
        });
        const primary = successful[0].userPotential;
        const userFormat = modeOf(
          successful.map((s) => s.userPotential.detectedFormat),
        );
        const { potentialsToDesiredTags } = await import(
          "@/lib/technique-index/similarity"
        );
        const desiredTechniques = potentialsToDesiredTags(
          successful.map((s) => ({
            pushInOpportunities:
              s.userPotential.potential.pushInOpportunities ?? [],
            matchCutCandidates:
              s.userPotential.potential.matchCutCandidates ?? [],
            sceneTransitionCandidates:
              s.userPotential.potential.sceneTransitionCandidates ?? [],
          })),
        );
        const refs = await loadReferenceCutPlans({
          userFormat,
          userTopic: topic || undefined,
          desiredTechniques,
          limit: 5,
          liveFallback: {
            draft: intent || undefined,
            videoFeatures: {
              duration: primary.base.durationSec,
              frameSamples: [],
              transcript: "",
              detectedHook:
                primary.base.dimensions.structure.hookFormat ?? "",
              detectedPlayStyle: primary.detectedFormat,
              detectedVisualStyle:
                primary.base.dimensions.audiovisual.colorGrade ?? "",
            },
          },
        });
        send({
          type: "stage",
          stage: "load_refs",
          message: `已加载 ${refs.cutPlans.length} 条爆款 (source=${refs.source}, userFormat=${userFormat})`,
          data: {
            count: refs.cutPlans.length,
            source: refs.source,
            notice: refs.notice,
            userFormat,
          },
        });

        // ============ Stage 5: Opus 匹配引擎 + N 视频编排 ============
        // Task 5：把 N 份 potential 一起喂给 Opus，让它产出 assemblyTimeline。
        // failedVideoIndexes 走 prompt 显式禁用，后端 sanitizeAssemblyTimeline
        // 再 drop 任何越界 / 引用失败 index 的 clip。
        send({
          type: "stage",
          stage: "match_engine",
          message: `Claude Opus 4.7 双向匹配 + 跨视频编排 (约 90-180s) …`,
          data: {
            successfulCount: successful.length,
            failedVideoIndexes,
          },
        });
        const matchResult = await matchTechniques({
          userPotentials,
          userVideoIds,
          failedVideoIndexes,
          referenceCutPlans: refs.cutPlans,
          userIntent: intent || undefined,
        });

        // ============ Stage 6: 结果 ============
        send({
          type: "result",
          data: {
            userVideoIds,
            userPotentials,
            failedVideoIndexes,
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
      ...rlHeaders,
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
