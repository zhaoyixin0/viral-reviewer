import { mkdir, stat, unlink } from "node:fs/promises";
import { dirname, relative } from "node:path";
import youtubeDl from "youtube-dl-exec";

export type DownloadResult =
  | { ok: true; path: string; bytes: number; cached: boolean }
  | { ok: false; reason: string };

/**
 * 用 yt-dlp 把页面 URL（TikTok / Instagram post URL）解析为 mp4 并下载。
 *
 * - 已存在的 mp4 直接复用（断点续跑用）
 * - 失败重试 2 次（yt-dlp 偶尔超时）
 * - 单文件 90s 超时
 *
 * 使用约束：调用方需保证同一 outPath 不会被并发多次调用（脚本里每条爆款一个
 * 独占的 `{id}.mp4` 路径，天然满足）。yt-dlp 的 `--output` 走相对路径，所以
 * 调用必须从项目根目录发起（tsx 脚本默认满足）。
 */
export async function downloadVideo(
  pageUrl: string,
  outPath: string,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<DownloadResult> {
  const { retries = 2, timeoutMs = 90_000 } = opts;

  // 缓存命中：已经下过的不重下
  try {
    const existing = await stat(outPath);
    if (existing.size > 1024) {
      return { ok: true, path: outPath, bytes: existing.size, cached: true };
    }
    // tiny file = 之前的失败残留，删了重下
    await unlink(outPath).catch(() => {});
  } catch {
    /* not exists, fall through */
  }

  await mkdir(dirname(outPath), { recursive: true });

  // yt-dlp on Windows can't handle absolute paths with spaces in the --output arg.
  // Use a path relative to cwd to avoid the issue.
  const relPath = relative(process.cwd(), outPath);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const promise = youtubeDl(pageUrl, {
        output: relPath,
        format: "mp4/best[ext=mp4]/best",
        noWarnings: true,
        noCheckCertificates: true,
        preferFreeFormats: true,
        addHeader: ["referer:https://www.google.com"],
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`yt-dlp timeout ${timeoutMs}ms`)), timeoutMs),
      );
      await Promise.race([promise, timeoutPromise]);

      const s = await stat(outPath).catch(() => null);
      if (!s || s.size < 1024) {
        lastErr = new Error(`yt-dlp output tiny (${s?.size ?? 0} bytes)`);
        await unlink(outPath).catch(() => {});
        continue;
      }
      return { ok: true, path: outPath, bytes: s.size, cached: false };
    } catch (e) {
      lastErr = e;
      await unlink(outPath).catch(() => {});
    }
  }

  return {
    ok: false,
    reason: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}
