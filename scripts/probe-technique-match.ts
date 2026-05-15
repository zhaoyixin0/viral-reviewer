/**
 * Phase 3 验证脚本：用户 MaterialPotential + N 条爆款 CutPlan → TechniqueMatchingResult
 *
 * 用法：
 *   npm run probe:match -- --user <potential.json> --refs <cutplan1.json,cutplan2.json> [--intent "..."]
 *
 * 默认值：
 *   user: data/probes/potential-user-vlog-test-*.json (最新)
 *   refs: data/probes/compare-transitions-*.json + data/probes/tt-*.json (最新各一)
 */

import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { join, resolve, basename } from "path";
import { MaterialPotentialSchema } from "../lib/cut-plan/material-potential";
import { CutPlanSchema, type CutPlan } from "../lib/cut-plan/schema";
import { matchTechniques } from "../lib/technique-matching/match-engine";

async function findLatest(prefix: string): Promise<string | null> {
  const dir = join(process.cwd(), "data", "probes");
  try {
    const files = await readdir(dir);
    const matched = files
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
      .reverse();
    return matched[0] ? join(dir, matched[0]) : null;
  } catch {
    return null;
  }
}

type Args = {
  userPath: string;
  refPaths: string[];
  intent?: string;
};

async function parseArgs(): Promise<Args> {
  const argv = process.argv.slice(2);
  let userPath = "";
  let refsRaw = "";
  let intent: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user" && argv[i + 1]) userPath = argv[i + 1];
    if (argv[i] === "--refs" && argv[i + 1]) refsRaw = argv[i + 1];
    if (argv[i] === "--intent" && argv[i + 1]) intent = argv[i + 1];
  }
  if (!userPath) {
    const latest = await findLatest("potential-");
    if (!latest) {
      console.error("找不到 MaterialPotential JSON。先跑 npm run probe:potential");
      process.exit(1);
    }
    userPath = latest;
  }

  let refPaths: string[];
  if (refsRaw) {
    refPaths = refsRaw.split(",").map((p) => resolve(p.trim()));
  } else {
    const transition = await findLatest("compare-transitions-");
    const vlogPath = await findLatest("tt-");
    refPaths = [transition, vlogPath].filter(Boolean) as string[];
    if (refPaths.length === 0) {
      console.error("找不到任何 CutPlan JSON。先跑 npm run probe");
      process.exit(1);
    }
  }

  return { userPath: resolve(userPath), refPaths, intent };
}

async function loadCutPlan(path: string): Promise<CutPlan> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  // Phase 2 输出的 potential JSON 把 CutPlan 嵌套在 base 字段下
  const candidate = parsed.base ?? parsed;
  return CutPlanSchema.parse(candidate);
}

async function main() {
  const args = await parseArgs();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("错误：ANTHROPIC_API_KEY 未配置");
    process.exit(1);
  }

  console.log(`\n=== Phase 3 技法匹配引擎 ===`);
  console.log(`User MaterialPotential: ${basename(args.userPath)}`);
  console.log(`References (${args.refPaths.length}):`);
  args.refPaths.forEach((p) => console.log(`  - ${basename(p)}`));
  if (args.intent) console.log(`Intent: ${args.intent}`);
  console.log();

  const userRaw = JSON.parse(await readFile(args.userPath, "utf-8"));
  const userPotential = MaterialPotentialSchema.parse(userRaw);

  const refCutPlans = await Promise.all(args.refPaths.map(loadCutPlan));

  console.log(`[1/2] Opus 4.7 匹配推理（30-90s）...`);
  const t0 = Date.now();
  // Task 5 起 matchTechniques 多视频签名；probe 单视频场景包成单元素数组
  const result = await matchTechniques({
    userPotentials: [userPotential],
    userVideoIds: [userPotential.videoId],
    failedVideoIndexes: [],
    referenceCutPlans: refCutPlans,
    userIntent: args.intent,
  });
  console.log(`      ✓ 完成 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  console.log(`\n[2/2] 匹配结果摘要:\n`);

  result.reports.forEach((r, idx) => {
    console.log(`─── 爆款 ${idx + 1} · ${r.referenceVideoId} ───`);
    console.log(`  定位：${r.referencePositioning}`);
    console.log(`  整体适配度：${r.overallFitScore}/100 — ${r.fitSummary}`);
    if (r.bigPictureWarnings.length > 0) {
      console.log(`  ⚠ 整体警告：`);
      r.bigPictureWarnings.forEach((w) => console.log(`    • ${w}`));
    }
    console.log(`  ${r.recommendations.length} 个技法建议：`);
    r.recommendations.forEach((rec) => {
      const verdictEmoji =
        rec.verdict === "learn"
          ? "★"
          : rec.verdict === "adapt"
            ? "◇"
            : rec.verdict === "inverse"
              ? "↺"
              : "✗";
      const at = rec.userVideoAt
        ? ` @ user ${rec.userVideoAt.sec.toFixed(1)}s`
        : "";
      console.log(
        `\n    ${verdictEmoji} [${rec.verdict.toUpperCase()}] [${rec.priority}] ${rec.technique.name}${at}`,
      );
      console.log(`        理由: ${rec.reasoning}`);
      if (rec.adaptationNotes) {
        console.log(`        改造: ${rec.adaptationNotes}`);
      }
      if (rec.actionableSteps.length > 0) {
        console.log(`        步骤:`);
        rec.actionableSteps.forEach((s) => console.log(`          • ${s}`));
      }
      console.log(`        预期效果: ${rec.expectedImpact}`);
    });
    console.log();
  });

  console.log(`\n=== 跨爆款 · Top Priority Actions (${result.topPriorityActions.length}) ===`);
  result.topPriorityActions.forEach((a, i) => {
    const at = a.userVideoAt ? `@${a.userVideoAt.sec.toFixed(1)}s` : "";
    console.log(`  ${i + 1}. [${a.priority}] ${at} ${a.action}`);
    console.log(`     ← from ${a.sourcedFromReferenceId}`);
  });

  console.log(`\n=== 跨爆款 · Global Do-Not (${result.globalDoNots.length}) ===`);
  result.globalDoNots.forEach((d) => console.log(`  ✗ ${d}`));

  // 落盘
  const outDir = join(process.cwd(), "data", "probes");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = join(outDir, `match-${userPotential.videoId}-${stamp}.json`);
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`\n✓ 完整 TechniqueMatchingResult 已写入: ${outPath}\n`);
}

main().catch((e) => {
  console.error("\n[probe-match] 失败:", e);
  process.exit(1);
});
