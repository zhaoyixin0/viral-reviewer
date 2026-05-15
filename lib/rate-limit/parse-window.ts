import type { RateLimitWindow } from "./types";

/**
 * 固定 6 个 window 的精确 ms 映射 —— 不做通用 parser(避免歧义 "1m" vs "1 m")。
 * 与 @upstash/ratelimit 的 Duration 子集对齐;memory backend 滚窗时用。
 */
const WINDOW_MS: Record<RateLimitWindow, number> = {
  "1 s": 1_000,
  "10 s": 10_000,
  "1 m": 60_000,
  "10 m": 600_000,
  "1 h": 3_600_000,
  "1 d": 86_400_000,
};

export function windowToMs(window: RateLimitWindow): number {
  return WINDOW_MS[window];
}
