/**
 * Task 2 PROBE — CapCut 转场结构逆向探测（只读，不进生产路径）。
 *
 * 读本机 CapCut 原生项目的 draft_content.json，dump：
 *  - materials.transitions[] 每个 transition material 的完整字段
 *  - 转场在 video track segment 上怎么引用（extra_material_refs）
 *  - 相邻段 target_timerange 是重叠 / 缩短 / 线性累加
 *  - filter / video_effect material 结构（附录，本期不实现，仅存档）
 *
 * 结论汇总维护在 docs/CAPCUT-TRANSITION-STRUCTURE.md。
 *
 * 跑法：
 *   npx tsx scripts/probe-capcut-transitions.ts
 *     → 默认扫描 %LOCALAPPDATA%/CapCut/.../com.lveditor.draft 下所有带转场的项目
 *   npx tsx scripts/probe-capcut-transitions.ts "D:/path/to/ProjA" "D:/path/to/ProjB"
 *     → 显式指定一个或多个项目目录（换机器时用，路径里要有 draft_content.json）
 *
 * 换机器须知：0514 / 0514(1) 等项目是 machine-local，不随 git 同步。
 * 另一台机器上需自己在 CapCut 里建带转场的项目，再把路径传给本脚本。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_PROJECTS_ROOT = join(
  process.env.LOCALAPPDATA ?? "C:/Users/Admin/AppData/Local",
  "CapCut/User Data/Projects/com.lveditor.draft",
);

interface TransitionMaterial {
  id: string;
  type: string;
  name: string;
  effect_id: string;
  resource_id: string;
  path: string;
  duration: number;
  is_overlap: boolean;
  category_id?: string;
  category_name?: string;
}

interface Segment {
  id: string;
  material_id: string;
  source_timerange: { start: number; duration: number } | null;
  target_timerange: { start: number; duration: number } | null;
  extra_material_refs: string[];
}

interface Track {
  type: string;
  segments: Segment[];
}

interface DraftContent {
  duration: number;
  platform?: { os?: string; app_version?: string; app_source?: string };
  materials: Record<string, unknown[]> & {
    transitions?: TransitionMaterial[];
    videos?: unknown[];
    effects?: Array<Record<string, unknown>>;
    video_effects?: Array<Record<string, unknown>>;
  };
  tracks: Track[];
}

/** 找出要探测的项目目录：argv 显式指定，或默认根目录下所有带转场的项目。 */
function resolveProjectDirs(): string[] {
  const argv = process.argv.slice(2);
  if (argv.length > 0) return argv;

  if (!existsSync(DEFAULT_PROJECTS_ROOT)) {
    console.error(`默认项目根目录不存在：${DEFAULT_PROJECTS_ROOT}`);
    console.error("请把 CapCut 项目目录作为参数传入。");
    return [];
  }
  return readdirSync(DEFAULT_PROJECTS_ROOT)
    .map((name) => join(DEFAULT_PROJECTS_ROOT, name))
    .filter((dir) => {
      if (!statSync(dir).isDirectory()) return false;
      const dc = join(dir, "draft_content.json");
      if (!existsSync(dc)) return false;
      try {
        const d = JSON.parse(readFileSync(dc, "utf8")) as DraftContent;
        return (d.materials?.transitions?.length ?? 0) > 0;
      } catch {
        return false;
      }
    });
}

function readDraft(projectDir: string): DraftContent | null {
  const dc = join(projectDir, "draft_content.json");
  if (!existsSync(dc)) {
    console.error(`  ✗ 无 draft_content.json：${dc}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(dc, "utf8")) as DraftContent;
  } catch (e) {
    // 新版 CapCut（macOS）会把 draft 数据加密，parse 会失败 —— 那种项目无法逆向。
    console.error(`  ✗ draft_content.json 解析失败（可能是加密的新版格式）：${(e as Error).message}`);
    return null;
  }
}

function probeProject(projectDir: string): void {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`项目：${projectDir}`);
  console.log("=".repeat(72));

  const draft = readDraft(projectDir);
  if (!draft) return;

  const transitions = draft.materials.transitions ?? [];
  console.log(
    `CapCut ${draft.platform?.app_version ?? "?"} (${draft.platform?.os ?? "?"}) · ` +
      `转场 ${transitions.length} 个 · 总时长 ${draft.duration}μs`,
  );

  // ── 1. transition material 完整字段 ──
  console.log("\n[1] materials.transitions[]：");
  for (const t of transitions) {
    console.log(
      `  - "${t.name}" effect_id=${t.effect_id} duration=${t.duration}μs ` +
        `is_overlap=${t.is_overlap} category=${t.category_name ?? ""}`,
    );
  }

  // ── 2. 转场怎么挂到 video track segment ──
  const videoTrack = draft.tracks.find((t) => t.type === "video");
  if (!videoTrack) {
    console.log("\n  ✗ 无 video track");
    return;
  }
  const transitionIds = new Set(transitions.map((t) => t.id));
  console.log("\n[2] video track segment → 转场引用：");
  const segs = videoTrack.segments;
  segs.forEach((seg, i) => {
    const refTransitions = seg.extra_material_refs.filter((r) => transitionIds.has(r));
    const names = refTransitions.map(
      (id) => transitions.find((t) => t.id === id)?.name ?? id,
    );
    console.log(
      `  seg[${i}] target=${JSON.stringify(seg.target_timerange)} ` +
        `挂转场=[${names.join(", ") || "无"}]`,
    );
  });

  // ── 3. 时间轴语义：相邻段 target_timerange 是重叠 / 缩短 / 线性累加 ──
  console.log("\n[3] 时间轴语义（相邻段 target_timerange 关系）：");
  let linear = true;
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1].target_timerange;
    const cur = segs[i].target_timerange;
    if (!prev || !cur) continue;
    const prevEnd = prev.start + prev.duration;
    const gap = cur.start - prevEnd;
    if (gap !== 0) linear = false;
    console.log(
      `  seg[${i - 1}].end=${prevEnd} → seg[${i}].start=${cur.start} ` +
        `(gap=${gap}${gap === 0 ? " 紧贴" : gap < 0 ? " 重叠" : " 留白"})`,
    );
  }
  const sumDur = segs.reduce((s, x) => s + (x.target_timerange?.duration ?? 0), 0);
  console.log(
    `  段时长之和=${sumDur} vs draft.duration=${draft.duration} → ` +
      `${sumDur === draft.duration ? "相等" : "不等"}`,
  );
  console.log(
    `  结论：${linear && sumDur === draft.duration ? "线性累加，转场不改 target_timerange（靠 is_overlap 标记）" : "非线性，需进一步分析"}`,
  );

  // ── 附录：filter / video_effect material（本期不实现，仅存档）──
  const filterLike = [
    ...(draft.materials.effects ?? []),
    ...(draft.materials.video_effects ?? []),
  ].filter((e) => {
    const type = String(e.type ?? "");
    return type === "filter" || type === "video_effect";
  });
  if (filterLike.length > 0) {
    console.log("\n[附录] filter / video_effect material（与 transition 同构，存档参考）：");
    for (const e of filterLike) {
      console.log(
        `  - type=${e.type} name="${e.name}" effect_id=${e.effect_id || e.resource_id}`,
      );
    }
  }
}

function main(): void {
  const dirs = resolveProjectDirs();
  if (dirs.length === 0) {
    console.error("没有可探测的项目。");
    process.exit(1);
  }
  console.log(`探测 ${dirs.length} 个 CapCut 项目…`);
  for (const dir of dirs) probeProject(dir);
  console.log(`\n${"=".repeat(72)}`);
  console.log("探测完成。结论汇总见 docs/CAPCUT-TRANSITION-STRUCTURE.md");
}

main();
