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
  videoPath: string;
  /** Phase 5.5：用户上传的 BGM 文件路径（可选） */
  bgmPath?: string;
};

/**
 * 下载用户视频 + 可选下载 BGM 文件。
 * 调用方用完必须调 cleanupAssets。
 */
export async function prepareAssets(
  videoUrl: string,
  bgmUrl?: string,
): Promise<AssetWorkspace> {
  const id = `capcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workDir = join(tmpdir(), id);
  await mkdir(workDir, { recursive: true });

  // 1) 下载用户视频
  const videoPath = join(workDir, "input.mp4");
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) {
    throw new Error(`Failed to download video: ${videoRes.status}`);
  }
  await writeFile(videoPath, Buffer.from(await videoRes.arrayBuffer()));

  // 2) 可选下载用户上传的 BGM
  let bgmPath: string | undefined;
  if (bgmUrl) {
    bgmPath = join(workDir, "bgm.mp3");
    const bgmRes = await fetch(bgmUrl);
    if (!bgmRes.ok) {
      throw new Error(`Failed to download BGM: ${bgmRes.status}`);
    }
    await writeFile(bgmPath, Buffer.from(await bgmRes.arrayBuffer()));
  }

  return { workDir, videoPath, bgmPath };
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
