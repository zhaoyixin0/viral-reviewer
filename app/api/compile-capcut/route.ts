import { NextRequest } from "next/server";
import { put } from "@/lib/storage";
import {
  prepareAssets,
  readAsset,
  cleanupAssets,
  probeBgmDurationSec,
} from "@/lib/capcut-compiler/assets";
import {
  createUrlAllowlist,
  VERCEL_BLOB_PRESET,
  UrlAllowlistError,
} from "@/lib/url-allowlist";
import {
  createRateLimiter,
  withRateLimit,
  clientIp,
  WRITE_HEAVY,
} from "@/lib/rate-limit";
import {
  buildDraftContent,
  dedupeFileNames,
  sanitizeVideoFileName,
} from "@/lib/capcut-compiler/build";
import { packageDraftAsZip } from "@/lib/capcut-compiler/package";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import { MaterialPotentialSchema } from "@/lib/cut-plan/material-potential";
import { TechniqueMatchingResultSchema } from "@/lib/technique-matching/types";
import { RequestSchema } from "./schema";

export const runtime = "nodejs";
export const maxDuration = 120;

// P3 #3 phase 2: WRITE_HEAVY (5/10m fixed) —— ffmpeg 抽帧 + zip 打包 + Blob 写。
const RATE_LIMITER = createRateLimiter({
  identifier: "compile-capcut",
  ...WRITE_HEAVY,
});

async function impl(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "invalid_input",
        details: parsed.error.format(),
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const { projectName, bgmUrl, videoUrls } = parsed.data;
  const rawFileNames = parsed.data.videoFileNames ?? videoUrls.map(() => undefined);
  // sanitize 各自清洗 → dedupe 让重名加 -1/-2 后缀。三处必须用同一份数组：
  // draft_content.json 的 materials.videos[i].path、draft_meta_info.json 的
  // draft_materials[0].value[i].file_Path、zip 内 materials/<name>。
  const videoFileNames = dedupeFileNames(
    rawFileNames.map((n) => sanitizeVideoFileName(n)),
  );

  const potentialParsed = MaterialPotentialSchema.safeParse(
    parsed.data.userPotential,
  );
  const matchParsed = TechniqueMatchingResultSchema.safeParse(parsed.data.match);
  if (!potentialParsed.success || !matchParsed.success) {
    return new Response(
      JSON.stringify({
        error: "invalid_nested_schema",
        potentialError: potentialParsed.success
          ? null
          : potentialParsed.error.format(),
        matchError: matchParsed.success ? null : matchParsed.error.format(),
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  let workDir: string | null = null;
  // P3 #2 phase 2：SSRF allowlist —— `prepareAssets` 入口 batch check 全部 URL
  // （videoUrls + optional bgmUrl），任一 deny → 抛 UrlAllowlistError 走 400。
  const urlAllowlist = createUrlAllowlist(VERCEL_BLOB_PRESET);
  try {
    // 1) 下载视频 (N 个并发) + (可选) BGM
    const assets = await prepareAssets(videoUrls, bgmUrl ?? undefined, {
      urlAllowlist,
    });
    workDir = assets.workDir;

    // 2) ffprobe 视频元数据 — 并发探测，得到 metas 与 videoPaths 同序数组。
    //    Task 9 起 build.ts 接入 metas[] / videoFileNames[] 完整数组。
    const metas = await Promise.all(
      assets.videoPaths.map((p) => probeVideoMeta(p)),
    );
    const primaryMeta = metas[0];

    // 3) BGM 时长（如有）
    let bgmDurationSec: number | undefined;
    if (assets.bgmPath) {
      try {
        bgmDurationSec = await probeBgmDurationSec(assets.bgmPath);
      } catch (e) {
        console.warn("[compile-capcut] bgm probe failed:", (e as Error).message);
        bgmDurationSec = primaryMeta.durationSec; // 兜底用主视频时长
      }
    }

    // 4) 构造 CapCut JSON — 整组 metas/videoFileNames 全量 forward。
    const { draftContent, metaInfo } = buildDraftContent({
      projectName,
      videoFileNames,
      bgmFileName: assets.bgmPath ? "bgm.mp3" : undefined,
      bgmDurationSec,
      metas,
      potential: potentialParsed.data,
      match: matchParsed.data,
    });

    // 5) 并发读 N 个视频 buffer + (可选) BGM buffer
    const videoBuffers = await Promise.all(
      assets.videoPaths.map((p) => readAsset(p)),
    );
    const bgmBuffer = assets.bgmPath
      ? await readAsset(assets.bgmPath)
      : undefined;

    // 6) 打 zip — N 段视频按 videoFileNames 顺序进 materials/
    const zipBytes = await packageDraftAsZip({
      projectName,
      draftContent,
      metaInfo,
      videos: videoBuffers.map((buffer, i) => ({
        buffer,
        fileName: videoFileNames[i]!,
      })),
      bgmBuffer,
      bgmFileName: bgmBuffer ? "bgm.mp3" : undefined,
    });

    const safeName = projectName.replace(/[^\w\-\.]+/g, "-");

    // 不能把 zip 直接作为 response body 返回 — Vercel function response
    // 上限 4.5MB，含 mp4 的 zip 必然超限。改成写 Blob + 返回 downloadUrl
    // 让客户端从 CDN 直接下载（没 size limit）。
    // addRandomSuffix:true — 同毫秒内同名项目并发 export 会撞 key，随机后缀消除覆盖风险。
    try {
      const blob = await put(
        `capcut-exports/${safeName}-${Date.now()}.zip`,
        Buffer.from(zipBytes),
        {
          access: "public",
          contentType: "application/zip",
          addRandomSuffix: true,
        },
      );
      // downloadUrl 自带 Content-Disposition: attachment，保证浏览器下载而非预览。
      return Response.json({
        url: blob.downloadUrl,
        filename: `${safeName}.zip`,
        sizeBytes: zipBytes.byteLength,
      });
    } catch (e) {
      console.error("[compile-capcut] blob upload failed:", e);
      return new Response(
        JSON.stringify({
          error: "blob_upload_failed",
          message: "zip 上传到存储失败，请重试",
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
  } catch (e) {
    // P3 #2 phase 2 + phase 3.5 (W3 verdict 5357c41 §C mapping):
    // - sync deny → 400 url_denied + console.warn (response 不暴露 reason 防 probe)
    // - dns_resolve_failed → 502 + Retry-After: 5 (transient, caller 可重试)
    // - resolved_private_ip → 400 url_denied + console.error (security event, ops alert)
    if (e instanceof UrlAllowlistError) {
      if (e.reason === "dns_resolve_failed") {
        console.warn(
          `[url-allowlist] dns_resolve_failed url=${e.url} cause=${e.cause ?? "?"} route=compile-capcut`,
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
        console.error(
          `[url-allowlist] resolved_private_ip url=${e.url} resolvedIp=${e.resolvedIp ?? "?"} route=compile-capcut`,
        );
      } else {
        console.warn(
          `[url-allowlist] denied url=${e.url} reason=${e.reason} route=compile-capcut`,
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
    // 详情只进日志，不回客户端 —— 避免泄露文件系统路径 / 内部服务名
    console.error("[compile-capcut] error:", e);
    return new Response(
      JSON.stringify({
        error: "compile_failed",
        message: "编译失败，请稍后重试",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  } finally {
    if (workDir) await cleanupAssets(workDir);
  }
}

export const POST = withRateLimit(RATE_LIMITER, clientIp, impl);
