import { z } from "zod";

/**
 * /api/trending GET 查询参数校验。
 *
 * 单独成模块：Next.js App Router 的 `route.ts` 只允许导出路由处理器与
 * 路由段配置，schema 抽出避免污染路由模块导出面。
 */
export const TrendingQuerySchema = z.object({
  /** 缺失 = 不过滤（返回全部平台）。 */
  platform: z.enum(["tiktok", "instagram"]).optional(),
});

export type TrendingQuery = z.infer<typeof TrendingQuerySchema>;
