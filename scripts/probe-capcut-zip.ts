/**
 * 一次性 probe：直接用 buildDraftContent + packageDraftAsZip 生成一个真实的
 * CapCut 多视频导出 zip，绕开 Gemini/Opus 分析（外部 AI 服务因公司 SWG TLS 拦截不可达）。
 *
 * Task 12 hands-on：3 段真实 mp4 + assemblyTimeline（4 clips 含 3 种转场），
 * 输出 capcut-link-test.zip 到 worktree 根目录。
 * 用途：人工实测 setup.bat / setup.sh + CapCut 打开后：
 *   1) 不弹"Couldn't link"
 *   2) 时间轴看到 3 个独立 segment 拼接（来自不同源视频）
 *   3) 转场目视生效（叠化 / 推近 / 模糊）
 *   4) 1 条 metaphor hook 字幕重映射到剪辑后时间轴正确位置
 *
 * 跑：npx tsx scripts/probe-capcut-zip.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildDraftContent } from "@/lib/capcut-compiler/build";
import { packageDraftAsZip } from "@/lib/capcut-compiler/package";
import { probeVideoMeta } from "@/lib/video/ffprobe-meta";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

// 0514 项目的三段真实 mp4（用户手工实测时挑的素材，720x1280 ~8s 各段）
const VIDEO_PATHS = [
  "C:/Users/yixin/Downloads/20260514-201757.mp4",
  "C:/Users/yixin/Downloads/20260514-201802.mp4",
  "C:/Users/yixin/Downloads/20260514-201807.mp4",
];
const VIDEO_FILE_NAMES = [
  "20260514-201757.mp4",
  "20260514-201802.mp4",
  "20260514-201807.mp4",
];
const PROJECT_NAME = "capcut-link-test-multi";
const OUT = "capcut-link-test.zip";

async function main() {
  const videoBuffers = VIDEO_PATHS.map((p) => readFileSync(p));
  const metas = await Promise.all(VIDEO_PATHS.map((p) => probeVideoMeta(p)));
  console.log("video metas:", metas);

  // assemblyTimeline：4 clips 横跨 3 源视频，3 个转场覆盖典型类型。
  // clip 切片范围相对各源视频的本地时间；转场放 incomingTransition（clip[0] = null）。
  const assemblyTimeline = {
    clips: [
      {
        sourceVideoIndex: 0,
        sourceVideoId: VIDEO_FILE_NAMES[0]!,
        order: 0,
        sourceStartSec: 0,
        sourceEndSec: Math.min(3, metas[0]!.durationSec),
        animation: { type: "push_in", scaleFrom: 1.0, scaleTo: 1.06 },
        incomingTransition: null,
        reason: "intro",
      },
      {
        sourceVideoIndex: 1,
        sourceVideoId: VIDEO_FILE_NAMES[1]!,
        order: 1,
        sourceStartSec: 0,
        sourceEndSec: Math.min(3, metas[1]!.durationSec),
        animation: null,
        incomingTransition: {
          type: "cross_dissolve",
          durationSec: 0.5,
          reason: "soften cut into part 2",
        },
        reason: "build",
      },
      {
        sourceVideoIndex: 2,
        sourceVideoId: VIDEO_FILE_NAMES[2]!,
        order: 2,
        sourceStartSec: 0,
        sourceEndSec: Math.min(3, metas[2]!.durationSec),
        animation: { type: "pull_out", scaleFrom: 1.06, scaleTo: 1.0 },
        incomingTransition: {
          type: "push_in_transition",
          durationSec: 0.5,
          reason: "punchy camera move",
        },
        reason: "punch",
      },
      {
        sourceVideoIndex: 0,
        sourceVideoId: VIDEO_FILE_NAMES[0]!,
        order: 3,
        sourceStartSec: Math.min(3, metas[0]!.durationSec),
        sourceEndSec: Math.min(6, metas[0]!.durationSec),
        animation: null,
        incomingTransition: {
          type: "blur",
          durationSec: 0.5,
          reason: "stylistic blur",
        },
        reason: "callback",
      },
    ],
  };

  const { draftContent, metaInfo } = buildDraftContent({
    projectName: PROJECT_NAME,
    videoFileNames: VIDEO_FILE_NAMES,
    metas,
    potential: {
      base: {
        actions: [
          {
            kind: "subtitle",
            at: { sec: 1 },
            durationSec: 2,
            text: "Task 12 hands-on test 字幕",
          },
        ],
      },
    } as unknown as MaterialPotential,
    match: {
      userVideoId: "probe-multi",
      reports: [],
      topPriorityActions: [],
      globalDoNots: [],
      recommendedBgms: [],
      trimRanges: [],
      assemblyTimeline,
    } as unknown as TechniqueMatchingResult,
  });

  const bytes = await packageDraftAsZip({
    projectName: PROJECT_NAME,
    draftContent,
    metaInfo,
    videos: videoBuffers.map((buffer, i) => ({
      buffer,
      fileName: VIDEO_FILE_NAMES[i]!,
    })),
  });

  writeFileSync(OUT, Buffer.from(bytes));
  console.log(`wrote ${OUT} (${(bytes.byteLength / 1024).toFixed(1)} KB)`);
  console.log(`segments=${draftContent.tracks[0]?.segments.length}`);
  console.log(`transitions=${draftContent.materials.transitions.length}`);
  console.log(`videos=${draftContent.materials.videos.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
