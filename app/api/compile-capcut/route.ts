import { NextRequest } from "next/server";
import { put } from "@vercel/blob";
import { z } from "zod";
import {
  prepareAssets,
  readAsset,
  cleanupAssets,
  probeBgmDurationSec,
} from "@/lib/capcut-compiler/assets";
import { buildDraftContent } from "@/lib/capcut-compiler/build";
import { packageDraftAsZip } from "@/lib/capcut-compiler/package";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import { MaterialPotentialSchema } from "@/lib/cut-plan/material-potential";
import { TechniqueMatchingResultSchema } from "@/lib/technique-matching/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.object({
  projectName: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[^\\/:*?"<>|]+$/, "项目名包含非法字符"),
  videoUrl: z.string().url(),
  /** Phase 5.5：可选 BGM 文件 URL（Vercel Blob 上传后的 URL） */
  bgmUrl: z.string().url().nullable().optional(),
  userPotential: z.unknown(),
  match: z.unknown(),
});

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

  const { projectName, videoUrl, bgmUrl } = parsed.data;

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
    // 1) 下载视频 + (可选) BGM
    const assets = await prepareAssets(videoUrl, bgmUrl ?? undefined);
    workDir = assets.workDir;

    // 2) ffprobe 视频元数据
    const meta = await probeVideoMeta(assets.videoPath);

    // 3) BGM 时长（如有）
    let bgmDurationSec: number | undefined;
    if (assets.bgmPath) {
      try {
        bgmDurationSec = await probeBgmDurationSec(assets.bgmPath);
      } catch (e) {
        console.warn("[compile-capcut] bgm probe failed:", (e as Error).message);
        bgmDurationSec = meta.durationSec; // 兜底用视频时长
      }
    }

    // 4) 构造 CapCut JSON
    const { draftContent, metaInfo } = buildDraftContent({
      projectName,
      videoFileName: "input.mp4",
      bgmFileName: assets.bgmPath ? "bgm.mp3" : undefined,
      bgmDurationSec,
      meta,
      potential: potentialParsed.data,
      match: matchParsed.data,
    });

    // 5) 读素材 buffer
    const videoBuffer = await readAsset(assets.videoPath);
    const bgmBuffer = assets.bgmPath
      ? await readAsset(assets.bgmPath)
      : undefined;

    // 6) 打 zip
    const zipBytes = await packageDraftAsZip({
      projectName,
      draftContent,
      metaInfo,
      videoBuffer,
      videoFileName: "input.mp4",
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
    console.error("[compile-capcut] error:", e);
    return new Response(
      JSON.stringify({
        error: "compile_failed",
        message: (e as Error).message,
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  } finally {
    if (workDir) await cleanupAssets(workDir);
  }
}
