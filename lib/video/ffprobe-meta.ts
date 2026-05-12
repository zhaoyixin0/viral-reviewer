import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic?.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

/**
 * 视频技术元数据 — ffprobe 给的硬指标（Gemini 不会精确给）
 */
export type VideoMeta = {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
  /** 是否有音轨 */
  hasAudio: boolean;
};

function parseFps(rateStr: string | undefined): number {
  if (!rateStr) return 30;
  if (rateStr.includes("/")) {
    const [num, den] = rateStr.split("/").map(Number);
    if (den > 0) return num / den;
  }
  const n = Number(rateStr);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/**
 * Probe a local video file or remote URL for technical metadata.
 *
 * 推荐传本地路径（ffprobe 直接读，最快）。
 * 传 http URL 也可以但要求 ffprobe 能联网。
 */
export async function probeVideoMeta(pathOrUrl: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(pathOrUrl, (err, data) => {
      if (err) return reject(err);

      const videoStream = data.streams.find((s) => s.codec_type === "video");
      const audioStream = data.streams.find((s) => s.codec_type === "audio");

      if (!videoStream) {
        return reject(new Error("no video stream found in input"));
      }

      const durationRaw = data.format?.duration ?? videoStream.duration ?? 0;
      const durationSec =
        typeof durationRaw === "number"
          ? durationRaw
          : Number(durationRaw) || 0;

      const fps =
        parseFps(videoStream.avg_frame_rate ?? videoStream.r_frame_rate);

      resolve({
        durationSec,
        fps,
        width: videoStream.width ?? 0,
        height: videoStream.height ?? 0,
        codec: videoStream.codec_name ?? "unknown",
        bitrate: Number(data.format?.bit_rate ?? 0),
        hasAudio: !!audioStream,
      });
    });
  });
}
