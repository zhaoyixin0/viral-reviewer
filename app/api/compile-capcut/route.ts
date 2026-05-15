import { NextRequest } from "next/server";
import { put } from "@vercel/blob";
import {
  prepareAssets,
  readAsset,
  cleanupAssets,
  probeBgmDurationSec,
} from "@/lib/capcut-compiler/assets";
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

export async function POST(req: NextRequest) {
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

  const { projectName, bgmUrl } = parsed.data;
  // Zod preprocess (schema.ts C1 兼容层) 保证 videoUrls / videoFileNames 在校验
  // 通过后必然存在；这里非空断言只为收紧类型，运行期不会触发。
  const videoUrls = parsed.data.videoUrls!;
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
  try {
    // 1) 下载视频 (N 个并发) + (可选) BGM
    const assets = await prepareAssets(videoUrls, bgmUrl ?? undefined);
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
