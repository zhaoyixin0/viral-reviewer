import { z } from "zod";

/**
 * /api/template-brief POST 在 JSON 模式（Blob URL 分支）下的请求体校验。
 *
 * multipart/form-data 分支不走本 schema —— 那条路径用 `File` 对象 + 内置
 * mime/size 校验，没有需要 Zod 覆盖的隐式字段表面。
 *
 * SSRF 注意：`z.string().url()` 只校验语法，路由内必须保留 `isVercelBlobUrl`
 * hostname allowlist（严格匹配 `.public.blob.vercel-storage.com`）。本路由
 * 的 hostname allowlist 已比 W1 P3 #2 计划中的通用 SSRF allowlist 更严，
 * 不依赖该 follow-up。
 */
export const TemplateBriefJsonBodySchema = z.object({
  blobUrl: z.string().url(),
  fileName: z.string().min(1).max(255).optional(),
});

export type TemplateBriefJsonBody = z.infer<typeof TemplateBriefJsonBodySchema>;
