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
 */
export const VERCEL_BLOB_PRESET: UrlAllowlistOpts = {
  allowedSchemes: ["https:"],
  allowedHosts: [{ suffix: ".public.blob.vercel-storage.com" }],
  blockPrivateIps: true,
};

/**
 * TikTok / Instagram 社交视频 CDN preset —— phase 2.5 修 phase 2 hidden
 * regression：`app/api/account-profile/route.ts:127` 调 `analyzeAccountTopVideo`
 * 时传 `top1.videoDownloadUrl`（Apify scrape 输出），实际 host 是 TT/IG 媒体
 * CDN，不是 Vercel Blob，**phase 2 用 VERCEL_BLOB_PRESET 必中 `host_denied`**。
 *
 * 5 个 host suffix 来源：
 * 1. `next.config.ts:6-9` images.remotePatterns（生产 Next/Image 优化已用）
 *    - `**.tiktokcdn.com` / `**.tiktokcdn-us.com` / `**.cdninstagram.com` / `**.fbcdn.net`
 * 2. `lib/account-profile/scrape.ts:64-67` `videoDownloadUrl = downloadAddr || playAddr`
 *    （TikTok 走 downloadAddr，IG/Reels 走 playAddr）
 * 3. **pre-commit sample-verify** （2026-05-15 W3 verdict §D 要求）：跑
 *    `data/scraped/enriched-2026-04-29.json` 299 条 cover URL host 分布——
 *    发现 `*.tiktokcdn-eu.com` (10 hits) **不在** W3 phase 2.5 verdict 原 4 host 内,
 *    sample-verify 防止 phase 2.5 merge 后 EU 区 TikTok 创作者 100% 静默失败 →
 *    扩到 5 host
 *
 * Host 分布（sample 299 trending entries）：
 *   tiktokcdn-us.com  = 160（TT 美国区主 CDN）
 *   cdninstagram.com  = 119（IG 静态资源）
 *   tiktokcdn.com     =  10（TT 全球主 CDN）
 *   tiktokcdn-eu.com  =  10（TT 欧洲区独立域）← sample-verify 发现
 *   fbcdn.net         =   0（sample 缺,信 next.config.ts 留 IG 视频 CDN 兜底）
 *
 * **每个 suffix 都以 "." 开头**——`HostPattern.suffix` 同时允许根域 + 子域,
 * 与 `VERCEL_BLOB_PRESET` 一致。强制 https + 阻私有 IP 与生产 CDN 实际行为吻合。
 */
export const TIKTOK_INSTAGRAM_CDN_PRESET: UrlAllowlistOpts = {
  allowedSchemes: ["https:"],
  allowedHosts: [
    { suffix: ".tiktokcdn.com" },
    { suffix: ".tiktokcdn-us.com" },
    { suffix: ".tiktokcdn-eu.com" },
    { suffix: ".cdninstagram.com" },
    { suffix: ".fbcdn.net" },
  ],
  blockPrivateIps: true,
};
