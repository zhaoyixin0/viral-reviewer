import type { UrlAllowlistOpts } from "./types";

/**
 * Vercel Blob 公共域 preset —— `isVercelBlobUrl` 旧实现（template-brief
 * route.ts:158-165）的语义升级版：
 *
 * - hostname：`{ suffix: ".public.blob.vercel-storage.com" }` 同时允许
 *   根域 `public.blob.vercel-storage.com` 和子域 `xxx.public.blob...`
 *   （旧 `endsWith(".public.blob...")` 只允许子域,根域不通过；新 suffix
 *   pattern 行为参考 spec：`host === sfx.slice(1) || host.endsWith(sfx)`）
 * - `allowedSchemes: ["https:"]` —— 旧实现未校验 scheme,新 lib 强制 https
 *   防御 `http://attacker.public.blob...`（理论上 Vercel Blob 只走 https,
 *   但明示锁死更稳）
 * - `blockPrivateIps: true` —— Vercel Blob CDN 实际不会是私有 IP,防御性开
 *
 * **只导出这一个 preset**。`technique-match` videoUrls / `assets.ts` /
 * `ffmpeg.ts` 的 host 列表由 W1 phase 2 wiring 时按实际 CDN 域决定,
 * phase 1 不预判。
 */
export const VERCEL_BLOB_PRESET: UrlAllowlistOpts = {
  allowedSchemes: ["https:"],
  allowedHosts: [{ suffix: ".public.blob.vercel-storage.com" }],
  blockPrivateIps: true,
};
