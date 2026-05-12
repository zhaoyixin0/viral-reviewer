/**
 * Phase 2 验证脚本：用户视频 → MaterialPotential IR
 *
 * 用法：
 *   npm run probe:potential -- --video <path> --id <id> [--intent "<用户想法>"] [--topic "<题材>"]
 *
 * 输出：
 *   data/probes/potential-<id>-<ts>.json
 *   stdout 打印关键潜力维度摘要
 */

import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { probeVideoMeta } from "../lib/video/ffprobe-meta";
import { analyzeMaterialPotential } from "../lib/video/analyze-potential";

type Args = {
  videoPath: string;
  id: string;
  intent?: string;
  topic?: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let videoPath = process.env.PROBE_VIDEO ?? "";
  let id = `user-${Date.now()}`;
  let intent: string | undefined;
  let topic: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--video" && argv[i + 1]) videoPath = argv[i + 1];
    if (argv[i] === "--id" && argv[i + 1]) id = argv[i + 1];
    if (argv[i] === "--intent" && argv[i + 1]) intent = argv[i + 1];
    if (argv[i] === "--topic" && argv[i + 1]) topic = argv[i + 1];
  }
  if (!videoPath) {
    console.error(
      "\n错误：必须提供视频路径。\n" +
        "用法：npm run probe:potential -- --video <mp4-path> [--intent <用户想法>] [--topic <题材>]\n",
    );
    process.exit(1);
  }
  return { videoPath: resolve(videoPath), id, intent, topic };
}

async function main() {
  const args = parseArgs();
  if (!process.env.GOOGLE_API_KEY) {
    console.error("错误：GOOGLE_API_KEY 未配置");
    process.exit(1);
  }

  console.log(`\n=== Phase 2 用户视频可塑性分析 ===`);
  console.log(`Video:  ${args.videoPath}`);
  console.log(`ID:     ${args.id}`);
  if (args.intent) console.log(`Intent: ${args.intent}`);
  if (args.topic) console.log(`Topic:  ${args.topic}`);
  console.log();

  console.log("[1/3] ffprobe 元数据...");
  const meta = await probeVideoMeta(args.videoPath);
  console.log(`      ${meta.durationSec.toFixed(2)}s / ${meta.fps}fps / ${meta.width}x${meta.height}`);

  console.log("\n[2/3] Gemini 2.5 Pro 可塑性分析（45-90s）...");
  const t0 = Date.now();
  const potential = await analyzeMaterialPotential({
    videoPath: args.videoPath,
    videoId: args.id,
    meta,
    hints: {
      userIntent: args.intent,
      userTopic: args.topic,
    },
  });
  console.log(`      ✓ 完成 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  console.log(`\n[3/3] MaterialPotential 摘要:`);
  console.log(`\n  形态：${potential.detectedFormat} (conf ${potential.detectedFormatConfidence})`);

  console.log(`\n  base.density:`);
  console.log(`    editing=${potential.base.density.editing} transition=${potential.base.density.transition} effect=${potential.base.density.effect} bgmSync=${potential.base.density.bgmSync} overall=${potential.base.density.overall}`);

  console.log(`\n  potential.cutPoints: ${potential.potential.cutPoints.length} 个候选切点`);
  potential.potential.cutPoints.slice(0, 5).forEach((c) =>
    console.log(`    - ${c.at.sec.toFixed(1)}s: ${c.reason} [${c.suitableTechniques.join("/")}] conf=${c.confidence}`),
  );

  console.log(`\n  potential.pushInOpportunities: ${potential.potential.pushInOpportunities.length} 个`);
  potential.potential.pushInOpportunities.slice(0, 3).forEach((p) =>
    console.log(`    - ${p.at.sec.toFixed(1)}s × ${p.durationSec}s · "${p.subject}" · ${p.recommendedScale.from}→${p.recommendedScale.to} (conf ${p.confidence})`),
  );

  console.log(`\n  potential.matchCutCandidates: ${potential.potential.matchCutCandidates.length} 对`);
  potential.potential.matchCutCandidates.slice(0, 3).forEach((m) =>
    console.log(`    - ${m.fromAt.sec.toFixed(1)}s→${m.toAt.sec.toFixed(1)}s | 匹配:${m.matchBasis} | 反差:${m.contrastDimension} (conf ${m.confidence})`),
  );

  console.log(`\n  potential.beatSlots: ${potential.potential.beatSlots.length} 个 BGM 节拍点`);
  potential.potential.beatSlots.slice(0, 5).forEach((b) =>
    console.log(`    - ${b.at.sec.toFixed(1)}s: ${b.kind} (${b.intensity}) → 适合 [${b.suitableFor.join("/")}]`),
  );

  console.log(`\n  potential.rhythmRange:`);
  console.log(`    当前: ${potential.potential.rhythmRange.current}`);
  console.log(`    可压缩到: ${potential.potential.rhythmRange.minShotDurationSec}s/镜`);
  console.log(`    可拉伸到: ${potential.potential.rhythmRange.maxShotDurationSec}s/镜`);
  console.log(`    改造方向: ${potential.potential.rhythmRange.adaptableTo.join(", ")}`);
  if (potential.potential.rhythmRange.bottleneck) {
    console.log(`    瓶颈: ${potential.potential.rhythmRange.bottleneck}`);
  }

  console.log(`\n  potential.colorContrast:`);
  console.log(`    当前调色: ${potential.potential.colorContrast.currentGrade}`);
  console.log(`    对比对: ${potential.potential.colorContrast.contrastPairs.length} 对`);
  console.log(`    整体可调: ${potential.potential.colorContrast.globalAdjustments.join(", ")}`);

  console.log(`\n  potential.subtitleSlots: ${potential.potential.subtitleSlots.length} 个字幕位置`);
  potential.potential.subtitleSlots.slice(0, 3).forEach((s) =>
    console.log(`    - ${s.at.sec.toFixed(1)}s × ${s.durationSec}s · ${s.reason}${s.hasLyricOverlap ? " [可叠加歌词]" : ""}`),
  );

  console.log(`\n  potential.metaphorHooks: ${potential.potential.metaphorHooks.length} 个隐喻关联 ★`);
  potential.potential.metaphorHooks.forEach((m) => {
    console.log(`    @${m.anchorAt.sec.toFixed(1)}s: ${m.description}`);
    if (m.bgmLyricFragment) console.log(`        歌词: "${m.bgmLyricFragment}"`);
    console.log(`        画面: ${m.visualElement}`);
    console.log(`        放大: ${m.amplifyHow}`);
  });

  console.log(`\n  potential.sceneTransitionCandidates: ${potential.potential.sceneTransitionCandidates.length} 个序列候选`);
  potential.potential.sceneTransitionCandidates.slice(0, 2).forEach((s) =>
    console.log(`    - ${s.scenes.length} 段场景 → ${s.narrativeArc} (推荐: ${s.recommendedTechnique})`),
  );

  console.log(`\n=== 适配性总评 ===`);
  console.log(`\n  ✓ Strengths（素材优势）：`);
  potential.adaptabilitySummary.strengths.forEach((s) => console.log(`      • ${s}`));
  console.log(`\n  ⚠ Limitations（素材局限）：`);
  potential.adaptabilitySummary.limitations.forEach((s) => console.log(`      • ${s}`));
  console.log(`\n  ★ Best Suited Techniques（最适合学的技法）：`);
  potential.adaptabilitySummary.bestSuitedTechniques.forEach((s) => console.log(`      • ${s}`));
  console.log(`\n  ✗ Not Suitable（明确不要学）：`);
  potential.adaptabilitySummary.notSuitableTechniques.forEach((s) => console.log(`      • ${s}`));

  // 落盘
  const outDir = join(process.cwd(), "data", "probes");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = join(outDir, `potential-${args.id}-${stamp}.json`);
  await writeFile(outPath, JSON.stringify(potential, null, 2), "utf-8");
  console.log(`\n✓ 完整 MaterialPotential 已写入: ${outPath}\n`);
}

main().catch((e) => {
  console.error("\n[probe-potential] 失败:", e);
  process.exit(1);
});
