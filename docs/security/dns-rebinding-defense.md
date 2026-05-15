# DNS Rebinding 防御 — `lib/url-allowlist`

P3 #2 phase 3（2026-05-15 merged）落地的 SSRF + DNS rebinding 防御机制总览。Phase 3.5（W1 owner）负责将 phase 3 lib primitive 接入路由 caller。

## 攻击模型

DNS rebinding 是 SSRF 的高阶变体。攻击者控制域名 + DNS 服务器，攻击流程：

1. 受害服务 `fetch("https://evil.test/data")`，第一次 DNS resolve → 攻击者返公网 IP `1.2.3.4`
2. 受害服务做 allowlist check（host suffix 匹配 / IP 私段判断）→ 全部通过
3. 受害服务**第二次** DNS resolve（fetch 内部 connect 时）→ 攻击者已切 DNS 记录到 `127.0.0.1` 或 `169.254.169.254`（AWS metadata）
4. 受害服务连接到内网/loopback → 攻击者读到内网数据 / 拿到云元数据 token

仅做"hostname 匹配 + IP 字面校验"无法防御此攻击 —— 防御点必须 **lock fetch 连接的 TCP 目标 IP**，而不能让 fetch 二次 resolve。

## 防御层次（按 deny 优先级排序）

| Layer | 函数 | Deny reason |
|---|---|---|
| 1. URL parse | `createUrlAllowlist().check()` | `invalid_url` |
| 2. Scheme 校验 | 同上 | `scheme_denied` |
| 3. Hostname 字面是私 IP | 同上（通过 `isPrivateIpString`） | `private_ip` |
| 4. Host suffix / 字符串 / RegExp 匹配 | 同上（通过 `matchHost`） | `host_denied` |
| 5. **DNS resolve + 每 IP 私段校验** | `createUrlAllowlist().checkAsync()` 内调 `safeResolveIp` | `dns_resolve_failed` / `resolved_private_ip` |
| 6. **fetch 用 resolved IP 直连**（防 fetch 重 resolve） | `fetchWithAllowlist()` 用 undici `Pool` 把 connection origin 锁到 resolved IP，`connect.servername` 保留 SNI | — |

## API 用法

### 选项 A: caller 已有 fetch 调用，希望最少改动

```typescript
import { createUrlAllowlist, fetchWithAllowlist, VERCEL_BLOB_PRESET } from "@/lib/url-allowlist";

const allowlist = createUrlAllowlist(VERCEL_BLOB_PRESET);

// 替换原来的 fetch(url, { ... }) → fetchWithAllowlist(url, allowlist, { ... })
const response = await fetchWithAllowlist(userSuppliedUrl, allowlist, {
  signal: AbortSignal.timeout(10_000),
});
```

`fetchWithAllowlist` 抛 `UrlAllowlistError` 当 allowlist deny；caller 用 `instanceof UrlAllowlistError` + `.reason` 区分。

### 选项 B: caller 用 ffmpeg / 其他非-fetch 客户端

ffmpeg / `youtube-dl` / `yt-dlp` 走 libavformat / 自带 HTTP client，**无法用 `fetchWithAllowlist` 接管 connection**。alt path：

```typescript
import { createUrlAllowlist, TIKTOK_INSTAGRAM_CDN_PRESET, UrlAllowlistError } from "@/lib/url-allowlist";

const allowlist = createUrlAllowlist(TIKTOK_INSTAGRAM_CDN_PRESET);
const check = await allowlist.checkAsync(userSuppliedUrl);
if (!check.ok) {
  throw new UrlAllowlistError(check.reason, userSuppliedUrl);
}
// 1) 用 fetchWithAllowlist 下载到本地 /tmp（保证 connection 走 resolved IP）
const tmpPath = `/tmp/${randomUUID()}.mp4`;
const res = await fetchWithAllowlist(userSuppliedUrl, allowlist);
await pipeline(res.body!, createWriteStream(tmpPath));

// 2) ffmpeg 读本地文件（不再走 DNS）
await ffmpeg(`-i ${tmpPath} ...`);
```

此 alt-path 属 phase 3.5 W1 wiring 决策。

### Reason 处理建议

| Reason | 性质 | 建议 caller 行为 |
|---|---|---|
| `invalid_url` / `scheme_denied` / `host_denied` / `private_ip` | 用户输入错 / 配置外 | 400 to client，server log INFO |
| `dns_resolve_failed` | Transient（DNS server 故障 / NXDOMAIN / timeout） | 503 + Retry-After（caller 指数退避重试） |
| `resolved_private_ip` | **Security event**（DNS rebinding 攻击） | 400 to client（不暴露 reason 防 SSRF probe）+ server log **WARN + alert** + 记录 `error.resolvedIp` |

## Phase 3 边界 / 限制

| 不覆盖 | 路径 |
|---|---|
| ffmpeg / yt-dlp 等非-fetch client 直接走 DNS | phase 3.5 W1 alt-path（先 fetch → tmp file → ffmpeg 本地）|
| DNS cache singleton（高 QPS 优化） | phase 3.5 caller-side 按 use case 决策 |
| Hex-encoded IPv4-mapped IPv6（`::ffff:7f00:1`） | phase 4+ ipaddr.js |
| Observability（DNS resolve latency / rebinding alert count metrics） | phase 4+ |

## 真实 PoC（本机验证）

phase 3 commit 1 验证防御机制的 PoC script 保留为 runnable：

```bash
npx tsx lib/url-allowlist/__demo__/dns-rebinding-poc.ts
```

启 dns2 UDP server 在 127.0.0.1:15353，第一次返公网 IP，第二次返私 IP；script 验证 `safeResolveIp` 第二次拿到 `127.0.0.1` 后 `isPrivateIpString` 命中。**未来扩 lib 时复跑此 script** 验证行为未漂移。

## 参考

- W3 phase 3 scope verdict commit `9154701` (6 决策 A2+B3+C1+D3+E2+F2)
- Implementation commits: `7dce400` (1/6) → `3cd7362` (2/6) → `2e17a8a` (3/6) → `2e90bd0` (4/6) → `210a6a1` (5/6) → 当前 commit (6/6)
- W1 phase 2 wiring (`4f7f70f`) — sync check 接入 path
- W1 phase 2.5 (`11e0c23`) — TIKTOK_INSTAGRAM_CDN_PRESET 扩 5 host
- W2 phase 1 nit cleanup (`3a6514f`) — IPv4-mapped IPv6 + suffix leading-dot
