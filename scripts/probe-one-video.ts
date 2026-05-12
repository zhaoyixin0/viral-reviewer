/**
 * Phase 1 验证脚本：单条视频 → CutPlan IR 端到端
 *
 * 用法：
 *   1. 把目标 TikTok 视频手动下载成本地 mp4
 *      （Phase 1 不接 Apify 自动下载，避免消耗抓取额度）
 *   2. 跑：
 *      npm run probe -- --video ./tmp/my-video.mp4
 *      （或环境变量 PROBE_VIDEO=./tmp/my-video.mp4）
 *
 * 输出：
 *   data/probes/<id>-<timestamp>.json — 完整 CutPlan IR
 *   stdout 打印关键摘要：videoFormat / density / shotCount / etc.
 */

import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { probeVideoMeta } from "../lib/video/ffprobe-meta";
import { understandVideoAsCutPlan } from "../lib/video/gemini-understand";

// Phase 1 默认目标：@wheretonext.w2n vlog · 25s · 762k views
const DEFAULT_TARGET = {
  id: "tt-7594916354117881119",
  url: "https://www.tiktok.com/@wheretonext.w2n/video/7594916354117881119",
  title: "Bali Gili Trawangan sunset — life advice",
  bgm: "(unknown trending sound)",
  tags: ["#bali", "#travelvlog", "#cinematic"],
};

function parseArgs(): { videoPath: string; id: string } {
  const args = process.argv.slice(2);
  let videoPath = process.env.PROBE_VIDEO ?? "";
  let id = DEFAULT_TARGET.id;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--video" && args[i + 1]) videoPath = args[i + 1];
    if (args[i] === "--id" && args[i + 1]) id = args[i + 1];
  }
  if (!videoPath) {
    console.error(
      "\n错误：必须提供视频路径。\n" +
        "用法：npm run probe -- --video <path-to-mp4>\n" +
        "  或：PROBE_VIDEO=<path> npm run probe\n\n" +
        `Phase 1 默认目标视频（手动下载这条 TikTok 成 mp4 再传入）：\n  ${DEFAULT_TARGET.url}\n`,
    );
    process.exit(1);
  }
  return { videoPath: resolve(videoPath), id };
}

async function main() {
  const { videoPath, id } = parseArgs();

  if (!process.env.GOOGLE_API_KEY) {
    console.error("错误：GOOGLE_API_KEY 未配置（检查 .env.local）");
    process.exit(1);
  }

  console.log(`\n=== Phase 1 视频解析验证 ===`);
  console.log(`Video: ${videoPath}`);
  console.log(`ID:    ${id}\n`);

  // 1) ffprobe 拿硬指标
  console.log("[1/3] ffprobe 元数据...");
  const meta = await probeVideoMeta(videoPath);
  console.log(`      duration: ${meta.durationSec.toFixed(2)}s`);
  console.log(`      fps: ${meta.fps}`);
  console.log(`      resolution: ${meta.width}x${meta.height}`);
  console.log(`      codec: ${meta.codec}`);
  console.log(`      hasAudio: ${meta.hasAudio}\n`);

  // 2) Gemini 视频理解
  console.log("[2/3] Gemini 2.5 Pro 视频解析（上传 + 分析，约 30-90s）...");
  const t0 = Date.now();
  const cutPlan = await understandVideoAsCutPlan({
    videoPath,
    videoId: id,
    meta,
    hints: {
      sourceUrl: DEFAULT_TARGET.url,
      knownTitle: DEFAULT_TARGET.title,
      knownBgm: DEFAULT_TARGET.bgm,
      knownTags: DEFAULT_TARGET.tags,
    },
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`      ✓ Gemini 完成 (${dt}s)\n`);

  // 3) 关键摘要
  console.log(`[3/3] CutPlan 摘要：`);
  console.log(`      videoFormat: ${cutPlan.videoFormat} (conf ${cutPlan.videoFormatConfidence})`);
  console.log(`      actions: ${cutPlan.actions.length} total`);
  const byKind = cutPlan.actions.reduce<Record<string, number>>((acc, a) => {
    acc[a.kind] = (acc[a.kind] ?? 0) + 1;
    return acc;
  }, {});
  for (const [k, v] of Object.entries(byKind)) {
    console.log(`        - ${k}: ${v}`);
  }
  console.log(`      pacing: ${cutPlan.dimensions.pacing.shotCount} shots, ${cutPlan.dimensions.pacing.avgShotDurationSec.toFixed(2)}s/shot, ${cutPlan.dimensions.pacing.rhythmProfile}`);
  console.log(`      structure.hookFormat: ${cutPlan.dimensions.structure.hookFormat}`);
  console.log(`      bgm: ${cutPlan.bgm?.name ?? "(none detected)"}, trending=${cutPlan.bgm?.trending ?? "?"}`);
  console.log(`      density:`);
  console.log(`        editing: ${cutPlan.density.editing}`);
  console.log(`        transition: ${cutPlan.density.transition}`);
  console.log(`        effect: ${cutPlan.density.effect}`);
  console.log(`        bgmSync: ${cutPlan.density.bgmSync}`);
  console.log(`        overall: ${cutPlan.density.overall}\n`);

  // 落盘
  const outDir = join(process.cwd(), "data", "probes");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = join(outDir, `${id}-${stamp}.json`);
  await writeFile(outPath, JSON.stringify(cutPlan, null, 2), "utf-8");
  console.log(`✓ 完整 CutPlan 已写入: ${outPath}`);
}

main().catch((e) => {
  console.error("\n[probe] 失败:", e);
  process.exit(1);
});
