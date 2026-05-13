/**
 * Edit plan · 把 LLM 的"必删片段"指令翻译成 CapCut 的 segment 列表
 *
 * 历史背景：早期 build.ts 把所有切点（topPriorityActions[].userVideoAt）
 * 简单地切成段，然后每段 source_timerange.start === target_timerange.start，
 * 视觉上等于完整原视频按切点切开再原样拼回——「标了切点，没真剪辑」。
 *
 * 真正的剪辑要做两件事：
 *   1) 识别"删除区间"（trim ranges），LLM 在自由文本里以"必删 0-0.5s"等形式给出
 *   2) 保留剩余区间，并把它们紧贴拼到输出时间轴 [0, total_kept]
 *
 * 输出的 EditSegmentPlan 描述每段最终在时间轴上的位置：
 *   - source_timerange：原视频里的取片范围
 *   - target_timerange：输出时间轴上的紧贴位置
 *
 * 优先使用结构化的 match.trimRanges（LLM 显式输出），fallback 用 regex 从自由文本里抽。
 */

import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { Keyframe } from "./schema";

export type TrimRange = {
  startSec: number;
  endSec: number;
  reason: string;
};

export type KeepRange = {
  sourceStartSec: number;
  sourceEndSec: number;
};

export type EditAnimation =
  | { type: "push_in"; scaleFrom: number; scaleTo: number }
  | { type: "pull_out"; scaleFrom: number; scaleTo: number }
  | { type: "none" };

export type EditSegmentPlan = {
  sourceStartSec: number;
  sourceEndSec: number;
  targetStartSec: number;
  targetEndSec: number;
  animation: EditAnimation;
};

// ===== Trim range extraction =====

const DELETE_HINT_RE =
  /(必删|删除|删掉|去掉|不要|跳过|trim|cut\s|remove|drop|skip)/i;
// 0.5-1.2秒 / 0.5—1.2s / 0.5 至 1.2 秒
// 必须以 s/秒/sec/second 结尾，避免在 "P0 - 0-0.6s" 里被 "P0 - 0" 抢匹配
const TIME_RANGE_RE =
  /(\d+(?:\.\d+)?)\s*[-–—~~至到]\s*(\d+(?:\.\d+)?)\s*(?:s|秒|seconds?|sec)\b/gi;
// 不能用 `.` — 会把 0.6s 切成 "0" / "6s" 两半。只用句号级强分隔。
const SENTENCE_SPLIT_RE = /[。！？!?\n;；]/;

/**
 * 从 LLM 自由文本里抽时间范围作为 trim 候选。
 * 只在句子同时包含"删除"类关键词时才采纳，避免把"0-0.5s 加 push-in"误判为删除。
 */
function regexExtractTrims(texts: ReadonlyArray<string>, totalDurSec: number): TrimRange[] {
  const out: TrimRange[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const sentence of text.split(SENTENCE_SPLIT_RE)) {
      if (!DELETE_HINT_RE.test(sentence)) continue;
      const re = new RegExp(TIME_RANGE_RE.source, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(sentence)) !== null) {
        const startSec = parseFloat(m[1]);
        const endSec = parseFloat(m[2]);
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
        if (startSec < 0 || endSec <= startSec) continue;
        if (endSec > totalDurSec + 0.5) continue;
        out.push({
          startSec,
          endSec: Math.min(endSec, totalDurSec),
          reason: sentence.trim().slice(0, 120),
        });
      }
    }
  }
  return out;
}

/**
 * 合并重叠 / 相邻区间，按 startSec 排序
 */
function mergeTrimRanges(ranges: ReadonlyArray<TrimRange>): TrimRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.startSec - b.startSec);
  const merged: TrimRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.startSec <= last.endSec + 0.05) {
      last.endSec = Math.max(last.endSec, cur.endSec);
      if (!last.reason.includes(cur.reason)) {
        last.reason = `${last.reason} | ${cur.reason}`.slice(0, 240);
      }
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

export function extractTrimRanges(
  match: TechniqueMatchingResult,
  totalDurSec: number,
): TrimRange[] {
  // Path A: 结构化字段（未来由 LLM 直接输出）
  if (Array.isArray(match.trimRanges) && match.trimRanges.length > 0) {
    const structured: TrimRange[] = match.trimRanges
      .filter((t) => Number.isFinite(t.startSec) && Number.isFinite(t.endSec))
      .filter((t) => t.startSec >= 0 && t.endSec > t.startSec)
      .map((t) => ({
        startSec: t.startSec,
        endSec: Math.min(t.endSec, totalDurSec),
        reason: t.reason ?? "(structured trim)",
      }));
    return mergeTrimRanges(structured);
  }

  // Path B: regex fallback — 从自由文本扫
  const texts: string[] = [
    ...(match.topPriorityActions ?? []).map((a) => a.action ?? ""),
    ...(match.globalDoNots ?? []),
    ...(match.reports ?? []).flatMap((r) => [
      ...(r.bigPictureWarnings ?? []),
      ...(r.recommendations ?? []).flatMap((rec) => [
        rec.reasoning ?? "",
        ...(rec.actionableSteps ?? []),
      ]),
    ]),
  ];
  return mergeTrimRanges(regexExtractTrims(texts, totalDurSec));
}

// ===== Keep ranges & cut points → plan =====

export function computeKeepRanges(
  totalDurSec: number,
  trims: ReadonlyArray<TrimRange>,
): KeepRange[] {
  const out: KeepRange[] = [];
  let cursor = 0;
  for (const t of trims) {
    if (t.startSec > cursor + 0.05) {
      out.push({ sourceStartSec: cursor, sourceEndSec: t.startSec });
    }
    cursor = Math.max(cursor, t.endSec);
  }
  if (cursor < totalDurSec - 0.05) {
    out.push({ sourceStartSec: cursor, sourceEndSec: totalDurSec });
  }
  // 兜底：没有 trim → 整段保留
  if (out.length === 0) {
    out.push({ sourceStartSec: 0, sourceEndSec: totalDurSec });
  }
  return out;
}

/**
 * 在 keep range 内根据 cut points 切分成多段，并把每段的 target_timerange
 * 紧贴拼到输出时间轴上。
 *
 * @param keepRanges 删除后剩下的源视频区间
 * @param cutPointsInSource 切点（源视频时间戳）。落在 trim 区间内的点会被自动忽略
 * @param animator 给每段返回一个动画（建议 push_in / pull_out / none）
 */
export function planEditSegments(
  keepRanges: ReadonlyArray<KeepRange>,
  cutPointsInSource: ReadonlyArray<number>,
  animator: (
    sourceStartSec: number,
    sourceEndSec: number,
    indexAcrossPlan: number,
  ) => EditAnimation,
  minSegmentSec = 0.25,
): EditSegmentPlan[] {
  const plans: EditSegmentPlan[] = [];
  let targetCursor = 0;
  let idx = 0;

  for (const keep of keepRanges) {
    const internalCuts = cutPointsInSource.filter(
      (c) => c > keep.sourceStartSec + 1e-3 && c < keep.sourceEndSec - 1e-3,
    );
    const boundaries = Array.from(
      new Set([keep.sourceStartSec, ...internalCuts, keep.sourceEndSec]),
    ).sort((a, b) => a - b);

    for (let i = 0; i < boundaries.length - 1; i++) {
      const sStart = boundaries[i];
      const sEnd = boundaries[i + 1];
      const dur = sEnd - sStart;
      if (dur < minSegmentSec) {
        // 过短段并入上一段（如果有）
        const last = plans[plans.length - 1];
        if (last && Math.abs(last.sourceEndSec - sStart) < 1e-3) {
          last.sourceEndSec = sEnd;
          last.targetEndSec += dur;
          targetCursor += dur;
        }
        continue;
      }
      plans.push({
        sourceStartSec: sStart,
        sourceEndSec: sEnd,
        targetStartSec: targetCursor,
        targetEndSec: targetCursor + dur,
        animation: animator(sStart, sEnd, idx),
      });
      targetCursor += dur;
      idx++;
    }
  }

  return plans;
}

// ===== Animation selection =====

/**
 * 决定该段的 zoom 动画。规则：
 *   - 段太短（<0.5s）→ none（避免视觉抽搐）
 *   - 用户素材在段内有 camera_move → 跟随
 *   - match 推荐里有 push/pull 关键词 → 用
 *   - 兜底：交替轻微 push/pull
 *
 * 默认幅度从历史的 1.0→1.12 缩到 1.0→1.05，单帧位移更小，观感更自然。
 */
export function pickAnimation(
  sourceStartSec: number,
  sourceEndSec: number,
  indexAcrossPlan: number,
  potential: MaterialPotential,
  match: { reports: ReadonlyArray<{ recommendations: ReadonlyArray<{ verdict: string; userVideoAt?: { sec: number } | null; technique: { name: string } }> }> },
): EditAnimation {
  const durSec = sourceEndSec - sourceStartSec;
  if (durSec < 0.5) return { type: "none" };

  // 1) 用户原视频 camera_move
  for (const action of potential.base.actions) {
    if (action.kind !== "camera_move") continue;
    const at = action.at.sec;
    if (at >= sourceStartSec && at < sourceEndSec) {
      if (action.type === "push_in") {
        return {
          type: "push_in",
          scaleFrom: clamp(action.scaleFrom ?? 1.0, 0.9, 1.1),
          scaleTo: clamp(action.scaleTo ?? 1.06, 1.0, 1.15),
        };
      }
      if (action.type === "pull_out") {
        return {
          type: "pull_out",
          scaleFrom: clamp(action.scaleFrom ?? 1.06, 1.0, 1.15),
          scaleTo: clamp(action.scaleTo ?? 1.0, 0.9, 1.1),
        };
      }
    }
  }

  // 2) match 推荐
  for (const report of match.reports ?? []) {
    for (const rec of report.recommendations ?? []) {
      if (rec.verdict !== "learn" && rec.verdict !== "adapt") continue;
      if (!rec.userVideoAt) continue;
      const t = rec.userVideoAt.sec;
      if (t < sourceStartSec || t >= sourceEndSec) continue;
      const name = rec.technique.name.toLowerCase();
      if (
        name.includes("push") ||
        name.includes("punch") ||
        name.includes("推近") ||
        name.includes("zoom in")
      ) {
        return { type: "push_in", scaleFrom: 1.0, scaleTo: 1.06 };
      }
      if (name.includes("pull") || name.includes("拉远") || name.includes("zoom out")) {
        return { type: "pull_out", scaleFrom: 1.06, scaleTo: 1.0 };
      }
    }
  }

  // 3) 兜底交替（幅度从 12% 降到 4%）
  return indexAcrossPlan % 2 === 0
    ? { type: "push_in", scaleFrom: 1.0, scaleTo: 1.04 }
    : { type: "pull_out", scaleFrom: 1.04, scaleTo: 1.0 };
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

// ===== Eased keyframes =====

/**
 * cubic-bezier(0.4, 0, 0.2, 1) 近似 — Material Design 的 standard ease。
 * 用闭式近似避免迭代。
 */
function easeInOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * CapCut keyframe schema 不暴露 curve / easing 字段（参考开源 capcut-cli 实现也是 2-keyframe linear）。
 * 用 9 个均匀采样的 keyframe 模拟 ease-in-out，CapCut 之间的 linear 插值
 * 拼起来视觉等效一条平滑曲线。
 */
export function makeEasedScaleKeyframes(
  scaleFrom: number,
  scaleTo: number,
  durationUs: number,
): Keyframe[] {
  if (Math.abs(scaleTo - scaleFrom) < 0.005 || durationUs < 200_000) {
    return [{ time_offset: 0, values: [scaleFrom] }];
  }
  const N = 8;
  const kfs: Keyframe[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const eased = easeInOut(t);
    const v = scaleFrom + (scaleTo - scaleFrom) * eased;
    kfs.push({
      time_offset: Math.round(durationUs * t),
      values: [Math.round(v * 10000) / 10000],
    });
  }
  return kfs;
}
