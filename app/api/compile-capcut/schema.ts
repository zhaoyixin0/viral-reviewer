import { z } from "zod";

/**
 * compile-capcut 路由的请求体校验 schema。
 *
 * 单独成模块：Next.js App Router 的 `route.ts` 只允许导出路由处理器与
 * 路由段配置，任何其它具名导出都会让 `.next/types` 校验报 TS2344。
 * 把 schema 抽到同目录 `schema.ts`，route 与测试都从这里 import。
 */

const MAX_VIDEOS = 6;

const videoFileNameField = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^/\\]+$/, "视频文件名不能包含路径分隔符");

/**
 * Task 14 收紧：移除 Task 1 引入的 `videoUrl/videoFileName` 单值 backward-compat
 * shim。`videoUrls` 改必填数组、`videoFileNames` 保 optional（缺失下游退化
 * 为 input.mp4）。等长 refine 保留——两数组都给时按 index 对齐取文件名。
 */
export const RequestSchema = z
  .object({
    projectName: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[^\\/:*?"<>|]+$/, "项目名包含非法字符"),
    videoUrls: z.array(z.string().url()).min(1).max(MAX_VIDEOS),
    /** 用户上传的原始视频文件名（可选；缺失则退化为 input.mp4）。
     *  regex 在 Zod 层就拒绝路径分隔符，让服务端校验边界自身成立，
     *  不单点依赖 sanitizeVideoFileName。浏览器 File.name 永远是 basename，
     *  合法请求不含分隔符，不受影响。 */
    videoFileNames: z.array(videoFileNameField).max(MAX_VIDEOS).optional(),
    /** Phase 5.5：可选 BGM 文件 URL（Vercel Blob 上传后的 URL） */
    bgmUrl: z.string().url().nullable().optional(),
    userPotential: z.unknown(),
    match: z.unknown(),
  })
  .refine(
    (d) => !d.videoFileNames || d.videoUrls.length === d.videoFileNames.length,
    {
      // 跨字段不变量：两个数组都给时必须等长，否则下游按 index 取文件名会越界。
      message: "videoFileNames 长度必须与 videoUrls 一致",
      path: ["videoFileNames"],
    },
  );
