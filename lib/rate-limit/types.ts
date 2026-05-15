import { z } from "zod";

/**
 * P3 #3 phase 1: rate-limit primitive lib。
 *
 * 公共类型 + Zod schema。lib 层只导出 primitive,phase 2 (W1 owner) 在路由层 wire。
 */

/** 固定 enum,避开自己 parse —— 与 @upstash/ratelimit Duration 子集对齐。 */
export type RateLimitWindow =
  | "1 s"
  | "10 s"
  | "1 m"
  | "10 m"
  | "1 h"
  | "1 d";

export const WINDOW_VALUES = [
  "1 s",
  "10 s",
  "1 m",
  "10 m",
  "1 h",
  "1 d",
] as const satisfies readonly RateLimitWindow[];

export type RateLimitAlgorithm = "sliding" | "fixed";

export type RateLimiterOpts = {
  /** 命名空间前缀,e.g. "trending-get"。落到 Upstash key prefix / memory 状态分桶。 */
  identifier: string;
  /** 窗口内最大次数。 */
  limit: number;
  /** 时间窗口,固定 enum。 */
  window: RateLimitWindow;
  /** 默认 sliding。 */
  algorithm?: RateLimitAlgorithm;
};

export type RateLimitResult = {
  /** 通过 = true,被限流 = false。 */
  success: boolean;
  /** 当前限流上限,原样回显。 */
  limit: number;
  /** 通过后剩余配额;blocked 时 = 0。 */
  remaining: number;
  /** 下次窗口重置 epoch ms (sliding = 当前最早请求过期时刻;fixed = 窗口结束时刻)。 */
  reset: number;
};

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

/**
 * 入参校验 schema —— 防止 misconfigure(limit 负数 / identifier 空 / window 非法)。
 * 通过 z.enum 锁住 window 枚举与 RateLimitWindow 一致。
 */
export const RateLimiterOptsSchema = z.object({
  identifier: z.string().min(1, "identifier required"),
  limit: z.number().int().positive("limit must be a positive integer"),
  window: z.enum(WINDOW_VALUES),
  algorithm: z.enum(["sliding", "fixed"]).optional(),
});

/**
 * Backend 协议 —— in-memory 与 Upstash 适配器都实现这个接口。
 * windowMs 给 in-memory 用,windowSpec 给 Upstash 原样喂(它内部接 string Duration)。
 */
export type BackendCheckInput = {
  identifier: string;
  key: string;
  limit: number;
  windowMs: number;
  windowSpec: RateLimitWindow;
  algorithm: RateLimitAlgorithm;
};

export interface RateLimitBackend {
  check(input: BackendCheckInput): Promise<RateLimitResult>;
}
