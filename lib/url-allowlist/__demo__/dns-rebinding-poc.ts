/* eslint-disable no-console */
/**
 * P3 #2 phase 3 DNS rebinding 攻击 PoC — runnable script，**不在 vitest / next build**。
 *
 * 来源：W3 phase 3 scope verdict (9154701) §"Pre-commit verify" → 方案 2 + 3 混合,
 * "方案 2 PoC script 保留为 runnable demo for future re-verification"。
 *
 * **跑法**：
 *   ```
 *   npx tsx lib/url-allowlist/__demo__/dns-rebinding-poc.ts
 *   ```
 *
 * **PoC 攻击模型**：
 *   - 本地 `dns2` 起 UDP DNS server (port 5353,绕标准 53 避免提权)
 *   - server 对 `evil.test` 第一次 A query 返 `1.1.1.1`（公网,过 allowlist host check）
 *   - 第二次 A query 返 `127.0.0.1`（私 IP,SSRF target）
 *   - `dns.setServers(['127.0.0.1:5353'])` 让 `dns.resolve4/6` 走本地 server
 *   - 调用 `safeResolveIp("evil.test")` 两次,观察返回 IP 是否漂移
 *   - **预期**：第一次返公网 IP,第二次返私 IP → `isPrivateIpString` 命中 → caller 拒
 *
 * **commit 1 验证**：本 script 验证 `safeResolveIp` 行为对 DNS 漂移敏感（每次 fresh resolve,
 * 拿到 server 当前返回的 IP）。`fetchWithAllowlist` 完整拒绝逻辑在 commit 3 之后跑完整 PoC。
 *
 * **commit 1 输出**（写进 commit message 末）：
 *   - 第一次 resolve: [`1.1.1.1`]（攻击者 staged 公网 IP）
 *   - 第二次 resolve: [`127.0.0.1`]（rebound 到 loopback）
 *   - `isPrivateIpString("127.0.0.1")` = `true` → caller 应拒
 */

import { promises as dns } from "node:dns";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dns2 = require("dns2");
import { safeResolveIp } from "../dns-resolve";
import { isPrivateIpString } from "../private-ip";

const VICTIM_HOSTNAME = "evil.test";
const STAGED_PUBLIC_IP = "1.1.1.1";
const REBOUND_PRIVATE_IP = "127.0.0.1";
const DNS_PORT = 15353; // 避免 5353 mDNSResponder (Windows) / avahi (Linux) 冲突

interface Dns2Packet {
  questions: Array<{ name: string; type: number }>;
  answers: Array<{
    name: string;
    type: number;
    class: number;
    ttl: number;
    address: string;
  }>;
}

async function main(): Promise<void> {
  let resolveCount = 0;
  const { Packet } = dns2;

  const server = dns2.createServer({
    udp: true,
    handle: (
      request: Dns2Packet,
      send: (response: Dns2Packet) => void,
    ): void => {
      const response = Packet.createResponseFromRequest(request);
      const [question] = request.questions;
      if (!question) {
        send(response);
        return;
      }
      const { name, type } = question;

      // Only respond to A queries; ignore AAAA so safeResolveIp's allSettled
      // gets one fulfilled (A) + one rejected (AAAA NODATA), exercising
      // the partial-fail code path.
      if (type !== Packet.TYPE.A) {
        send(response);
        return;
      }

      resolveCount += 1;
      const address =
        resolveCount === 1 ? STAGED_PUBLIC_IP : REBOUND_PRIVATE_IP;

      response.answers.push({
        name,
        type: Packet.TYPE.A,
        class: Packet.CLASS.IN,
        ttl: 0,
        address,
      });
      send(response);
    },
  });

  await new Promise<void>((res, rej) => {
    server.on("listening", () => res());
    server.on("error", rej);
    server.listen({ udp: DNS_PORT });
  });

  console.log(`[PoC] dns2 UDP server listening on 127.0.0.1:${DNS_PORT}`);

  const originalServers = dns.getServers();
  dns.setServers([`127.0.0.1:${DNS_PORT}`]);

  try {
    console.log(`[PoC] safeResolveIp("${VICTIM_HOSTNAME}") — first call`);
    const first = await safeResolveIp(VICTIM_HOSTNAME, { timeoutMs: 2000 });
    console.log("  result:", JSON.stringify(first));

    console.log(`[PoC] safeResolveIp("${VICTIM_HOSTNAME}") — second call (rebinding window)`);
    const second = await safeResolveIp(VICTIM_HOSTNAME, { timeoutMs: 2000 });
    console.log("  result:", JSON.stringify(second));

    const firstOk = first.ok && first.addresses.includes(STAGED_PUBLIC_IP);
    const secondOk =
      second.ok && second.addresses.includes(REBOUND_PRIVATE_IP);
    const reboundPrivate =
      second.ok &&
      second.addresses.some((ip) => isPrivateIpString(ip));

    console.log("");
    console.log("[PoC] Verdict:");
    console.log(`  first resolve  returned staged public IP (${STAGED_PUBLIC_IP}): ${firstOk}`);
    console.log(`  second resolve returned rebound private IP (${REBOUND_PRIVATE_IP}): ${secondOk}`);
    console.log(`  isPrivateIpString flagged second resolve: ${reboundPrivate}`);

    if (firstOk && secondOk && reboundPrivate) {
      console.log("");
      console.log("[PoC] ✅ DNS rebinding observed; phase 3 checkAsync + fetchWithAllowlist will reject this on second resolve.");
      process.exitCode = 0;
    } else {
      console.log("");
      console.log("[PoC] ❌ unexpected result — investigate.");
      process.exitCode = 1;
    }
  } finally {
    dns.setServers(originalServers);
    server.close();
  }
}

main().catch((e) => {
  console.error("[PoC] fatal:", e);
  process.exit(2);
});
