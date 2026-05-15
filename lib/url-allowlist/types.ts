import { z } from "zod";

/**
 * P3 #2 phase 1: SSRF allowlist primitive lib。
 *
 * 公共类型 + Zod schema。lib 层只导出 primitive,phase 2 (W1 owner) 在路由
 * 层 wire。与 `lib/rate-limit/types.ts` peer,跟 `isVercelBlobUrl`
 * 旧实现等价（通过 VERCEL_BLOB_PRESET）。
 */

/**
 * Host 白名单匹配规则。三种 case：
 * - `string`：精确小写比较 (exact match,case-insensitive)
 * - `RegExp`：直接 `.test(host)`（caller 自行决定锚定 / 大小写）
 * - `{ suffix: ".example.com" }`：同时允许根域 `"example.com"` 和子域
 *   `"a.example.com"`（spec 行为：`host === suffix.slice(1) || host.endsWith(suffix)`）
 */
export type HostPattern = string | RegExp | { suffix: string };

export type UrlAllowlistOpts = {
  /** 允许的 URL scheme,大小写不敏感。default = `["https:"]`（生产强制 https）。 */
  allowedSchemes?: string[];
  /** Host 白名单,至少 1 条。空数组无意义（拒绝所有）→ Zod 校验抛错。 */
  allowedHosts: HostPattern[];
  /**
   * literal IP host 命中私有 / loopback / link-local 段 → 拒绝。default = true。
   * 防御 caller 手喂 `127.0.0.1` / `169.254.169.254`（云元数据）/ `[::1]` 绕过 host allowlist。
   */
  blockPrivateIps?: boolean;
};

export type UrlAllowlistDenyReason =
  | "invalid_url"
  | "scheme_denied"
  | "host_denied"
  | "private_ip";

export type UrlAllowlistResult =
  | { ok: true; parsed: URL }
  | { ok: false; reason: UrlAllowlistDenyReason };

export interface UrlAllowlist {
  check(url: string): UrlAllowlistResult;
}

/**
 * HostPattern 联合含 `RegExp` 实例,Zod 没原生 RegExp schema,改用
 * `z.custom` 守住三种 case 的结构合法性。`z.custom` 不 transform,
 * RegExp 实例 parse 后保持原引用。
 */
const hostPatternSchema = z.custom<HostPattern>(
  (val) => {
    if (typeof val === "string") return val.length > 0;
    if (val instanceof RegExp) return true;
    if (typeof val === "object" && val !== null) {
      const sfx = (val as { suffix?: unknown }).suffix;
      return typeof sfx === "string" && sfx.length > 0;
    }
    return false;
  },
  { message: "host pattern must be non-empty string, RegExp, or { suffix }" },
);

/**
 * Opts 入口校验 —— misconfigure 开发期就崩,跟 `rate-limit`
 * `RateLimiterOptsSchema` 一致风格。`createUrlAllowlist` 内部 `.parse()` 抛错。
 *
 * - `allowedSchemes`:可选,每个元素非空。check() 内做 colon 归一化（"https" → "https:"）。
 * - `allowedHosts`:必填,`.min(1)` 拒绝空数组。
 * - `blockPrivateIps`:可选 boolean,default true（在 index.ts 应用）。
 */
export const UrlAllowlistOptsSchema = z.object({
  allowedSchemes: z.array(z.string().min(1, "scheme must be non-empty")).min(1).optional(),
  allowedHosts: z.array(hostPatternSchema).min(1, "allowedHosts must not be empty"),
  blockPrivateIps: z.boolean().optional(),
});
