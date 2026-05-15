import { Pool } from "undici";
import { UrlAllowlistError } from "./error";
import type { UrlAllowlist } from "./types";

/**
 * P3 #2 phase 3 commit 3/6 (W3 verdict 9154701 C1 approved · 2026-05-15)
 *
 * `fetchWithAllowlist(url, allowlist, init?)` —— SSRF-aware fetch helper。
 *
 * **DNS rebinding 防御原理**：
 * 1. `allowlist.checkAsync(url)` 同步 check + DNS resolve + 每 IP 私段校验
 * 2. 拿到 `resolvedAddresses`,**fetch 不能再走系统 DNS resolver**（否则二次
 *    resolve 时攻击者已 rebind 到内网 IP 绕 step 1 防御）
 * 3. 改用 undici `Pool` 把 connection origin 锁到 resolved IP literal,
 *    `connect.servername` 保留原 hostname → TLS SNI 正确（不会 cert fail）
 * 4. fetch URL 用原 hostname → `Host:` HTTP header 自动正确（virtual host routing）
 *
 * **per-call Pool + finally close**（W3 C1 补充约束：避免泄漏回归）：
 * - 简单可靠,无共享池状态
 * - perf cost: 每次 fetch 建 connection（无 keep-alive 复用）
 * - phase 3.5 caller 如需 shared Pool 自行管理（W3 不阻塞建议 §2）
 *
 * **Throws `UrlAllowlistError`** 当 allowlist deny（任何 deny reason）。
 * caller 用 `instanceof UrlAllowlistError` + `.reason` 区分处理。
 *
 * **Node 版本**: 本机 Node 22 LTS（undici bundled),CI 待 phase 3.5 wire 时 verify Node 20。
 */
export async function fetchWithAllowlist(
  url: string,
  allowlist: UrlAllowlist,
  init?: RequestInit,
): Promise<Response> {
  const check = await allowlist.checkAsync(url);
  if (!check.ok) {
    // commit 3/6: error 暂用 2-arg constructor;commit 4/6 扩 resolvedIp 字段后升级
    throw new UrlAllowlistError(check.reason, url);
  }

  const { parsed, resolvedAddresses } = check;
  if (resolvedAddresses.length === 0) {
    // blockPrivateIps=false 路径下 resolvedAddresses 为空,降级走普通 fetch（dev
    // opt-out 场景）。生产 blockPrivateIps=true 不会进入此分支。
    return fetch(url, init);
  }

  const ip = pickPreferredIp(resolvedAddresses);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const isIpv6 = ip.includes(":");
  const ipLiteral = isIpv6 ? `[${ip}]` : ip;
  const origin = `${parsed.protocol}//${ipLiteral}:${port}`;

  const pool = new Pool(origin, {
    connect: { servername: parsed.hostname },
  });

  try {
    // undici extends fetch with dispatcher option (not in standard Web fetch types).
    const response = await fetch(url, {
      ...init,
      // @ts-expect-error dispatcher is undici-specific extension
      dispatcher: pool,
    });
    return response;
  } finally {
    // 不 await close —— 让 caller 决定是否等待资源回收（且 close 内部已 dispatch）
    void pool.close().catch(() => {
      // swallow close error;主 fetch 已 done,泄漏一个 pool 比让 caller 拿不到 response 安全
    });
  }
}

function pickPreferredIp(addresses: string[]): string {
  // IPv4 优先（与 Node default getaddrinfo `ipv4first` 行为一致,稳）
  const v4 = addresses.find((ip) => !ip.includes(":"));
  if (v4) return v4;
  const fallback = addresses[0];
  if (!fallback) {
    throw new Error("fetchWithAllowlist: empty resolvedAddresses (internal bug)");
  }
  return fallback;
}
