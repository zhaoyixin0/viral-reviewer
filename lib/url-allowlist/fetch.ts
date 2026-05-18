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
    throw new UrlAllowlistError(check.reason, url, {
      resolvedIp: check.resolvedIp,
      cause: check.cause,
    });
  }

  const { parsed, resolvedAddresses } = check;
  if (resolvedAddresses.length === 0) {
    // blockPrivateIps=false 路径下 resolvedAddresses 为空,降级走普通 fetch（dev
    // opt-out 场景）。生产 blockPrivateIps=true 不会进入此分支。
    return fetch(url, init);
  }

  // 2026-05-18: GCS bypass for IP-locked dispatcher.
  // 现象: undici 7.25 + IP-literal Pool origin + storage.googleapis.com 一律 404
  //       (technique-match / compile-capcut / template-brief / ffmpeg 全部命中)；
  //       同 URL anonymous plain HTTPS HEAD 返回 200，文件确实在 bucket。
  // 评估: GCS 是我方写入的 bucket（path-style + UBLA public read），URL 由 lib/storage
  //       signed POST 生成，attacker 无法注入；pre-stream allowlist.checkAsync 已 resolve
  //       DNS 防 SSRF。in-stream IP-lock 二次防御原意是防 DNS rebind 时间窗 attack，但
  //       attacker 必须能改 storage.googleapis.com 的 authoritative DNS 记录才能 rebind ——
  //       不现实。降级 plain fetch 是 acceptable trade-off。
  if (
    parsed.hostname === "storage.googleapis.com" ||
    parsed.hostname.endsWith(".storage.googleapis.com")
  ) {
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
