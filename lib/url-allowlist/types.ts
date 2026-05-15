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
  | "private_ip"
  // Phase 3 (DNS rebinding 防御): hostname DNS resolve 失败（NXDOMAIN /
  // SERVFAIL / timeout / 空 records 等)。transient,caller 可指数退避重试。
  | "dns_resolve_failed"
  // Phase 3: DNS 解析到的 IP 命中私段（含 IPv6 / IPv4-mapped IPv6）。
  // **security event**,caller 必须 log / alert,绝不重试。
  | "resolved_private_ip";

export type UrlAllowlistResult =
  | { ok: true; parsed: URL }
  | { ok: false; reason: UrlAllowlistDenyReason };

/**
 * Phase 3 async result —— `checkAsync` 在 sync check 通过后做 DNS resolve
 * + private-IP check。success 带 `resolvedAddresses` 供 phase 3.5
 * `fetchWithAllowlist` 复用（避 fetch 二次 resolve = DNS rebinding 攻击窗）。
 *
 * - `resolved_private_ip`：reason 附 `resolvedIp` 指明哪个 IP 触发拒绝（log/alert）
 * - `dns_resolve_failed`：reason 附 `cause` 字符串（NXDOMAIN / SERVFAIL / timeout 等）
 * - 其他 sync deny reason（invalid_url / scheme_denied / host_denied / private_ip）
 *   不附 resolved fields（DNS 阶段未达）
 */
export type UrlAllowlistAsyncResult =
  | { ok: true; parsed: URL; resolvedAddresses: string[] }
  | {
      ok: false;
      reason: UrlAllowlistDenyReason;
      resolvedIp?: string;
      cause?: string;
    };

export interface UrlAllowlist {
  check(url: string): UrlAllowlistResult;
  /**
   * Phase 3 (P3 #2 DNS rebinding 防御 · 2026-05-15)：sync check 通过后调
   * `safeResolveIp(hostname)` + `isPrivateIpString` 逐 IP 检 → 拦截 DNS
   * 漂移到私有 IP 的 SSRF 攻击。fetch 必须用返回的 `resolvedAddresses`
   * 直连（不能让 fetch 二次 DNS resolve）—— 推荐 `fetchWithAllowlist` helper。
   */
  checkAsync(url: string): Promise<UrlAllowlistAsyncResult>;
}

/**
 * HostPattern 联合含 `RegExp` 实例,Zod 没原生 RegExp schema,改用
 * `z.custom` 守住三种 case 的结构合法性。`z.custom` 不 transform,
 * RegExp 实例 parse 后保持原引用。
 *
 * **`{ suffix }` 前导点强校验**（phase 1 nit cleanup,2026-05-15）：
 * suffix 必须以 `.` 开头,否则视为配置错误抛错。理由：
 * - matchHost 行为 `host === sfx.slice(1) || host.endsWith(sfx)` 假定 leading dot
 *   存在；不带点会切掉合法 hostname 字符（如 `"tiktokcdn.com".slice(1) = "iktokcdn.com"`）
 *   生成歧义比对
 * - host suffix 比对的 SSRF 防御语义里 leading-dot 是 standard 约定
 *   （RFC 6265 cookie domain / nginx server_name 都强制前导点）
 */
const hostPatternSchema = z.custom<HostPattern>(
  (val) => {
    if (typeof val === "string") return val.length > 0;
    if (val instanceof RegExp) return true;
    if (typeof val === "object" && val !== null) {
      const sfx = (val as { suffix?: unknown }).suffix;
      return typeof sfx === "string" && sfx.length > 0 && sfx.startsWith(".");
    }
    return false;
  },
  {
    message:
      "host pattern must be a non-empty string, a RegExp, or { suffix: \".name\" } " +
      "with a leading '.' (suffix without leading dot is ambiguous — use \".example.com\" not \"example.com\")",
  },
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
