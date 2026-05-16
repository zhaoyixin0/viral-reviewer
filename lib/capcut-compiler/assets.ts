import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  fetchWithAllowlist,
  UrlAllowlistError,
  type UrlAllowlist,
} from "@/lib/url-allowlist";
import { createLogger } from "@/lib/observability/structured-log";

const log = createLogger({ module: "capcut-compiler/assets" });

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic?.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

export type AssetWorkspace = {
  workDir: string;
  /** Task 7 起：N 个用户视频的本地路径，对应 videoUrls 同序。
   *  路径形如 `${workDir}/input-${i}.mp4`，i 从 0 开始；旧单视频路径 input.mp4 不再使用。 */
  videoPaths: string[];
  /** Phase 5.5：用户上传的 BGM 文件路径（可选） */
  bgmPath?: string;
};

type DownloadFailure = { index: number; status: number | "fetch_error"; message: string };

/**
 * 下载 N 个用户视频 + 可选下载 BGM 文件。
 *
 * 行为：
 *   - **SSRF + DNS rebinding 防御（P3 #2 phase 2 + phase 3.5 · 2026-05-15）**：
 *     - 函数入口 `Promise.all(urls.map(checkAsync))` all-or-nothing batch check
 *       （W3 phase 3.5 verdict 5357c41 §A2 approved）：任一 URL deny → 抛
 *       `UrlAllowlistError`，所有下载都不发起
 *     - 实际下载用 `fetchWithAllowlist`（undici Pool with resolved-IP + SNI），
 *       防御 DNS rebinding（fetch 二次 resolve 漂移到内网）
 *   - 视频并发下载到 `input-${i}.mp4`，BGM 与视频组并行
 *   - 任一视频或 BGM 失败 → 抛错并标注失败 index，避免 partial 状态进入下游 build
 *     （编译每段都要齐才能产出 zip）
 *   - 单个失败原因 log.error 带 index，主错误也带 index 列表
 *
 * 调用方用完必须调 cleanupAssets。
 *
 * @param videoUrls 待下载视频 URL 数组（>=1）
 * @param bgmUrl    可选 BGM URL
 * @param opts.urlAllowlist  **必填**——SSRF allowlist 实例（W3 phase 2 verdict A
 *   "required-param tightening"：TS 编译期强制 caller 传 allowlist，杜绝漏防御）
 */
export async function prepareAssets(
  videoUrls: string[],
  bgmUrl: string | undefined,
  opts: { urlAllowlist: UrlAllowlist },
): Promise<AssetWorkspace> {
  if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
    throw new Error("prepareAssets: videoUrls must be a non-empty array");
  }

  // SSRF + DNS rebinding 防御：函数入口 batch checkAsync，all-or-nothing 语义（任一
  // deny → 整个 batch 拒，不允许 partial 进 download stage）。Promise.all 短路 → 第
  // 一个 deny URL 即抛错。
  const urlsToCheck = bgmUrl ? [...videoUrls, bgmUrl] : videoUrls;
  await Promise.all(
    urlsToCheck.map(async (url) => {
      const result = await opts.urlAllowlist.checkAsync(url);
      if (!result.ok) {
        throw new UrlAllowlistError(result.reason, url, {
          resolvedIp: result.resolvedIp,
          cause: result.cause,
        });
      }
    }),
  );

  const id = `capcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workDir = join(tmpdir(), id);
  await mkdir(workDir, { recursive: true });

  const videoPaths = videoUrls.map((_, i) => join(workDir, `input-${i}.mp4`));

  const downloadVideo = async (url: string, i: number): Promise<void> => {
    // P3 #2 phase 3.5: use fetchWithAllowlist (undici Pool with resolved-IP
    // pinning + SNI) instead of plain fetch — defends against DNS rebinding
    // between checkAsync above and the actual download here.
    const res = await fetchWithAllowlist(url, opts.urlAllowlist);
    if (!res.ok) {
      throw Object.assign(
        new Error(`Failed to download video #${i}: ${res.status}`),
        { __index: i, __status: res.status },
      );
    }
    await writeFile(videoPaths[i], Buffer.from(await res.arrayBuffer()));
  };

  const videoSettled = await Promise.allSettled(
    videoUrls.map((url, i) => downloadVideo(url, i)),
  );

  // P3 #2 phase 3.5: DNS rebinding between pre-batch checkAsync and download
  // surfaces as UrlAllowlistError inside fetchWithAllowlist. Propagate security
  // events immediately—do NOT bundle with regular download failure stats（防
  // SSRF security event 被 swallow 进 download stats）。
  const ssrfRejection = videoSettled.find(
    (r): r is PromiseRejectedResult =>
      r.status === "rejected" && r.reason instanceof UrlAllowlistError,
  );
  if (ssrfRejection) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw ssrfRejection.reason;
  }

  const videoFailures: DownloadFailure[] = [];
  videoSettled.forEach((r, i) => {
    if (r.status === "rejected") {
      const reason = r.reason as Error & { __status?: number };
      const status = typeof reason?.__status === "number" ? reason.__status : "fetch_error";
      const message = reason?.message ?? String(reason);
      // structured-log reserves the top-level `message` field; use `failureReason`
      // so the per-failure detail (e.g. "ECONNRESET", "404") is preserved in JSON.
      log.error("video download failed", { index: i, status, failureReason: message });
      videoFailures.push({ index: i, status, message });
    }
  });

  if (videoFailures.length > 0) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    const idxList = videoFailures.map((f) => `#${f.index}`).join(", ");
    throw new Error(
      `Failed to download videos: ${idxList} (${videoFailures.length}/${videoUrls.length})`,
    );
  }

  let bgmPath: string | undefined;
  if (bgmUrl) {
    bgmPath = join(workDir, "bgm.mp3");
    try {
      // P3 #2 phase 3.5: fetchWithAllowlist same DNS rebinding defense as videos
      const res = await fetchWithAllowlist(bgmUrl, opts.urlAllowlist);
      if (!res.ok) {
        throw new Error(`Failed to download BGM: ${res.status}`);
      }
      await writeFile(bgmPath, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      log.error("bgm download failed", { err: e });
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`Failed to download BGM: ${msg}`);
    }
  }

  return { workDir, videoPaths, bgmPath };
}

export async function readAsset(path: string): Promise<Buffer> {
  return readFile(path);
}

export async function probeBgmDurationSec(bgmPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(bgmPath, (err, data) => {
      if (err) return reject(err);
      const d = data.format?.duration ?? 0;
      resolve(typeof d === "number" ? d : Number(d) || 0);
    });
  });
}

export async function cleanupAssets(workDir: string): Promise<void> {
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
