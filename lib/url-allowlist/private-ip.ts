/**
 * literal IP 私有段检测 —— 防御 hostname allowlist 的 IP 直接绕过。
 * domain (非 IP) 返回 false → caller 走 HostPattern 检查路径。
 *
 * **IPv4 覆盖**（私有 / loopback / link-local / unspecified / broadcast）：
 *   - `10.0.0.0/8`           private
 *   - `172.16.0.0/12`        private（172.16.x ~ 172.31.x）
 *   - `192.168.0.0/16`       private
 *   - `127.0.0.0/8`          loopback
 *   - `169.254.0.0/16`       link-local（含云元数据 `169.254.169.254`）
 *   - `0.0.0.0/8`            unspecified / source
 *   - `255.255.255.255`      limited broadcast
 *
 * **IPv6 覆盖**：
 *   - `::1`                  loopback
 *   - `::`                   unspecified
 *   - `fc00::/7`             unique local（fc / fd 起首）
 *   - `fe80::/10`            link-local（fe80 ~ febf）
 *
 * **IPv4-mapped IPv6**（phase 1 nit cleanup,2026-05-15）：
 *   - `::ffff:N.N.N.N` dotted-quad 形态 → strip `::ffff:` 前缀后复用 IPv4 私段表
 *   - 防御 caller 拿 `https://[::ffff:169.254.169.254]/` 绕过 host allowlist 直击
 *     云元数据
 *   - 不覆盖 hex-encoded mapped 形（`::ffff:7f00:1`）—— 实际攻击者用 dotted-quad
 *     更常见,hex 形留 phase 3 ipaddr.js 一起处理
 *
 * **不覆盖**（phase 1 范围外）：
 *   - DNS resolve 后的 IP（spec 明示 phase 1 不做 DNS lookup,留 phase 3 加 `safeResolveIp`）
 *   - hex-encoded IPv4-mapped IPv6（`::ffff:7f00:1`）
 *   - 路由层 IP 字面（这里只做 host string 层）
 */
export function isPrivateIpString(host: string): boolean {
  // URL.hostname 对 IPv6 字面会去 `[]`,但防御性兼容 caller 传带括号的 host
  const stripped = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

  // IPv4-mapped IPv6 dotted-quad 形：`::ffff:N.N.N.N` → strip 前缀后走 IPv4 检测。
  // case-insensitive 因 IPv6 允许大写 hex（`::FFFF:1.2.3.4`）。
  const lower = stripped.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const v4 = stripped.slice("::ffff:".length);
    if (looksLikeIpv4(v4)) {
      return isPrivateIpv4(v4);
    }
    // 非 dotted-quad 形（如 `::ffff:7f00:1`）落入下方 IPv6 路径处理
  }

  if (looksLikeIpv4(stripped)) {
    return isPrivateIpv4(stripped);
  }
  if (looksLikeIpv6(stripped)) {
    return isPrivateIpv6(stripped);
  }
  return false;
}

function looksLikeIpv4(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s);
}

function isPrivateIpv4(s: string): boolean {
  const parts = s.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4) return false;
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (parts.every((p) => p === 255)) return true;
  return false;
}

function looksLikeIpv6(s: string): boolean {
  if (!s.includes(":")) return false;
  return /^[0-9a-f:]{2,39}$/i.test(s);
}

function isPrivateIpv6(s: string): boolean {
  const lo = s.toLowerCase();
  if (lo === "::1" || lo === "::") return true;

  // 取第一段 hextet（`"fc00::1"` → `"fc00"`;`"::1"` 已上面处理）。
  const firstColon = lo.indexOf(":");
  const head = firstColon === -1 ? lo : lo.slice(0, firstColon);
  if (head === "") return false;
  const hex = Number.parseInt(head, 16);
  if (!Number.isFinite(hex) || hex < 0 || hex > 0xffff) return false;

  // `fc00::/7` → top 7 bits = `1111110` → 0xfc00 ~ 0xfdff
  if (hex >= 0xfc00 && hex <= 0xfdff) return true;
  // `fe80::/10` → top 10 bits = `1111111010` → 0xfe80 ~ 0xfebf
  if (hex >= 0xfe80 && hex <= 0xfebf) return true;
  return false;
}
