import { z } from "zod";

/**
 * technique-match 路由的请求体校验 schema。
 *
 * 单独成模块：Next.js App Router 的 `route.ts` 只允许导出路由处理器与
 * 路由段配置，任何其它具名导出都会让 `.next/types` 校验报 TS2344。
 * 把 schema 抽到同目录 `schema.ts`，route 与测试都从这里 import。
 */

const MAX_VIDEOS = 6;

const InputSchema = z.object({
  videoUrl: z.string().url(),
  /** 多视频改造：新增 optional 数组字段，旧客户端不发也不影响 */
  videoUrls: z.array(z.string().url()).min(1).max(MAX_VIDEOS).optional(),
  topic: z.string().max(200).optional().default(""),
  intent: z.string().max(500).optional().default(""),
  videoId: z.string().max(120).optional(),
});

/**
 * C1 兼容层：videoUrl ⇄ videoUrls 双向归一。
 * preprocess 在校验前补全缺失的一侧 —— 旧客户端只发 `videoUrl`、
 * 新客户端发 `videoUrls`，两种请求体都能通过校验。`videoUrl` 保持必填
 * （preprocess 已保证它对任何合法输入都被填上），现有运行逻辑无需改动。
 */
export const Schema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const next: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(next.videoUrls) && next.videoUrls.length > 0) {
    if (next.videoUrl === undefined) next.videoUrl = next.videoUrls[0];
  } else if (typeof next.videoUrl === "string") {
    if (next.videoUrls === undefined) next.videoUrls = [next.videoUrl];
  }
  return next;
}, InputSchema);
