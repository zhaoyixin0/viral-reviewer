import { z } from "zod";

/**
 * /api/upload 的 clientPayload 防御性校验。
 *
 * 截至 2026-05-14 sweep（components/technique-match/{InputPanel,CapCutExport}.tsx
 * + components/review/InputPanel.tsx），所有 `upload()` 调用方都未传 `clientPayload`，
 * 故服务端 `onBeforeGenerateToken` 收到的是 `null`（@vercel/blob 类型签名
 * `clientPayload: string | null`）。
 *
 * 校验为 `z.null()` 的目的是**护栏**：任何未来对 `clientPayload` 的消费都必须
 * 先在此 schema 里加 `z.string()` / `JSON.parse` + 业务字段 schema，
 * **严禁**在 `onBeforeGenerateToken` 直接 access `clientPayload` 字符串内容。
 */
export const ClientPayloadSchema = z.null();
