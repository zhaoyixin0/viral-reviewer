import type { TimeCode } from "./schema";

/**
 * TimeCode 双单位换算
 *
 * CapCut draft_content.json 使用微秒（μs）作为内部单位：
 *   - 1 秒 = 1,000,000 μs
 *   - 1 帧 @ 30fps = 33,333 μs
 * 我们的 IR 用 {sec, frame} 双单位，compiler 阶段统一转 μs。
 */

const MICROSECONDS_PER_SECOND = 1_000_000;

export function secToFrame(sec: number, fps: number): number {
  return Math.round(sec * fps);
}

export function frameToSec(frame: number, fps: number): number {
  return frame / fps;
}

export function secToMicroseconds(sec: number): number {
  return Math.round(sec * MICROSECONDS_PER_SECOND);
}

export function microsecondsToSec(us: number): number {
  return us / MICROSECONDS_PER_SECOND;
}

export function frameToMicroseconds(frame: number, fps: number): number {
  return secToMicroseconds(frameToSec(frame, fps));
}

export function microsecondsToFrame(us: number, fps: number): number {
  return secToFrame(microsecondsToSec(us), fps);
}

/**
 * 把 TimeCode 标准化为 {sec, frame} 双单位都填好的形式。
 * - 若只有 sec：从 sec 推 frame
 * - 若只有 frame：从 frame 推 sec
 * - 若都有但不一致：以 sec 为准（更精确）
 */
export function normalizeTimeCode(tc: TimeCode, fps: number): Required<TimeCode> {
  return {
    sec: tc.sec,
    frame: tc.frame ?? secToFrame(tc.sec, fps),
  };
}

/**
 * 解析 Gemini 输出的 "MM:SS" / "MM:SS.ms" / "M:SS.s" 时间字符串为秒
 */
export function parseGeminiTimestamp(s: string): number {
  const trimmed = s.trim();
  // MM:SS or MM:SS.ms or HH:MM:SS.ms
  const parts = trimmed.split(":").map((p) => parseFloat(p));
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  // 纯秒
  const n = parseFloat(trimmed);
  if (!Number.isNaN(n)) return n;
  throw new Error(`unparseable Gemini timestamp: "${s}"`);
}

/**
 * 把秒数格式化为 Gemini 风格的 "MM:SS.ms"
 */
export function formatToMmSs(sec: number): string {
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}

/**
 * 把 TimeCode 转成 CapCut μs（compiler 用）
 */
export function timeCodeToCapCutMicroseconds(tc: TimeCode, fps: number): number {
  if (tc.frame !== undefined) {
    return frameToMicroseconds(tc.frame, fps);
  }
  return secToMicroseconds(tc.sec);
}
