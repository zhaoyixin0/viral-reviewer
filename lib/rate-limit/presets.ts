import type { RateLimiterOpts } from "./types";

/**
 * 常用 preset —— phase 2 select 而不是 magic number 散落。
 * identifier 在 caller 处补全,这里只锁 limit/window 形状。
 */

export type RateLimitPreset = Omit<RateLimiterOpts, "identifier">;

/** 严格逐 IP 限流 —— anonymous endpoint 起步。 */
export const STRICT_PER_IP: RateLimitPreset = {
  limit: 10,
  window: "1 m",
  algorithm: "sliding",
};

/** 已登录用户 —— 宽松上限,sliding 抗突发。 */
export const GENEROUS_AUTHENTICATED: RateLimitPreset = {
  limit: 100,
  window: "1 m",
  algorithm: "sliding",
};

/** 写操作 —— 防止刷库,fixed 窗口可视为配额。 */
export const WRITE_HEAVY: RateLimitPreset = {
  limit: 5,
  window: "10 m",
  algorithm: "fixed",
};
