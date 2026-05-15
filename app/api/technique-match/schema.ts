import { z } from "zod";

/**
 * technique-match 路由的请求体校验 schema。
 *
 * 单独成模块：Next.js App Router 的 `route.ts` 只允许导出路由处理器与
 * 路由段配置，任何其它具名导出都会让 `.next/types` 校验报 TS2344。
 * 把 schema 抽到同目录 `schema.ts`，route 与测试都从这里 import。
 */

const MAX_VIDEOS = 6;

/**
 * Task 14 收紧：移除 Task 1 引入的 `videoUrl ⇄ videoUrls` backward-compat
 * shim。`videoUrls` 改必填数组（min 1 / max 6），前端 `useAnalyzeStream` 早已
 * 纯数组发送，旧客户端不存在（preview 每次 deploy 重 hash）。
 */
export const Schema = z.object({
  videoUrls: z.array(z.string().url()).min(1).max(MAX_VIDEOS),
  topic: z.string().max(200).optional().default(""),
  intent: z.string().max(500).optional().default(""),
  videoId: z.string().max(120).optional(),
});
