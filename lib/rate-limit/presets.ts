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

/**
 * 匿名 AI 推理类 —— Claude / Anthropic 计费 API 调用,单请求 5-30s。
 * 10/10m sliding ≈ 1 req/min/IP 平均;日上限 ~144/IP ~$7 Anthropic 成本。
 * sliding 算法对突发友好(用户连续 brainstorm 不卡)。
 *
 * 数字来源：保守起步,1 周后 Vercel Logs 观察 429 命中率 + 单 IP 实际峰值后调整(follow-up PR)。
 */
export const ANON_AI_HEAVY: RateLimitPreset = {
  limit: 10,
  window: "10 m",
  algorithm: "sliding",
};

/**
 * Stream 类 —— NDJSON 长连接 + Apify scrape + Claude analyze + frame extract,
 * 单请求 30-60s 长占用 server 时间。3/10m fixed:
 * - fixed 算法:避免长 stream 期间 sliding 窗口漂移误判
 * - 3 上限:同一 IP 30min 内最多 9 次,stream-heavy 不应高频
 *
 * 数字来源:保守起步同上。
 */
export const STREAM_HEAVY: RateLimitPreset = {
  limit: 3,
  window: "10 m",
  algorithm: "fixed",
};

/**
 * 上传突发 —— signed-upload lifecycle 每文件 2 次 route hit(phase 1 sign +
 * phase 3 completion ping)。technique-match 6-file 并行 = 12 requests in
 * ~30-90s 窗口;BriefUploader 单文件 = 2 requests。STRICT_PER_IP 10/1m
 * blocks W1 BLOCKER (2026-05-17 post-cutover bug hunt finding B1)。
 *
 * 24/1m sliding cover:
 * - MAX_FILES = 6 × 2 hits = 12 baseline
 * - 2× headroom for legit retry / page reload mid-upload
 * - sliding 不让长上传 stale phase 1 token 浪费 quota
 */
export const UPLOAD_BURST: RateLimitPreset = {
  limit: 24,
  window: "1 m",
  algorithm: "sliding",
};
