import "server-only";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import { mkdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  fetchWithAllowlist,
  type UrlAllowlist,
} from "@/lib/url-allowlist";

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic?.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

export type ExtractResult = {
  framesBase64: string[]; // 抽样帧 (JPEG, base64)
  audioPath: string; // 音轨临时文件
  duration: number; // 视频总秒数
  workDir: string; // 临时工作目录（用完后调用 cleanup）
};

/**
 * 从远程 URL 下载视频到 /tmp，抽 N 帧 + 抽音轨。
 *
 * **SSRF + DNS rebinding 防御（P3 #2 phase 2 + phase 3.5 · 2026-05-15）**：
 * 用 `fetchWithAllowlist`（undici Pool with resolved-IP + SNI）替代 plain `fetch`，
 * 内部 `checkAsync` 含 sync fast-fail（invalid_url / scheme_denied / host_denied /
 * private_ip 不发 DNS），DNS resolve 后逐 IP 私段校验。**ffmpeg 仅读本地 /tmp 文件**
 * （fetch 完后 writeFile,ffmpeg 走 libavformat 读本地路径），不触发额外 DNS resolve,
 * 与"alt path（先下 /tmp → ffmpeg 读本地）"等价。
 *
 * @param videoUrl   远程视频 URL
 * @param frameCount 抽帧数量（default 6）
 * @param opts.urlAllowlist  **必填** SSRF allowlist 实例（W3 phase 2 verdict A：TS
 *   编译期强制 caller 传，避免漏防御）
 *
 * Returns a workspace handle. 调用方使用完毕后必须调 cleanupWorkspace。
 */
export async function extractFramesAndAudio(
  videoUrl: string,
  frameCount: number,
  opts: { urlAllowlist: UrlAllowlist },
): Promise<ExtractResult> {
  // P3 #2 phase 3.5 (W3 verdict 5357c41 §B1): fetchWithAllowlist 内部 checkAsync
  // 已含 sync fast-fail（前 4 个 reason 不发 DNS）+ DNS resolve + 私段校验。
  // 无需 caller 层额外 sync check（双重 check 浪费 ~30ms latency）。
  const res = await fetchWithAllowlist(videoUrl, opts.urlAllowlist);
  if (!res.ok) throw new Error(`Failed to download video: ${res.status}`);

  const id = `vr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workDir = join(tmpdir(), id);
  await mkdir(workDir, { recursive: true });

  const videoPath = join(workDir, "input.mp4");
  const audioPath = join(workDir, "audio.mp3");

  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFile } = await import("fs/promises");
  await writeFile(videoPath, buf);

  // 2) 探测时长
  const duration = await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err);
      const d = data.format?.duration ?? 0;
      resolve(typeof d === "number" ? d : Number(d) || 0);
    });
  });

  // 3) 按等间距抽帧
  const timestamps = Array.from({ length: frameCount }, (_, i) => {
    if (frameCount === 1) return duration / 2;
    return (duration * i) / (frameCount - 1);
  }).map((t) => Math.max(0.1, Math.min(t, Math.max(duration - 0.1, 0.1))));

  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .on("end", () => resolve())
      .on("error", reject)
      .screenshots({
        timestamps: timestamps.map((t) => `${t.toFixed(2)}`),
        filename: "frame-%i.jpg",
        folder: workDir,
        size: "640x?",
      });
  });

  // 4) 读取每帧为 base64
  const framesBase64: string[] = [];
  for (let i = 1; i <= frameCount; i++) {
    try {
      const f = await readFile(join(workDir, `frame-${i}.jpg`));
      framesBase64.push(f.toString("base64"));
    } catch {
      // 某些时戳取不到帧，跳过
    }
  }

  // 5) 抽音轨（用于 Whisper 转录）
  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .on("end", () => resolve())
      .on("error", reject)
      .save(audioPath);
  });

  return { framesBase64, audioPath, duration, workDir };
}

export async function cleanupWorkspace(workDir: string): Promise<void> {
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
