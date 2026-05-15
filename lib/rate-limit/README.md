# `lib/rate-limit/` — phase 2 wiring guide

Phase 1 (W2) 落了 lib 层 primitive,本目录**零 route 引用**。Phase 2 (W1, P3 #2 SSRF 落地后) 在路由层 wire。

## 公共 API

```ts
import {
  createRateLimiter,
  withRateLimit,
  rateLimitHeaders,
  STRICT_PER_IP,
} from "@/lib/rate-limit";
```

## 典型用法 A — `withRateLimit` 包 handler

```ts
// app/api/foo/route.ts
import { NextRequest } from "next/server";
import { createRateLimiter, withRateLimit, STRICT_PER_IP } from "@/lib/rate-limit";

const limiter = createRateLimiter({
  identifier: "foo-get",
  ...STRICT_PER_IP,
});

function clientIp(req: Request): string {
  // W1 在 phase 2 决定信任链(x-forwarded-for / vercel-ip 等)
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
}

async function getImpl(_req: NextRequest): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = withRateLimit(limiter, clientIp, getImpl);
```

blocked → 自动 429 + `Retry-After` + `X-RateLimit-*` headers;通过 → 原 handler 输出 + headers 注入。

## 典型用法 B — 手动 check + 注入 headers

```ts
// 适合需要在 handler 内做条件逻辑(白名单 / 不同 cost 计费)的场景
const result = await limiter.check(clientIp(req));
if (!result.success) {
  return new Response("rate limited", {
    status: 429,
    headers: rateLimitHeaders(result),
  });
}
// ...real work...
const res = NextResponse.json(data);
for (const [k, v] of Object.entries(rateLimitHeaders(result))) {
  res.headers.set(k, v);
}
return res;
```

## Backend dispatch

- env 含 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` → Upstash sliding/fixed
- 否则 → in-memory,首次 fallback 时 `console.warn` 一次

> Vercel 生产必须配 Upstash —— 多实例下 in-memory 各算各的,limit 实际 ×N。

## 预置 preset

| preset | limit | window | algorithm | 适用 |
|---|---|---|---|---|
| `STRICT_PER_IP` | 10 | 1 m | sliding | 匿名 GET |
| `GENEROUS_AUTHENTICATED` | 100 | 1 m | sliding | 已登录用户 |
| `WRITE_HEAVY` | 5 | 10 m | fixed | 写操作 / 计费 |

## 不在 phase 1 范围

- IP 提取(W1 phase 2 边界,跟 SSRF 信任链相关)
- 具体路由 limit 数值(谁 wire 谁定,基于实际流量)
- Upstash REST credentials env(部署侧操作)
- 跨进程持久化(memory 仅 dev,Upstash 生产)
