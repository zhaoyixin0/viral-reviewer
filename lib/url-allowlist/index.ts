import { matchHost } from "./host-match";
import { isPrivateIpString } from "./private-ip";
import {
  UrlAllowlistOptsSchema,
  type UrlAllowlist,
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

  return {
    check(url: string): UrlAllowlistResult {
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
    },
  };
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

export { VERCEL_BLOB_PRESET } from "./presets";
export { matchHost } from "./host-match";
export { isPrivateIpString } from "./private-ip";
export type {
  HostPattern,
  UrlAllowlist,
  UrlAllowlistDenyReason,
  UrlAllowlistOpts,
  UrlAllowlistResult,
} from "./types";
