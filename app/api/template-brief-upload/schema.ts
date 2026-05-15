import { z } from "zod";

/**
 * /api/template-brief-upload 的 clientPayload 防御性校验。
 *
 * 截至 2026-05-14 sweep（components/template-review/BriefUploader.tsx），唯一
 * `upload()` 调用方未传 `clientPayload`，故服务端 `onBeforeGenerateToken` 收到的
 * 是 `null`（@vercel/blob 类型签名 `clientPayload: string | null`）。
 *
 * 校验为 `z.null()` 的目的是**护栏**：任何未来对 `clientPayload` 的消费都必须
 * 先在此 schema 里加 `z.string()` / `JSON.parse` + 业务字段 schema，
 * **严禁**在 `onBeforeGenerateToken` 直接 access `clientPayload` 字符串内容。
 */
export const ClientPayloadSchema = z.null();
