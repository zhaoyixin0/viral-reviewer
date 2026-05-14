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

const InputSchema = z.object({
  projectName: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[^\\/:*?"<>|]+$/, "项目名包含非法字符"),
  videoUrl: z.string().url(),
  /** 多视频改造：新增 optional 数组字段，旧客户端不发也不影响 */
  videoUrls: z.array(z.string().url()).min(1).max(MAX_VIDEOS).optional(),
  /** 用户上传的原始视频文件名（可选；缺失则退化为 input.mp4）。
   *  regex 在 Zod 层就拒绝路径分隔符，让服务端校验边界自身成立，
   *  不单点依赖 sanitizeVideoFileName。浏览器 File.name 永远是 basename，
   *  合法请求不含分隔符，不受影响。 */
  videoFileName: videoFileNameField.optional(),
  /** 多视频改造：与 videoUrls 对齐的文件名数组，optional */
  videoFileNames: z.array(videoFileNameField).max(MAX_VIDEOS).optional(),
  /** Phase 5.5：可选 BGM 文件 URL（Vercel Blob 上传后的 URL） */
  bgmUrl: z.string().url().nullable().optional(),
  userPotential: z.unknown(),
  match: z.unknown(),
});

/**
 * C1 兼容层：videoUrl ⇄ videoUrls、videoFileName ⇄ videoFileNames 双向归一。
 * preprocess 在校验前补全缺失的一侧 —— 旧客户端只发单值、新客户端发数组，
 * 两种请求体都能通过校验。`videoUrl` 保持必填（preprocess 已保证它对任何
 * 合法输入都被填上），现有运行逻辑无需改动。
 */
export const RequestSchema = z
  .preprocess((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const next: Record<string, unknown> = {
      ...(raw as Record<string, unknown>),
    };
    if (Array.isArray(next.videoUrls) && next.videoUrls.length > 0) {
      if (next.videoUrl === undefined) next.videoUrl = next.videoUrls[0];
    } else if (typeof next.videoUrl === "string") {
      if (next.videoUrls === undefined) next.videoUrls = [next.videoUrl];
    }
    if (Array.isArray(next.videoFileNames) && next.videoFileNames.length > 0) {
      if (next.videoFileName === undefined) {
        next.videoFileName = next.videoFileNames[0];
      }
    } else if (typeof next.videoFileName === "string") {
      if (next.videoFileNames === undefined) {
        next.videoFileNames = [next.videoFileName];
      }
    }
    return next;
  }, InputSchema)
  .refine(
    (d) =>
      !d.videoUrls ||
      !d.videoFileNames ||
      d.videoUrls.length === d.videoFileNames.length,
    {
      // 跨字段不变量：两个数组都给时必须等长，否则下游按 index 取文件名会越界。
      message: "videoFileNames 长度必须与 videoUrls 一致",
      path: ["videoFileNames"],
    },
  );
