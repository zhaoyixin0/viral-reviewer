import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

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
 *   - 视频并发下载到 `input-${i}.mp4`，BGM 与视频组并行
 *   - 任一视频或 BGM 失败 → 抛错并标注失败 index，避免 partial 状态进入下游 build
 *     （编译每段都要齐才能产出 zip）
 *   - 单个失败原因写 console.error 带 index，主错误也带 index 列表
 *
 * 调用方用完必须调 cleanupAssets。
 */
export async function prepareAssets(
  videoUrls: string[],
  bgmUrl?: string,
): Promise<AssetWorkspace> {
  if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
    throw new Error("prepareAssets: videoUrls must be a non-empty array");
  }

  const id = `capcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workDir = join(tmpdir(), id);
  await mkdir(workDir, { recursive: true });

  const videoPaths = videoUrls.map((_, i) => join(workDir, `input-${i}.mp4`));

  const downloadVideo = async (url: string, i: number): Promise<void> => {
    const res = await fetch(url);
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

  const videoFailures: DownloadFailure[] = [];
  videoSettled.forEach((r, i) => {
    if (r.status === "rejected") {
      const reason = r.reason as Error & { __status?: number };
      const status = typeof reason?.__status === "number" ? reason.__status : "fetch_error";
      const message = reason?.message ?? String(reason);
      console.error(`[capcut-compiler/assets] video #${i} download failed (${status}): ${message}`);
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
      const res = await fetch(bgmUrl);
      if (!res.ok) {
        throw new Error(`Failed to download BGM: ${res.status}`);
      }
      await writeFile(bgmPath, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error(`[capcut-compiler/assets] bgm download failed: ${msg}`);
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
