import { safeResolveIp } from "./dns-resolve";
import { matchHost } from "./host-match";
import { isPrivateIpString } from "./private-ip";
import {
  UrlAllowlistOptsSchema,
  type UrlAllowlist,
  type UrlAllowlistAsyncResult,
  type UrlAllowlistOpts,
  type UrlAllowlistResult,
} from "./types";

const DEFAULT_SCHEMES: readonly string[] = ["https:"];

/**
 * Public entry —— phase 2 (W1 owner) 在路由层调本函数,phase 1 lib 不
 * 被任何 `app/**` 文件 import。
 *
 * createUrlAllowlist(opts):
 *   - Zod 校验 opts（misconfigure → throw,与 rate-limit 风格对齐）
 *   - `allowedSchemes` default = `["https:"]`（强制 https）
 *   - `blockPrivateIps` default = true
 *   - 返回 `{ check(url) }`:invalid_url / scheme_denied / private_ip /
 *     host_denied / ok（reason 顺序固定,先 parse,后 scheme,后 IP,后 host）
 *
 * **不**做 DNS resolve + IP pinning：phase 1 只校验 URL 字符串层；DNS
 * 解析（绕过 domain → 私有 IP）由 phase 2 caller 按需加 `safeResolveIp`
 * 升级（spec 明示）。
 */
export function createUrlAllowlist(opts: UrlAllowlistOpts): UrlAllowlist {
  const parsed = UrlAllowlistOptsSchema.parse(opts);
  const schemes = normalizeSchemes(parsed.allowedSchemes ?? DEFAULT_SCHEMES);
  const blockPrivateIps = parsed.blockPrivateIps ?? true;
  const hosts = parsed.allowedHosts;

  const check = (url: string): UrlAllowlistResult => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    if (!schemes.includes(parsedUrl.protocol.toLowerCase())) {
      return { ok: false, reason: "scheme_denied" };
    }
    const host = parsedUrl.hostname;
    if (blockPrivateIps && isPrivateIpString(host)) {
      return { ok: false, reason: "private_ip" };
    }
    if (!hosts.some((p) => matchHost(host, p))) {
      return { ok: false, reason: "host_denied" };
    }
    return { ok: true, parsed: parsedUrl };
  };

  /**
   * Phase 3: sync check 通过后,DNS resolve hostname 并对**每个** A/AAAA IP 调
   * `isPrivateIpString`。任一私 IP → `resolved_private_ip` 拒绝（含 IPv6 私段:
   * ::1 / fc00::/7 / fe80::/10 / ::ffff:N.N.N.N mapped）。
   *
   * - `blockPrivateIps=false` 时跳过 DNS check（dev / opt-out 场景一致）
   * - `safeResolveIp` 失败 → `dns_resolve_failed`,caller 可重试（transient）
   * - success 返 `resolvedAddresses` 数组,caller 用 `fetchWithAllowlist` 直连
   *   避免 fetch 二次 resolve = rebinding 攻击窗
   */
  const checkAsync = async (url: string): Promise<UrlAllowlistAsyncResult> => {
    const sync = check(url);
    if (!sync.ok) {
      return { ok: false, reason: sync.reason };
    }
    if (!blockPrivateIps) {
      return { ok: true, parsed: sync.parsed, resolvedAddresses: [] };
    }
    const hostname = sync.parsed.hostname;
    const stripped = hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
    // 短路：hostname 本身已是 IP 字面（sync check 已拒私 IP；此处只是 public IP literal,
    // 无需 DNS resolve）→ 直接 ok,resolvedAddresses 用 hostname 自己（caller 复用）。
    if (isIpLiteral(stripped)) {
      return { ok: true, parsed: sync.parsed, resolvedAddresses: [stripped] };
    }
    const resolved = await safeResolveIp(hostname);
    if (!resolved.ok) {
      return { ok: false, reason: "dns_resolve_failed", cause: resolved.cause };
    }
    for (const ip of resolved.addresses) {
      if (isPrivateIpString(ip)) {
        return {
          ok: false,
          reason: "resolved_private_ip",
          resolvedIp: ip,
        };
      }
    }
    return { ok: true, parsed: sync.parsed, resolvedAddresses: resolved.addresses };
  };

  return { check, checkAsync };
}

function isIpLiteral(host: string): boolean {
  // IPv4 dotted-quad 或 IPv6 hex (含 `:` 或 `.`)。`host` 已 strip brackets。
  // 不需要严格校验合法性,只要"looks like IP" 即跳过 DNS resolve。
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":");
}

/**
 * scheme 归一化 —— caller 传 `"https"` 或 `"https:"` 都接受,内部统一
 * 加 trailing colon 后跟 `URL.protocol` 比对（`URL.protocol` 永远带
 * trailing colon,小写）。
 */
function normalizeSchemes(input: readonly string[]): string[] {
  return input.map((s) => {
    const lo = s.toLowerCase();
    return lo.endsWith(":") ? lo : lo + ":";
  });
}

export { VERCEL_BLOB_PRESET, TIKTOK_INSTAGRAM_CDN_PRESET } from "./presets";
export { matchHost } from "./host-match";
export { isPrivateIpString } from "./private-ip";
export { safeResolveIp } from "./dns-resolve";
export { fetchWithAllowlist } from "./fetch";
export { UrlAllowlistError } from "./error";
export type {
  HostPattern,
  UrlAllowlist,
  UrlAllowlistAsyncResult,
  UrlAllowlistDenyReason,
  UrlAllowlistOpts,
  UrlAllowlistResult,
} from "./types";
export type { SafeResolveResult } from "./dns-resolve";
