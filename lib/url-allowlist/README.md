# `lib/url-allowlist` — SSRF + DNS rebinding defense

Phase 1（primitive 库） + Phase 2 / 2.5（W1 route wiring） + Phase 3（DNS rebinding 防御） 累积成的 SSRF 防御 lib。

## 公共 API（已 stable）

```typescript
import {
  // 创建 allowlist 实例（Zod 校验 opts；misconfigure 抛错）
  createUrlAllowlist,

  // 错误类型（Phase 2 wiring 抛、Phase 3 扩 resolvedIp + cause）
  UrlAllowlistError,

  // Presets（生产 caller 用这个，少手写 opts）
  VERCEL_BLOB_PRESET,             // Vercel Blob CDN
  TIKTOK_INSTAGRAM_CDN_PRESET,    // TT / IG / FB CDN（5 host suffix）

  // Phase 3 helpers
  safeResolveIp,                  // 低层 DNS resolve（A+AAAA via dns.promises）
  fetchWithAllowlist,             // 高层 fetch wrapper（undici Pool with SNI）

  // 工具（基本不应直接 import；走 createUrlAllowlist 即可）
  matchHost,
  isPrivateIpString,
} from "@/lib/url-allowlist";

// 类型导出
import type {
  HostPattern,
  UrlAllowlist,                   // { check, checkAsync }
  UrlAllowlistOpts,
  UrlAllowlistResult,             // sync check 返
  UrlAllowlistAsyncResult,        // checkAsync 返（含 resolvedAddresses）
  UrlAllowlistDenyReason,         // 6 个 reason union
  SafeResolveResult,
} from "@/lib/url-allowlist";
```

## API 形态

### `createUrlAllowlist(opts) → { check, checkAsync }`

```typescript
const allow = createUrlAllowlist({
  allowedSchemes: ["https:"],            // default = ["https:"]
  allowedHosts: [
    "example.com",                       // 精确字符串（case-insensitive）
    /^(.+\.)?api\.example\.com$/,        // RegExp（caller 控锚定）
    { suffix: ".cdn.example.com" },      // suffix 必带前导点（Zod 强制）
  ],
  blockPrivateIps: true,                 // default = true
});

// Sync check —— phase 1 / 2 路径用。不做 DNS。
const sync = allow.check("https://example.com/x");
if (sync.ok) {
  // sync.parsed: URL
} else {
  // sync.reason: "invalid_url" | "scheme_denied" | "host_denied" | "private_ip"
}

// Async check —— phase 3 路径用。做 DNS resolve + 每 IP 私段校验。
const async_ = await allow.checkAsync("https://example.com/x");
if (async_.ok) {
  // async_.parsed: URL
  // async_.resolvedAddresses: string[]（IPv4 + IPv6 混合）
} else {
  // async_.reason: 上面 4 个 + "dns_resolve_failed" | "resolved_private_ip"
  // async_.resolvedIp?: string（resolved_private_ip 时带）
  // async_.cause?: string（dns_resolve_failed 时带）
}
```

### `fetchWithAllowlist(url, allowlist, init?) → Promise<Response>`

```typescript
try {
  const res = await fetchWithAllowlist(
    userSuppliedUrl,
    createUrlAllowlist(VERCEL_BLOB_PRESET),
    { signal: AbortSignal.timeout(10_000) },
  );
  // res 是标准 Response
} catch (e) {
  if (e instanceof UrlAllowlistError) {
    // e.reason / e.url / e.resolvedIp / e.cause
    // 推荐 mapping：见 docs/security/dns-rebinding-defense.md
  } else {
    throw e;  // 网络错误 / abort 等
  }
}
```

防御原理（per W3 phase 3 verdict 9154701 C1）：
- `checkAsync` 拿到 `resolvedAddresses`
- `Pool` origin 锁到 resolved IP literal
- `connect.servername` 保留 hostname → TLS SNI 正确
- fetch URL 用 hostname → `Host:` header 正确
- per-call Pool + `finally close`（防泄漏）

## Phase 3.5 caller wiring (完成 · 2026-05-15)

phase 3.5 由 W2 接手实施（W3 ownership transfer `baf1780`）。所有 phase 2 wired routes 已升级 async checkAsync + fetchWithAllowlist；ffmpeg 走 alt path（fetchWithAllowlist 下 /tmp → ffmpeg 读本地）。

| Caller | 升级 |
|---|---|
| `lib/capcut-compiler/assets.ts prepareAssets` | sync check → Promise.all(checkAsync) + per-video fetchWithAllowlist + SSRF event 立即 propagate（不进 download stats） |
| `lib/video/ffmpeg.ts extractFramesAndAudio` | sync check + fetch → 单 fetchWithAllowlist（B1 完全替）|
| `lib/video/analyze.ts analyzeVideo` | pass-through |
| `lib/account-profile/frame-analyze.ts` | pass-through，resolved_private_ip 升级 console.error (fail-soft 行为不变) |
| `app/api/template-brief/route.ts` | fetchWithAllowlist + dns/private reason mapping (502 retry / 400 url_denied + console.error) |
| `app/api/technique-match/route.ts` | pre-stream batch Promise.all(checkAsync) + in-stream fetchWithAllowlist（NDJSON stream §4 #4 防御） |
| `app/api/compile-capcut/route.ts` | UrlAllowlistError mapping 扩 dns/private reason |
| `app/api/analyze-video/route.ts` | 同上 |
| `app/api/account-profile/route.ts` | 继承 fail-soft chain |

### Caller error mapping (W3 verdict 5357c41 §C)

| Reason | HTTP status | Server log | Response body | Client retry |
|---|---|---|---|---|
| `invalid_url` / `scheme_denied` / `host_denied` / `private_ip` | 400 `url_denied` | `console.warn` | 不暴露 reason 详情 (防 SSRF probe) | ❌ |
| `dns_resolve_failed` | **502** + `Retry-After: 5` | `console.warn` 含 `cause` | 暴露 `dns_resolve_failed` 标识 | ✅ |
| `resolved_private_ip` | **400 `url_denied`** (同 host_denied 防 SSRF probe) | **`console.error`** 含 `resolvedIp` | 不暴露 reason | ❌ |

### Phase 3.5 不在 scope（留 phase 4+）

- DNS cache shared singleton (QPS 优化) — caller 按业务场景决策
- Observability metrics（rebinding alert count / resolve latency）
- CI Node version matrix (18/20/22)
- Hex-encoded IPv4-mapped IPv6 (`::ffff:7f00:1`) — ipaddr.js

## 设计决策日志

| Decision | Choice | 出处 |
|---|---|---|
| Phase 1 primitive lib | Zod-validated opts, no DNS resolve | W2 phase 1 (`3a6514f`) |
| Phase 1 nit: IPv4-mapped IPv6 | `::ffff:N.N.N.N` dotted-quad form via string prefix（不引 ipaddr.js） | W2 phase 1 nit (`3a6514f`) |
| Phase 1 nit: `{ suffix }` 前导点 Zod refine | 强校验 `.` 前导，misconfigure runtime 抛 | 同上 |
| Phase 2 wiring | sync check at route entry, `UrlAllowlistError` propagation | W1 phase 2 (`4f7f70f`) |
| Phase 2.5 preset | TIKTOK_INSTAGRAM_CDN_PRESET（5 host） | W1 phase 2.5 (`11e0c23`) |
| Phase 3 DNS resolve API | `dns.promises.resolve4 + resolve6` 并发 `Promise.allSettled`（**不** `dns.lookup`） | W3 verdict A2 |
| Phase 3 防御策略 | helper `fetchWithAllowlist`（非 single-shot caller-choice） | W3 verdict B3 |
| Phase 3 TLS SNI | undici `Pool` per-call + `connect.servername` + finally close | W3 verdict C1 ⭐ |
| Phase 3 DNS cache | single-shot 不 cache（lib 零状态） | W3 verdict D3 |
| Phase 3 IPv6 | A + AAAA 都拿，逐 IP `isPrivateIpString` | W3 verdict E2 |
| Phase 3 deny reason | `dns_resolve_failed`（transient）+ `resolved_private_ip`（security event）拆分 | W3 verdict F2 |

## 测试覆盖（截至 phase 3 完工）

| 文件 | Cases | Coverage |
|---|---|---|
| `tests/url-allowlist/check.test.ts` | 22 | sync check 全 deny 路径 + happy |
| `tests/url-allowlist/host-match.test.ts` | 14 | string / RegExp / suffix 三 case |
| `tests/url-allowlist/private-ip.test.ts` | 24 | IPv4 全段 + IPv6 + IPv4-mapped IPv6 dotted-quad |
| `tests/url-allowlist/index.test.ts` | 14 | createUrlAllowlist Zod-throw + defaults + presets |
| `tests/url-allowlist/types.test.ts` | 6 | suffix leading-dot Zod refine + regression |
| `tests/url-allowlist/presets.test.ts` | ~12 | Vercel Blob + TT/IG CDN preset 行为 |
| `tests/url-allowlist/dns-resolve.test.ts` | 9 | A/AAAA 并发 + 失败 + timeout + concurrency regression |
| `tests/url-allowlist/check-async.test.ts` | 13 | sync 短路 / DNS fail / rebinding / IP literal 短路 |
| `tests/url-allowlist/fetch.test.ts` | 14 | Pool origin / SNI / close / deny / IP preference |
| `tests/url-allowlist/error.test.ts` | 7 | 2-arg backward-compat + resolvedIp + cause |
| `tests/url-allowlist/dns-rebinding.test.ts` | 5 | 完整防御链 end-to-end |

**总：~140 cases**（phase 1 base 85 → phase 3 完工 ~140）

## 真实环境 PoC

`lib/url-allowlist/__demo__/dns-rebinding-poc.ts` — runnable DNS rebinding 攻击 PoC（dns2 + dns.setServers），跑法：

```bash
npx tsx lib/url-allowlist/__demo__/dns-rebinding-poc.ts
```

未来扩 lib 时**复跑**验证防御行为未漂移。CI 不跑（vitest exclude `lib/**/__demo__/**`）。
