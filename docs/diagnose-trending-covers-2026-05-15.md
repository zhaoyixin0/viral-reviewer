# Trending 封面缺失诊断报告 2026-05-15

> Phase 1 诊断脚本 (W3 → W2 任务) 自动生成 · 不改 production 代码

## 数据源

- **Vercel Blob 探测** —— BLOB_READ_WRITE_TOKEN 已配置=true, `trending/*` 下 blob 数=0, 最新=_无_
- snapshot origin: `local` (本地 data/scraped fallback —— 因 Blob 为空)
- snapshot week: `2026-04-29`
- snapshot capturedAt: `2026-04-29`
- 视频总数: 299 (TT=180 + IG=119)

## 诊断结论 (TL;DR)

- **根因 1 (上游)**: Vercel Blob 中 trending/* prefix 下 **0 条 snapshot** —— prod /trending 端点 readLatestTwoSnapshots 必返回 {current: null, previous: null},看板呈空状态。这本身就是用户看到「封面缺失」的最大可能原因 —— 实际上**整个看板没数据**,不是「卡片有但封面没」。修法: 跑一次 fetchTrendingSnapshot + writeSnapshot (手动 / cron / 启动种子),让 Blob 有第一份本周快照。

- **根因 2 (历史 dump 现状)**: 本地 fallback dump (`2026-04-29`) 里 cover URL **50 / 50** 个全部返回 4xx (HEAD/GET 都试过、带/不带 Referer 都试过)。 这是**典型 signed-URL 过期**: TikTok / Instagram CDN URL 都带 token (`_nc_ohc` / `oe` / 类似查询参数),TTL 几天到几周。 距 dump 日期已 ~17 天。Cover 字段都在 (空率 0.0%),问题在 URL 本身已死。

- **Phase 2 推荐顺序**: (a) 先让 Blob 攒到当周新 snapshot (上游必修); (b) UI 加 `<img onError>` 兜底占位,无论后端何时修都不破样式; (c) 可选: snapshot-store 加 stale-cover 检测,cron 触发重抓老 snapshot 的死 URL。

## 1. 字段统计 (cover 空率 + 异常率)

| 平台 | 总数 | 空字符串 (率) | 长度异常 (率) | 有效 (率) |
|---|---|---|---|---|
| TikTok | 180 | 0 (0.0%) | 0 (0.0%) | 180 (100.0%) |
| Instagram | 119 | 0 (0.0%) | 0 (0.0%) | 119 (100.0%) |

**长度异常**定义: 非空但长度 < 10 或不含 `http`。

## 2. HEAD/GET 采样结果 (浏览器 UA · concurrency=5)

- redirect: `manual` (3xx 不自动跟随)
- **三轮**: HEAD 无 Referer / HEAD 带平台 Referer / GET (Range bytes=0-1023) 带 Referer
- GET 那一轮是为了排除"CDN 反 HEAD 协议但 GET 正常"的假阴性

| 平台 / 方法 / Referer | 2xx | 3xx | 403 | 404 | 5xx | other | network_error | 总样本 |
|---|---|---|---|---|---|---|---|---|
| TikTok / HEAD / 无 Referer | 0 | 0 | 25 | 0 | 0 | 0 | 0 | 25 |
| TikTok / HEAD / 带 Referer | 0 | 0 | 25 | 0 | 0 | 0 | 0 | 25 |
| TikTok / GET / 带 Referer (Range 0-1023) | 0 | 0 | 25 | 0 | 0 | 0 | 0 | 25 |
| Instagram / HEAD / 无 Referer | 0 | 0 | 25 | 0 | 0 | 0 | 0 | 25 |
| Instagram / HEAD / 带 Referer | 0 | 0 | 25 | 0 | 0 | 0 | 0 | 25 |
| Instagram / GET / 带 Referer (Range 0-1023) | 0 | 0 | 25 | 0 | 0 | 0 | 0 | 25 |

## 3. 前 5 条 cover === "" 的 normalized item

_无空 cover item — 跳过_

## 4. 原始 Apify raw item

_未跑 `--with-raw` —— snapshot 已经过 normalize,raw item 不在 snapshot 中。如需 raw 字段确认,跑 `tsx --env-file=.env.local scripts/diagnose-trending-covers.ts --with-raw` (会消耗 Apify quota,约 10 条)。_

## 5. 根因 ranking (启发式打分)

1. **CDN URL 过期 / 鉴权失败 (404 / 403 不可恢复)** — score=1.00 (HEAD 无 Referer 403=50 404=0 (共 50); GET 带 Referer 2xx=0 (共 50) — GET 也无法救活意味着是鉴权而非反 HEAD 协议层)
2. **snapshot 不存在 (Vercel Blob 内 0 条 trending/*)** — score=0.95 (BLOB_READ_WRITE_TOKEN 已配置=true, trending/ 下 blob 数=0)
3. **部分 item 真无封面 (long-tail UGC)** — score=0.20 (空 cover 率小但非零 = 0.0%)
4. **Apify scraper schema 升级,normalize fallback 落空** — score=0.05 (空 cover 整体率 = 0.0%)
5. **防盗链 (Referer 阻挡,带 Referer 即可救活)** — score=0.00 (HEAD 无 Referer 2xx=0, HEAD 带 Referer 2xx=0, GET 带 Referer 2xx=0 — 是否带 Referer 复活)

## 6. 推荐修法 (phase 2 候选,W3 决策)

- **如果空 cover 率 > 10%** → 扩 `lib/apify/normalize.ts` fallback chain (例如 IG 看 `thumbnailUrl` 之外的字段;TT 看 `videoMeta.originCover` / `videoMeta.dynamicCover`),并加 `tests/apify/normalize.test.ts` 新字段映射 case。
- **如果带 Referer 2xx 显著上升** → `components/trending/TrendingCard.tsx` `<img>` 加 `referrerPolicy="no-referrer"`,全局退一步规避防盗链。
- **如果 HEAD 大量 404 / 403 即使带 Referer** → CDN URL 过期 → `<img onError>` 显示占位 (与现有"无封面"统一样式),并可选 cron 异步重抓 stale snapshot。
- **如果空 cover 率 < 5% 且 HEAD 几乎全 2xx** → 实属 long-tail UGC + 浏览器破图标 → 同样 `onError` 占位即可,无需后端改动。

## 附录:脚本运行参数

- sample size: 50 个 URL × 3 轮 = 150 个请求
- 真实 UA: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`
