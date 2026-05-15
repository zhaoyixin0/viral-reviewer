import { promises as dns } from "node:dns";

/**
 * P3 #2 phase 3 (DNS rebinding 防御 lib · 2026-05-15)
 *
 * `safeResolveIp(hostname)` —— SSRF-aware DNS resolver。
 *
 * **设计决策** (W3 phase 3 scope verdict 9154701 A2+E2 approved)：
 * - 用 `dns.promises.resolve4` + `dns.promises.resolve6`（**不** 用 `dns.lookup`）：
 *   绕 libc getaddrinfo / OS hosts file → 行为确定,CI / Vercel runtime / 本机 一致
 * - A + AAAA 并发 `Promise.allSettled`（非串行 await）：避免 IPv6 timeout 拖延 IPv4
 * - 任一 success → 用 success records；两边都 fail → `dns_resolve_failed` 并返
 *   `cause` 含 A / AAAA 各自原因方便 log
 * - 5s timeout per resolve call（W2 §2.6 risk #2 兜底）：避免恶意 DNS 拖延 fetch
 *
 * **本函数不做的事**（按 phase 3 边界）：
 * - 不做 IP private-segment 校验（由 caller / `checkAsync` 走 `isPrivateIpString`）
 * - 不缓存 resolve 结果（D3 决策：lib 零状态,cache 留 phase 3.5 caller 决策）
 * - 不区分 transient vs permanent DNS error（cause 字符串供 log；reason 统一）
 */

const RESOLVE_TIMEOUT_MS = 5000;

export type SafeResolveResult =
  | { ok: true; addresses: string[] }
  | { ok: false; cause: string };

export async function safeResolveIp(
  hostname: string,
  options?: { timeoutMs?: number },
): Promise<SafeResolveResult> {
  if (!hostname) {
    return { ok: false, cause: "empty hostname" };
  }

  const timeoutMs = options?.timeoutMs ?? RESOLVE_TIMEOUT_MS;

  const v4 = withTimeout(dns.resolve4(hostname), timeoutMs);
  const v6 = withTimeout(dns.resolve6(hostname), timeoutMs);

  const [r4, r6] = await Promise.allSettled([v4, v6]);

  const addresses: string[] = [];
  if (r4.status === "fulfilled") addresses.push(...r4.value);
  if (r6.status === "fulfilled") addresses.push(...r6.value);

  if (addresses.length === 0) {
    const v4err = r4.status === "rejected" ? describeError(r4.reason) : "empty";
    const v6err = r6.status === "rejected" ? describeError(r6.reason) : "empty";
    return { ok: false, cause: `A=${v4err};AAAA=${v6err}` };
  }

  return { ok: true, addresses };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timeout(${ms}ms)`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    // Node DNS errors have `.code` (e.g. `ENOTFOUND`, `NXDOMAIN`, `SERVFAIL`).
    const code = (e as { code?: string }).code;
    return code ?? e.message;
  }
  return String(e);
}
