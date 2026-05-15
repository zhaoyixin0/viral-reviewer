/**
 * 一次性 probe：直接用 buildDraftContent + packageDraftAsZip 生成一个真实的
 * CapCut 导出 zip，绕开 Gemini/Opus 分析（外部 AI 服务因公司 SWG TLS 拦截不可达）。
 *
 * 用本机一份现成的真实 mp4 作素材，输出 capcut-link-test.zip 到 worktree 根目录。
 * 用途：人工实测 setup.bat / setup.sh + CapCut 打开是否还弹 "Couldn't link"。
 *
 * 跑：npx tsx scripts/probe-capcut-zip.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildDraftContent } from "@/lib/capcut-compiler/build";
import { packageDraftAsZip } from "@/lib/capcut-compiler/package";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

// 本机一份现成的真实 mp4（之前导出留下的素材，720x1280 ~8s）
const VIDEO_PATH =
  "C:/Users/yixin/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft/viral-reviewer-vlog-2026-05-13/materials/input.mp4";
const VIDEO_FILE_NAME = "20260429-200100.mp4";
const PROJECT_NAME = "capcut-link-test";
const OUT = "capcut-link-test.zip";

async function main() {
  const videoBuffer = readFileSync(VIDEO_PATH);
  const meta = await probeVideoMeta(VIDEO_PATH);
  console.log("video meta:", meta);

  // buildDraftContent 只读 potential.base.actions / match 的几个数组字段，
  // 这里给最小可用 fixture（和 tests/capcut-compiler 里一致的做法）。
  const { draftContent, metaInfo } = buildDraftContent({
    projectName: PROJECT_NAME,
    videoFileNames: [VIDEO_FILE_NAME],
    metas: [meta],
    potential: { base: { actions: [] } } as unknown as MaterialPotential,
    match: {
      userVideoId: "probe",
      reports: [],
      topPriorityActions: [],
      globalDoNots: [],
      recommendedBgms: [],
      trimRanges: [],
    } as unknown as TechniqueMatchingResult,
  });

  const bytes = await packageDraftAsZip({
    projectName: PROJECT_NAME,
    draftContent,
    metaInfo,
    videoBuffer,
    videoFileName: VIDEO_FILE_NAME,
  });

  writeFileSync(OUT, Buffer.from(bytes));
  console.log(`wrote ${OUT} (${(bytes.byteLength / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
