# `lib/rate-limit/` — primitive lib + route wiring (phase 2 complete)

Phase 1 (W2) 落了 lib 层 primitive；**phase 2 (W1) 完成 13 路由 wire + 1 cron 豁免**。

## 公共 API

```ts
import {
  createRateLimiter,
  withRateLimit,
  rateLimitHeaders,
  clientIp,
  STRICT_PER_IP,
  GENEROUS_AUTHENTICATED,
  WRITE_HEAVY,
  ANON_AI_HEAVY,   // P3 #3 phase 2 新增
  STREAM_HEAVY,    // P3 #3 phase 2 新增
} from "@/lib/rate-limit";
```

## 典型用法 A — `withRateLimit` 包 handler（非 stream 路由）

```ts
// app/api/foo/route.ts
import { NextRequest } from "next/server";
import {
  createRateLimiter,
  withRateLimit,
  clientIp,
  STRICT_PER_IP,
} from "@/lib/rate-limit";

const RATE_LIMITER = createRateLimiter({
  identifier: "foo-get",
  ...STRICT_PER_IP,
});

async function impl(_req: NextRequest): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = withRateLimit(RATE_LIMITER, clientIp, impl);
```

blocked → 自动 429 + `Retry-After` + `X-RateLimit-*` headers；通过 → 原 handler 输出 + headers 注入。

## 典型用法 B — inline check（stream 路由必用）

stream 路由**必须**用 inline check：一旦 `controller.enqueue` 开始就 HTTP 200 commit，无法再回 429。inline check 在 stream 创建前 fail-fast，shape 与 wrapper 完全一致：

```ts
// app/api/foo-stream/route.ts
const RATE_LIMITER = createRateLimiter({
  identifier: "foo-stream",
  ...STREAM_HEAVY,
});

export async function POST(req: NextRequest) {
  // ... schema parse, env check ...

  const rlResult = await RATE_LIMITER.check(clientIp(req));
  const rlHeaders = rateLimitHeaders(rlResult);
  if (!rlResult.success) {
    return new Response(
      JSON.stringify({ error: "rate_limited", limit: rlResult.limit }),
      {
        status: 429,
        headers: { ...rlHeaders, "content-type": "application/json" },
      },
    );
  }

  const stream = new ReadableStream({ async start(controller) { /* ... */ } });
  return new Response(stream, {
    headers: { ...rlHeaders, "content-type": "application/x-ndjson; charset=utf-8" },
  });
}
```

## `clientIp` keyFn

Vercel canonical IP 信任链（P3 #3 phase 2 W3 verdict §B）：
1. `x-real-ip` 优先（Vercel 注入 single value，难伪造）
2. fallback `x-forwarded-for` left-most（Vercel canonical 客户端 IP）
3. fallback `"anon"`（dev / test / 无 IP 落同桶，可预测）

## Backend dispatch

- env 含 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` → Upstash sliding/fixed
- 否则 → in-memory，首次 fallback 时 `console.warn` 一次

> **⚠️ 部署提醒**：Vercel 生产**必须**配 Upstash 两个 env。否则多 worker 各算各的 bucket，限流上限实际 ×N 失效。在 Vercel Dashboard → Project → Settings → Environment Variables 设置。

## 预置 preset

| preset | limit | window | algorithm | 适用 |
|---|---|---|---|---|
| `STRICT_PER_IP` | 10 | 1 m | sliding | 匿名 GET / Blob token 端点 |
| `GENEROUS_AUTHENTICATED` | 100 | 1 m | sliding | 已登录用户（未来） |
| `WRITE_HEAVY` | 5 | 10 m | fixed | Apify scrape / ffmpeg / zip 重 IO |
| `ANON_AI_HEAVY` | 10 | 10 m | sliding | Claude analyze / brainstorm / review |
| `STREAM_HEAVY` | 3 | 10 m | fixed | NDJSON stream + Apify + Claude（长占用） |

数字保守起步；上线 1 周后看 Vercel Logs 429 命中率调整（follow-up PR）。

## Phase 2 路由 wire 表（13 wired + 1 cron 豁免）

| 路由 | preset | 模式 |
|---|---|---|
| `GET /api/trending` | `STRICT_PER_IP` | wrapper |
| `POST /api/upload` | `STRICT_PER_IP` | wrapper |
| `POST /api/template-brief-upload` | `STRICT_PER_IP` | wrapper |
| `POST /api/scrape` | `WRITE_HEAVY` | wrapper |
| `POST /api/compile-capcut` | `WRITE_HEAVY` | wrapper |
| `POST /api/analyze-video` | `ANON_AI_HEAVY` | wrapper |
| `POST /api/template-brief` | `ANON_AI_HEAVY` | wrapper |
| `POST /api/template-brainstorm` | `ANON_AI_HEAVY` | inline (stream) |
| `POST /api/template-explore` | `ANON_AI_HEAVY` | inline (stream) |
| `POST /api/template-review` | `ANON_AI_HEAVY` | inline (stream) |
| `POST /api/review` | `ANON_AI_HEAVY` | inline (stream) |
| `POST /api/account-profile` | `STREAM_HEAVY` | inline (stream) |
| `POST /api/technique-match` | `STREAM_HEAVY` | inline (stream) |
| `POST /api/cron/trending` | **豁免** | Bearer auth 双认证 |

## 测试

测试用 `_resetBackendForTests()` per case 清桶：

```ts
import { _resetBackendForTests } from "@/lib/rate-limit/backend";

beforeEach(() => {
  _resetBackendForTests();
});
```

route-level 抽样测试见 `tests/api/rate-limit-route.test.ts`（4 路由 × happy/429/headers = 10 cases），含 stream 路由 inline-before-enqueue invariant 显式断言。
