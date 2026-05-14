import { NextRequest } from "next/server";
import { put } from "@vercel/blob";
import { z } from "zod";
import {
  prepareAssets,
  readAsset,
  cleanupAssets,
  probeBgmDurationSec,
} from "@/lib/capcut-compiler/assets";
import {
  buildDraftContent,
  sanitizeVideoFileName,
} from "@/lib/capcut-compiler/build";
import { packageDraftAsZip } from "@/lib/capcut-compiler/package";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import { MaterialPotentialSchema } from "@/lib/cut-plan/material-potential";
import { TechniqueMatchingResultSchema } from "@/lib/technique-matching/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_VIDEOS = 6;

const videoFileNameField = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^/\\]+$/, "视频文件名不能包含路径分隔符");

const InputSchema = z.object({
  projectName: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[^\\/:*?"<>|]+$/, "项目名包含非法字符"),
  videoUrl: z.string().url(),
  /** 多视频改造：新增 optional 数组字段，旧客户端不发也不影响 */
  videoUrls: z.array(z.string().url()).min(1).max(MAX_VIDEOS).optional(),
  /** 用户上传的原始视频文件名（可选；缺失则退化为 input.mp4）。
   *  regex 在 Zod 层就拒绝路径分隔符，让服务端校验边界自身成立，
   *  不单点依赖 sanitizeVideoFileName。浏览器 File.name 永远是 basename，
   *  合法请求不含分隔符，不受影响。 */
  videoFileName: videoFileNameField.optional(),
  /** 多视频改造：与 videoUrls 对齐的文件名数组，optional */
  videoFileNames: z.array(videoFileNameField).max(MAX_VIDEOS).optional(),
  /** Phase 5.5：可选 BGM 文件 URL（Vercel Blob 上传后的 URL） */
  bgmUrl: z.string().url().nullable().optional(),
  userPotential: z.unknown(),
  match: z.unknown(),
});

/**
 * C1 兼容层：videoUrl ⇄ videoUrls、videoFileName ⇄ videoFileNames 双向归一。
 * preprocess 在校验前补全缺失的一侧 —— 旧客户端只发单值、新客户端发数组，
 * 两种请求体都能通过校验。`videoUrl` 保持必填（preprocess 已保证它对任何
 * 合法输入都被填上），现有运行逻辑无需改动。
 */
export const RequestSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const next: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(next.videoUrls) && next.videoUrls.length > 0) {
    if (next.videoUrl === undefined) next.videoUrl = next.videoUrls[0];
  } else if (typeof next.videoUrl === "string") {
    if (next.videoUrls === undefined) next.videoUrls = [next.videoUrl];
  }
  if (Array.isArray(next.videoFileNames) && next.videoFileNames.length > 0) {
    if (next.videoFileName === undefined) next.videoFileName = next.videoFileNames[0];
  } else if (typeof next.videoFileName === "string") {
    if (next.videoFileNames === undefined) next.videoFileNames = [next.videoFileName];
  }
  return next;
}, InputSchema).refine(
  (d) =>
    !d.videoUrls ||
    !d.videoFileNames ||
    d.videoUrls.length === d.videoFileNames.length,
  {
    // 跨字段不变量：两个数组都给时必须等长，否则下游按 index 取文件名会越界。
    message: "videoFileNames 长度必须与 videoUrls 一致",
    path: ["videoFileNames"],
  },
);

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
  const videoFileName = sanitizeVideoFileName(parsed.data.videoFileName);

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
      videoFileName,
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
      videoFileName,
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
