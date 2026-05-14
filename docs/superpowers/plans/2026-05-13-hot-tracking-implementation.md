# Hot Tracking — P0/P1/P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 viral-reviewer 从「按 views 排序的 7 年老爆款」升级为真正的热点追踪 —— /analyze 输入样本加 30 天时间窗过滤(P0)、每周 Cron 抓 TikTok 趋势 + IG 热门 hashtag 生成快照(P1)、新增 /trending 看板 + /analyze snapshot 兜底层(P2)。

**Architecture:** Vercel Cron 每周一次 → `fetchTrendingSnapshot()` 抓取 + `enrichSnapshot()` 富化 + Haiku 题材标签 → 写 Vercel Blob(独立 `trending/` namespace)。两个消费端共享快照:`/trending` 看板 RSC 直读 + `velocity.ts` 算周环比;`/analyze` 的 `retrieval.ts` 在 cache 与 live 之间插一层免费 snapshot 兜底。

**Tech Stack:** Next.js 15 App Router · TypeScript strict · Vitest · `@vercel/blob` · `apify-client` · `@anthropic-ai/sdk`(Haiku 富化/分类)· `@vercel/config`(vercel.ts cron 配置)

**Spec:** `docs/superpowers/specs/2026-05-13-hot-tracking-design.md`(**v4.1** —— P1.7 probe 实测驱动的两阶段 TikTok 重构,已过 architect v4 复审)

---

## 实施约束(来自 spec 的 architect review,每条都必须落地)

> 任务指针经 architect plan review C2 修订 + v4.1 重写更新 —— 以下指针准确。

| 约束 | 体现在 |
|---|---|
| **H1** — Vercel Cron 套餐可用性未验证 + `ADMIN_TRIGGER_SECRET` 要手动配 | **Task P1.1**(plan 第一个 P1 任务就是验证 + 配 env) |
| **H1** — cron route 双认证(cron header / admin token) | **Task P1.13** |
| `velocity.ts` 是纯函数,TDD 先行 | **Task P1.5**(纯函数,先写测试) |
| `/api/trending` 只返回精简投影(v4.1:含 `cards` + `trendingHashtags` 两个精简投影) | **Task P2.2** |
| `TrendingSnapshot` 带 `schemaVersion: 1`,`velocity.ts` 处理版本不一致 → 全 NEW | **Task P1.3**(定义 schemaVersion)+ **Task P1.5**(velocity 处理不一致/缺失) |
| `topicConfidence` 是 `ViralVideo` 的独立字段,不污染 `v.topic` | **Task P1.4**(加字段)+ **Task P1.11**(classifier 写入) |
| 复用现有层(retrieval.ts / blob-cache.ts / enrichBatch / sample-references)而非平行实现 | P0.1 改 topic-research.ts;P1.2 改 blob-cache.ts;**P1.12 复用 `enrichBatch` + `scrapeTikTokByHashtag`(Stage 2)**;P2.1 改 retrieval.ts |
| **v4(spec H2)** — TikTok 两阶段:Stage 1 趋势 hashtag 榜 → Stage 2 复用现有 scraper 抓视频,视频带 `trendingContext` | **Task P1.9**(Stage 1 scraper)+ **Task P1.12**(两阶段编排)+ **Task P1.8**(`TrendingHashtag` 类型 + `trendingContext` 字段) |
| **v4.1(spec 2.8 H2)** — 两阶段下 video velocity 退化,hashtag 级 velocity 作连续性主载体 | **Task P1.15**(`computeHashtagVelocity` 纯函数,TDD)+ **Task P2.5/P2.6**(看板 hashtag 榜涨跌 badge 用它) |
| **v4(spec 2.7 C1)** — schema 变化波及已 merge 代码的 TS type 层 + Zod 层 + `ViralVideo` | **Task P1.8 checkpoint 1**(types.ts TS type + Zod 同步 + `ViralVideo.trendingContext` + 修两处 test helper) |

---

## 文件结构

### 新建
| 文件 | 职责 |
|---|---|
| `lib/utils/iso-week.ts` | `getIsoWeek()` 纯函数(从 `blob-cache.ts` 抽出,两处共用) |
| `lib/trending/types.ts` | `TrendingSnapshot` / `PlatformMeta` / `TrendingVideoWithVelocity` / `TRENDING_SCHEMA_VERSION` |
| `lib/trending/velocity.ts` | 纯函数:对比相邻两周快照算 velocity / rank / trend |
| `lib/trending/snapshot-store.ts` | Blob 读写 + 周 key + `pruneOldSnapshots()` |
| `lib/trending/ig-hot-hashtags.ts` | 人工维护的 IG 热门 hashtag 列表 |
| `lib/trending/topic-classifier.ts` | Haiku 给 trending 视频打题材标签 + `topicConfidence` |
| `lib/trending/fetch.ts` | `fetchTrendingSnapshot()` + `enrichSnapshot()` 编排 |
| `app/api/cron/trending/route.ts` | Cron handler(双认证 + 失败容错) |
| `app/api/trending/route.ts` | 看板平台筛选,返回精简卡片投影 |
| `app/trending/page.tsx` | 看板 RSC,直读快照 |
| `components/trending/TrendingBoard.tsx` | 看板主体(server component) |
| `components/trending/TrendingCard.tsx` | 单卡片 + velocity badge |
| `components/trending/PlatformFilter.tsx` | 平台筛选(client component) |
| `vercel.ts` | cron schedule 配置 |
| `docs/deploy/hot-tracking-cron.md` | P1.1 部署验证记录 |

### 修改
| 文件 | 改动 |
|---|---|
| `lib/research/topic-research.ts` | 加导出纯函数 `withinPublishWindow()` + 在 TT/IG 两处 sort 前过滤 |
| `lib/topic-cache/blob-cache.ts` | 删私有 `getIsoWeek`,改 import `lib/utils/iso-week.ts` |
| `lib/review-engine/types.ts` | `ViralVideo` 加可选 `topicConfidence?: number` |
| `lib/apify/normalize.ts` | 加 `normalizeTikTokTrendItem()` |
| `lib/apify/scrapers.ts` | 加 `scrapeTikTokTrending()` |
| `lib/review-engine/retrieval.ts` | `RetrievalSource` 加 `"snapshot"` + cache/live 间插 snapshot 兜底层 |

---

## 通用约定

- 测试框架 **Vitest**:`npm test` = `vitest run`,`npm run test:watch` = watch。测试文件放 `tests/**/*.test.ts`,镜像 `lib/` 结构。
- 路径别名 `@/` → 仓库根(`tsconfig.json` + `vitest.config.ts` 均已配)。
- `import "server-only"` 在测试里被 `vitest.config.ts` stub 成 noop,server 模块可直接测。
- 类型检查:`npx tsc --noEmit`。
- 每个 commit message 用 Conventional Commits,英文,`feat/fix/refactor/test/chore` 前缀。
- **不要 push**,除非计划末尾 Task P2.8 明确执行。

---

# Phase P0 — /analyze 30 天时间窗过滤(独立可 ship)

> P0 只改 `topic-research.ts` 一个文件,上线即生效:消除 live 抓取里的「7 年老爆款」。不依赖 P1/P2 任何代码,可单独 commit、单独部署。

## Task P0.1: `withinPublishWindow` 纯函数 + 接入 topic-research

**Files:**
- Modify: `lib/research/topic-research.ts`
- Test: `tests/research/publish-window.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/research/publish-window.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { withinPublishWindow } from "@/lib/research/topic-research";
import type { ViralVideo } from "@/lib/review-engine/types";

function makeVideo(over: Partial<ViralVideo> = {}): ViralVideo {
  return {
    id: "tt-1",
    platform: "tiktok",
    url: "https://www.tiktok.com/@u/video/1",
    cover: "",
    title: "t",
    description: "d",
    topic: "Travel",
    tags: [],
    views: 1000,
    likes: 10,
    comments: 1,
    shares: 1,
    duration: 20,
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "h",
    bgm: "b",
    authorHandle: "@u",
    publishedAt: "2026-05-01",
    ...over,
  };
}

const NOW = new Date("2026-05-13T00:00:00Z").getTime();

describe("withinPublishWindow", () => {
  it("keeps a video published 12 days ago", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "2026-05-01" }), NOW)).toBe(true);
  });

  it("drops a video published 31 days ago", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "2026-04-12" }), NOW)).toBe(false);
  });

  it("keeps a video exactly 30 days old (boundary inclusive)", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "2026-04-13" }), NOW)).toBe(true);
  });

  it("keeps a video when publishedAt is missing (unknown date is not dropped)", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "" }), NOW)).toBe(true);
  });

  it("keeps a video when publishedAt is unparseable", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "not-a-date" }), NOW)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/research/publish-window.test.ts`
Expected: FAIL —— `withinPublishWindow` is not exported / not a function

- [ ] **Step 3: 在 topic-research.ts 加纯函数**

在 `lib/research/topic-research.ts` 顶部 import 之后、`ResearchProgress` type 之前,插入:

```typescript
/** P0 时间窗:30 天。爆款"新鲜度"边界。 */
const PUBLISH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 判断一条视频是否落在"近 30 天"时间窗内。
 * publishedAt 缺失或不可解析时返回 true —— 时间未知不丢,只丢明确过期的。
 * @param now 注入当前时间戳便于测试,默认 Date.now()
 */
export function withinPublishWindow(v: ViralVideo, now: number = Date.now()): boolean {
  if (!v.publishedAt) return true;
  const ts = new Date(v.publishedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return now - ts <= PUBLISH_WINDOW_MS;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/research/publish-window.test.ts`
Expected: PASS(5 passed)

- [ ] **Step 5: 接入 TikTok sort 前**

在 `lib/research/topic-research.ts` 的 TikTok 抓取块,把:

```typescript
    tiktokVideos = [...raw]
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);
```

改成:

```typescript
    tiktokVideos = [...raw]
      .filter((v) => withinPublishWindow(v))
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);
```

- [ ] **Step 6: 接入 Instagram sort 前**

同文件 Instagram 抓取块,把:

```typescript
    instagramVideos = [...raw]
      .filter((v) => v.views > 0 || v.likes > 0)
      .sort((a, b) => b.views - a.views || b.likes - a.likes)
      .slice(0, 5);
```

改成:

```typescript
    instagramVideos = [...raw]
      .filter((v) => v.views > 0 || v.likes > 0)
      .filter((v) => withinPublishWindow(v))
      .sort((a, b) => b.views - a.views || b.likes - a.likes)
      .slice(0, 5);
```

- [ ] **Step 7: 跑全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS,无类型错误

- [ ] **Step 8: Commit**

```bash
git add lib/research/topic-research.ts tests/research/publish-window.test.ts
git commit -m "feat(p0): 30-day publish window filter on live research"
```

---

# Phase P1 — Trending 写侧 pipeline

> P1 产出:Vercel Cron 跑一次 → Blob 里出现一份 `trending/snapshot-<week>.json`。结束时可手动 POST 触发并验证快照写入。

## Task P1.1: 验证 Vercel Cron 套餐可用性 + 配置 env vars(architect H1)

> 无代码改动 —— 这是部署前置门禁。整条 P1/P2 pipeline 挂在 Cron 上,套餐不支持就得走降级方案。

**Files:**
- Create: `docs/deploy/hot-tracking-cron.md`

- [ ] **Step 1: 查当前部署套餐是否支持 cron**

Run(需 Vercel CLI;未装先 `npm i -g vercel` 并 `vercel login`):
```bash
vercel project ls
vercel project inspect viral-reviewer
```
确认:
- 套餐 tier(Hobby / Pro)。Hobby 套餐 cron **每天最多触发一次、且有 schedule 限制**;Pro 无此限。
- 周度 schedule `0 8 * * 1` 是否被套餐允许。

若无法用 CLI 查,登录 Vercel Dashboard → 项目 → Settings → Crons 看是否可创建。

- [ ] **Step 2: 配置两个 env var**

`CRON_SECRET` 是 Vercel Cron 自带(创建 cron 后平台自动注入),但 `ADMIN_TRIGGER_SECRET` **必须手动配**:

```bash
vercel env add ADMIN_TRIGGER_SECRET production
# 粘贴一个强随机串(如 openssl rand -hex 32 的输出)
vercel env add ADMIN_TRIGGER_SECRET preview
```

本地开发用:在 `.env.local` 追加一行 `ADMIN_TRIGGER_SECRET=<同一个或本地专用串>`。

- [ ] **Step 3: 记录验证结果**

创建 `docs/deploy/hot-tracking-cron.md`:

```markdown
# Hot Tracking — Cron 部署验证

**验证日期:** <填写>
**部署套餐:** <Hobby / Pro>

## Cron 可用性
- [ ] 套餐支持 cron
- [ ] 周度 schedule `0 8 * * 1` 被允许

## 降级方案(套餐不支持 cron 时)
用 GitHub Actions cron 每周 POST 到 `/api/cron/trending`,
带 `Authorization: Bearer ${ADMIN_TRIGGER_SECRET}` 头。
workflow 文件:`.github/workflows/trending-cron.yml`(套餐不支持时再建)。

## Env Vars
- [ ] `CRON_SECRET` —— Vercel Cron 自动注入(创建 cron 后确认存在)
- [ ] `ADMIN_TRIGGER_SECRET` —— 已手动配置(production + preview + 本地 .env.local)
- [ ] `BLOB_READ_WRITE_TOKEN` —— 已存在(现有 topic-cache 在用)
- [ ] `APIFY_TOKEN` —— 已存在
- [ ] `ANTHROPIC_API_KEY` —— 已存在
```

填写实际验证结果。

- [ ] **Step 4: Commit**

```bash
git add docs/deploy/hot-tracking-cron.md
git commit -m "chore(p1): document cron deployment prerequisites"
```

---

## Task P1.2: 抽 `getIsoWeek` 到 `lib/utils/iso-week.ts`

**Files:**
- Create: `lib/utils/iso-week.ts`
- Modify: `lib/topic-cache/blob-cache.ts:10-21,33-35`
- Test: `tests/utils/iso-week.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/utils/iso-week.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getIsoWeek } from "@/lib/utils/iso-week";

describe("getIsoWeek", () => {
  it("formats a mid-year date as YYYY-Www with zero-padded week", () => {
    // 2026-05-13 是周三,ISO week 20
    expect(getIsoWeek(new Date("2026-05-13T00:00:00Z"))).toBe("2026-W20");
  });

  it("zero-pads single-digit week numbers", () => {
    // 2026-01-05 是周一,ISO week 02
    expect(getIsoWeek(new Date("2026-01-05T00:00:00Z"))).toBe("2026-W02");
  });

  it("handles year-boundary: 2025-12-31 belongs to ISO week 2026-W01", () => {
    // 2025-12-31 是周三,ISO 周归属 2026-W01
    expect(getIsoWeek(new Date("2025-12-31T00:00:00Z"))).toBe("2026-W01");
  });

  it("defaults to current date when no arg passed", () => {
    expect(getIsoWeek()).toMatch(/^\d{4}-W\d{2}$/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/utils/iso-week.test.ts`
Expected: FAIL —— Cannot find module `@/lib/utils/iso-week`

- [ ] **Step 3: 创建 `lib/utils/iso-week.ts`**

把 `blob-cache.ts` 里的私有实现原样搬出:

```typescript
/**
 * ISO 8601 周字符串:2026-W20。每周一更新。
 * 从 lib/topic-cache/blob-cache.ts 抽出,供 topic-cache 与 trending 共用。
 */
export function getIsoWeek(date = new Date()): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/utils/iso-week.test.ts`
Expected: PASS(4 passed)

- [ ] **Step 5: 改 `blob-cache.ts` 用共享函数**

在 `lib/topic-cache/blob-cache.ts`:

删掉文件内的私有 `getIsoWeek` 函数(原 10-21 行整段),在顶部 import 区加:

```typescript
import { getIsoWeek } from "@/lib/utils/iso-week";
```

`cacheKey()` 等对 `getIsoWeek()` 的调用保持不变(签名一致)。

- [ ] **Step 6: 跑全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS,无类型错误(确认 blob-cache 仍编译通过)

- [ ] **Step 7: Commit**

```bash
git add lib/utils/iso-week.ts lib/topic-cache/blob-cache.ts tests/utils/iso-week.test.ts
git commit -m "refactor(p1): extract getIsoWeek into shared lib/utils/iso-week"
```

---

## Task P1.3: `lib/trending/types.ts` —— 数据 schema

**Files:**
- Create: `lib/trending/types.ts`

- [ ] **Step 1: 创建 types 文件**

创建 `lib/trending/types.ts`:

```typescript
import type { ViralVideo } from "@/lib/review-engine/types";

/** 快照 schema 版本。velocity.ts 跨周比较时校验,不一致 → 当作"无上周" → 全 NEW。 */
export const TRENDING_SCHEMA_VERSION = 1 as const;

export type PlatformMeta = {
  /** TikTok = 真趋势 actor;Instagram = 热门 hashtag 代理 */
  source: "trends-actor" | "hashtag-proxy";
  /** Apify run ID,用于追溯 */
  actorRun: string;
  /** 抓回多少条原始数据 */
  rawCount: number;
  /** Haiku 富化成功多少条 */
  enrichedCount: number;
  /** 该平台本次抓取是否成功 */
  ok: boolean;
};

export type TrendingSnapshot = {
  schemaVersion: typeof TRENDING_SCHEMA_VERSION;
  /** ISO week,如 "2026-W20" */
  week: string;
  /** ISO timestamp */
  capturedAt: string;
  /** tt + ig 混合,靠 v.platform 区分;含 Haiku 题材标签写入 v.topic */
  videos: ViralVideo[];
  meta: {
    tiktok: PlatformMeta;
    instagram: PlatformMeta;
    /** 任一平台失败 = true */
    partial: boolean;
  };
};

export type TrendTag = "rising" | "stable" | "falling" | "new";

/** velocity 是派生类型,不落盘 —— 由 velocity.ts 读取时实时算。 */
export type TrendingVideoWithVelocity = ViralVideo & {
  velocity: {
    /** (本周 views - 上周 views) / 上周 views;上周无此条 = null */
    weekOverWeek: number | null;
    rank: { current: number; previous: number | null };
    trend: TrendTag;
  };
};
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add lib/trending/types.ts
git commit -m "feat(p1): add TrendingSnapshot types with schemaVersion"
```

---

## Task P1.4: `ViralVideo` 加 `topicConfidence` 字段

**Files:**
- Modify: `lib/review-engine/types.ts:117-146`

- [ ] **Step 1: 加可选字段**

在 `lib/review-engine/types.ts` 的 `ViralVideo` type 里,`cutPlanRef?: string;` 那一行之后(闭合 `}` 之前)插入:

```typescript

  /**
   * Trending 题材标签置信度(0-1)。仅 trending snapshot 来源的视频带此字段。
   * 由 lib/trending/topic-classifier.ts 写入;retrieval.ts 按阈值过滤,
   * 只信高置信标签 —— 避免跑题样本静默注入 /analyze。
   * 字段独立,不污染语义为"题材"的 v.topic。
   */
  topicConfidence?: number;
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误(可选字段,向后兼容,现有代码不受影响)

- [ ] **Step 3: Commit**

```bash
git add lib/review-engine/types.ts
git commit -m "feat(p1): add optional ViralVideo.topicConfidence field"
```

---

## Task P1.5: `lib/trending/velocity.ts` —— 纯函数(TDD 先行)

**Files:**
- Create: `lib/trending/velocity.ts`
- Test: `tests/trending/velocity.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/trending/velocity.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeVelocity } from "@/lib/trending/velocity";
import { TRENDING_SCHEMA_VERSION, type TrendingSnapshot } from "@/lib/trending/types";
import type { ViralVideo } from "@/lib/review-engine/types";

function vid(id: string, views: number): ViralVideo {
  return {
    id,
    platform: "tiktok",
    url: `https://www.tiktok.com/@u/video/${id}`,
    cover: "",
    title: id,
    description: "",
    topic: "Travel",
    tags: [],
    views,
    likes: 0,
    comments: 0,
    shares: 0,
    duration: 20,
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "h",
    bgm: "b",
    authorHandle: "@u",
    publishedAt: "2026-05-01",
  };
}

function snapshot(week: string, videos: ViralVideo[], over: Partial<TrendingSnapshot> = {}): TrendingSnapshot {
  return {
    schemaVersion: TRENDING_SCHEMA_VERSION,
    week,
    capturedAt: `${week}-captured`,
    videos,
    meta: {
      tiktok: { source: "trends-actor", actorRun: "r1", rawCount: videos.length, enrichedCount: videos.length, ok: true },
      instagram: { source: "hashtag-proxy", actorRun: "r2", rawCount: 0, enrichedCount: 0, ok: true },
      partial: false,
    },
    ...over,
  };
}

describe("computeVelocity", () => {
  it("marks every video NEW when previous snapshot is null", () => {
    const cur = snapshot("2026-W20", [vid("a", 1000), vid("b", 500)]);
    const result = computeVelocity(cur, null);
    expect(result).toHaveLength(2);
    expect(result.every((v) => v.velocity.trend === "new")).toBe(true);
    expect(result.every((v) => v.velocity.weekOverWeek === null)).toBe(true);
    expect(result.every((v) => v.velocity.rank.previous === null)).toBe(true);
  });

  it("marks every video NEW when previous schemaVersion mismatches", () => {
    const cur = snapshot("2026-W20", [vid("a", 1000)]);
    const prev = snapshot("2026-W19", [vid("a", 800)], {
      schemaVersion: 99 as unknown as typeof TRENDING_SCHEMA_VERSION,
    });
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.trend).toBe("new");
    expect(result[0].velocity.weekOverWeek).toBeNull();
  });

  it("marks every video NEW when previous snapshot has no schemaVersion field", () => {
    // 旧快照可能完全没有 schemaVersion 字段(undefined) —— 也当作"无上周"
    const cur = snapshot("2026-W20", [vid("a", 1000)]);
    const prev = snapshot("2026-W19", [vid("a", 800)], {
      schemaVersion: undefined as unknown as typeof TRENDING_SCHEMA_VERSION,
    });
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.trend).toBe("new");
    expect(result[0].velocity.weekOverWeek).toBeNull();
  });

  it("computes rising trend when views grow >5%", () => {
    const cur = snapshot("2026-W20", [vid("a", 1500)]);
    const prev = snapshot("2026-W19", [vid("a", 1000)]);
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.weekOverWeek).toBeCloseTo(0.5);
    expect(result[0].velocity.trend).toBe("rising");
  });

  it("computes falling trend when views drop >5%", () => {
    const cur = snapshot("2026-W20", [vid("a", 800)]);
    const prev = snapshot("2026-W19", [vid("a", 1000)]);
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.weekOverWeek).toBeCloseTo(-0.2);
    expect(result[0].velocity.trend).toBe("falling");
  });

  it("computes stable trend when views change <=5%", () => {
    const cur = snapshot("2026-W20", [vid("a", 1020)]);
    const prev = snapshot("2026-W19", [vid("a", 1000)]);
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.trend).toBe("stable");
  });

  it("marks a video NEW when it is absent from previous snapshot", () => {
    const cur = snapshot("2026-W20", [vid("a", 1000), vid("newbie", 900)]);
    const prev = snapshot("2026-W19", [vid("a", 800)]);
    const result = computeVelocity(cur, prev);
    const newbie = result.find((v) => v.id === "newbie")!;
    expect(newbie.velocity.trend).toBe("new");
    expect(newbie.velocity.weekOverWeek).toBeNull();
  });

  it("tracks rank movement (current index vs previous index, sorted by views desc)", () => {
    // 上周: a(1000) #0, b(900) #1 —— 本周 b(2000) #0, a(1000) #1
    const cur = snapshot("2026-W20", [vid("b", 2000), vid("a", 1000)]);
    const prev = snapshot("2026-W19", [vid("a", 1000), vid("b", 900)]);
    const result = computeVelocity(cur, prev);
    const b = result.find((v) => v.id === "b")!;
    expect(b.velocity.rank.current).toBe(0);
    expect(b.velocity.rank.previous).toBe(1);
  });

  it("sorts output by current views descending", () => {
    const cur = snapshot("2026-W20", [vid("low", 100), vid("high", 9000)]);
    const result = computeVelocity(cur, null);
    expect(result[0].id).toBe("high");
    expect(result[1].id).toBe("low");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/trending/velocity.test.ts`
Expected: FAIL —— Cannot find module `@/lib/trending/velocity`

- [ ] **Step 3: 实现 `lib/trending/velocity.ts`**

创建 `lib/trending/velocity.ts`:

```typescript
import type { ViralVideo } from "@/lib/review-engine/types";
import {
  TRENDING_SCHEMA_VERSION,
  type TrendingSnapshot,
  type TrendingVideoWithVelocity,
  type TrendTag,
} from "./types";

/** 周环比变化超过这个比例才算 rising / falling,否则 stable。 */
const TREND_THRESHOLD = 0.05;

function sortedByViews(videos: ViralVideo[]): ViralVideo[] {
  return [...videos].sort((a, b) => b.views - a.views);
}

function classifyTrend(weekOverWeek: number | null): TrendTag {
  if (weekOverWeek === null) return "new";
  if (weekOverWeek > TREND_THRESHOLD) return "rising";
  if (weekOverWeek < -TREND_THRESHOLD) return "falling";
  return "stable";
}

/**
 * 对比相邻两周快照,给本周每条视频算 velocity / rank / trend。
 * 纯函数,无副作用 —— 注入 current + previous,返回带 velocity 的新数组。
 *
 * 边界:previous 为 null,或 previous.schemaVersion 与当前版本不一致
 * → 当作"无上周快照" → 本周全部标 NEW(weekOverWeek=null,rank.previous=null)。
 */
export function computeVelocity(
  current: TrendingSnapshot,
  previous: TrendingSnapshot | null,
): TrendingVideoWithVelocity[] {
  const curSorted = sortedByViews(current.videos);

  const usePrevious =
    previous !== null && previous.schemaVersion === TRENDING_SCHEMA_VERSION;

  const prevByIdViews = new Map<string, number>();
  const prevRankById = new Map<string, number>();
  if (usePrevious) {
    const prevSorted = sortedByViews(previous!.videos);
    prevSorted.forEach((v, i) => {
      prevByIdViews.set(v.id, v.views);
      prevRankById.set(v.id, i);
    });
  }

  return curSorted.map((v, currentRank) => {
    const prevViews = prevByIdViews.get(v.id);
    const prevRank = prevRankById.has(v.id) ? prevRankById.get(v.id)! : null;

    const weekOverWeek =
      prevViews !== undefined && prevViews > 0
        ? (v.views - prevViews) / prevViews
        : null;

    return {
      ...v,
      velocity: {
        weekOverWeek,
        rank: { current: currentRank, previous: prevRank },
        trend: classifyTrend(weekOverWeek),
      },
    };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/trending/velocity.test.ts`
Expected: PASS(9 passed)

- [ ] **Step 5: Commit**

```bash
git add lib/trending/velocity.ts tests/trending/velocity.test.ts
git commit -m "feat(p1): add velocity.ts pure function for week-over-week trend"
```

---

## Task P1.6: `lib/trending/snapshot-store.ts` —— Blob 读写 + prune

**Files:**
- Create: `lib/trending/snapshot-store.ts`
- Test: `tests/trending/snapshot-store.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/trending/snapshot-store.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

// mock @vercel/blob —— 全部 hoisted,测试里可改返回值
const putMock = vi.fn();
const headMock = vi.fn();
const listMock = vi.fn();
const delMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...a: unknown[]) => putMock(...a),
  head: (...a: unknown[]) => headMock(...a),
  list: (...a: unknown[]) => listMock(...a),
  del: (...a: unknown[]) => delMock(...a),
}));

// readSnapshot / readLatestTwoSnapshots 用全局 fetch 拉 blob 内容 —— stub 掉
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  writeSnapshot,
  pruneOldSnapshots,
  snapshotKey,
  readSnapshot,
  readLatestTwoSnapshots,
} from "@/lib/trending/snapshot-store";
import { TRENDING_SCHEMA_VERSION, type TrendingSnapshot } from "@/lib/trending/types";

const SNAP: TrendingSnapshot = {
  schemaVersion: TRENDING_SCHEMA_VERSION,
  week: "2026-W20",
  capturedAt: "2026-05-13T08:00:00Z",
  videos: [],
  meta: {
    tiktok: { source: "trends-actor", actorRun: "r1", rawCount: 0, enrichedCount: 0, ok: true },
    instagram: { source: "hashtag-proxy", actorRun: "r2", rawCount: 0, enrichedCount: 0, ok: true },
    partial: false,
  },
};

beforeEach(() => {
  putMock.mockReset();
  headMock.mockReset();
  listMock.mockReset();
  delMock.mockReset();
  fetchMock.mockReset();
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

describe("snapshotKey", () => {
  it("builds key under the trending/ namespace", () => {
    expect(snapshotKey("2026-W20")).toBe("trending/snapshot-2026-W20.json");
  });
});

describe("writeSnapshot", () => {
  it("writes JSON to the week key with allowOverwrite", async () => {
    putMock.mockResolvedValue({ url: "https://blob/x" });
    await writeSnapshot(SNAP);
    expect(putMock).toHaveBeenCalledTimes(1);
    const [key, body, opts] = putMock.mock.calls[0];
    expect(key).toBe("trending/snapshot-2026-W20.json");
    expect(JSON.parse(body as string).week).toBe("2026-W20");
    expect(opts).toMatchObject({ allowOverwrite: true, addRandomSuffix: false });
  });

  it("retries once when the first put throws", async () => {
    putMock.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ url: "ok" });
    await writeSnapshot(SNAP);
    expect(putMock).toHaveBeenCalledTimes(2);
  });

  it("no-ops when BLOB_READ_WRITE_TOKEN is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await writeSnapshot(SNAP);
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe("pruneOldSnapshots", () => {
  it("keeps the newest N weeks and deletes the rest", async () => {
    listMock.mockResolvedValue({
      blobs: [
        { pathname: "trending/snapshot-2026-W20.json", url: "u20" },
        { pathname: "trending/snapshot-2026-W19.json", url: "u19" },
        { pathname: "trending/snapshot-2026-W18.json", url: "u18" },
        { pathname: "trending/snapshot-2026-W17.json", url: "u17" },
      ],
    });
    await pruneOldSnapshots(2);
    // 保留 W20 + W19,删 W18 + W17
    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock).toHaveBeenCalledWith(["u18", "u17"]);
  });

  it("deletes nothing when snapshot count is within the keep window", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "trending/snapshot-2026-W20.json", url: "u20" }],
    });
    await pruneOldSnapshots(8);
    expect(delMock).not.toHaveBeenCalled();
  });
});

describe("readSnapshot", () => {
  it("returns the parsed snapshot for an existing week", async () => {
    headMock.mockResolvedValue({ url: "https://blob/w20" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => SNAP });
    const result = await readSnapshot("2026-W20");
    expect(result?.week).toBe("2026-W20");
    expect(headMock).toHaveBeenCalledWith("trending/snapshot-2026-W20.json");
  });

  it("returns null when head finds nothing", async () => {
    headMock.mockResolvedValue(null);
    const result = await readSnapshot("2026-W20");
    expect(result).toBeNull();
  });

  it("returns null when the blob fetch is not ok", async () => {
    headMock.mockResolvedValue({ url: "https://blob/w20" });
    fetchMock.mockResolvedValue({ ok: false });
    const result = await readSnapshot("2026-W20");
    expect(result).toBeNull();
  });

  it("returns null when BLOB_READ_WRITE_TOKEN is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const result = await readSnapshot("2026-W20");
    expect(result).toBeNull();
    expect(headMock).not.toHaveBeenCalled();
  });
});

describe("readLatestTwoSnapshots", () => {
  it("sorts blobs by pathname desc and returns the newest two", async () => {
    listMock.mockResolvedValue({
      blobs: [
        { pathname: "trending/snapshot-2026-W18.json", url: "u18" },
        { pathname: "trending/snapshot-2026-W20.json", url: "u20" },
        { pathname: "trending/snapshot-2026-W19.json", url: "u19" },
      ],
    });
    // 每个 blob 的 json() 回显它的 url,便于断言取到的是哪两个
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({ ok: true, json: async () => ({ ...SNAP, week: url }) }),
    );
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current?.week).toBe("u20"); // 最新
    expect(previous?.week).toBe("u19"); // 次新
  });

  it("returns previous=null when only one snapshot exists", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "trending/snapshot-2026-W20.json", url: "u20" }],
    });
    fetchMock.mockResolvedValue({ ok: true, json: async () => SNAP });
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current).not.toBeNull();
    expect(previous).toBeNull();
  });

  it("returns both null when no snapshots exist", async () => {
    listMock.mockResolvedValue({ blobs: [] });
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current).toBeNull();
    expect(previous).toBeNull();
  });

  it("returns both null when BLOB_READ_WRITE_TOKEN is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current).toBeNull();
    expect(previous).toBeNull();
    expect(listMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/trending/snapshot-store.test.ts`
Expected: FAIL —— Cannot find module `@/lib/trending/snapshot-store`

- [ ] **Step 3: 实现 `lib/trending/snapshot-store.ts`**

创建 `lib/trending/snapshot-store.ts`:

```typescript
import "server-only";
import { put, head, list, del } from "@vercel/blob";
import { getIsoWeek } from "@/lib/utils/iso-week";
import type { TrendingSnapshot } from "./types";

const PREFIX = "trending";

/** trending/snapshot-2026-W20.json —— 独立 namespace,与 topic-cache/ 分开。 */
export function snapshotKey(week: string): string {
  return `${PREFIX}/snapshot-${week}.json`;
}

/** 读指定周的快照;不存在 / 无 token / 出错都返回 null。 */
export async function readSnapshot(
  week: string,
): Promise<TrendingSnapshot | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const meta = await head(snapshotKey(week));
    if (!meta?.url) return null;
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as TrendingSnapshot;
  } catch {
    return null;
  }
}

/**
 * 读最新两周快照(按 week 字符串降序,ISO week 格式可直接字典序排)。
 * 看板 + velocity.ts 用。最新 = current,次新 = previous。
 */
export async function readLatestTwoSnapshots(): Promise<{
  current: TrendingSnapshot | null;
  previous: TrendingSnapshot | null;
}> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { current: null, previous: null };
  }
  try {
    const { blobs } = await list({ prefix: `${PREFIX}/` });
    const sorted = [...blobs].sort((a, b) =>
      b.pathname.localeCompare(a.pathname),
    );
    const fetchBlob = async (
      url: string | undefined,
    ): Promise<TrendingSnapshot | null> => {
      if (!url) return null;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as TrendingSnapshot;
    };
    const current = await fetchBlob(sorted[0]?.url);
    const previous = await fetchBlob(sorted[1]?.url);
    return { current, previous };
  } catch {
    return { current: null, previous: null };
  }
}

/** 写本周快照。失败重试 1 次,仍失败则 log 退出(快照幂等,下周重抓)。 */
export async function writeSnapshot(snapshot: TrendingSnapshot): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const key = snapshotKey(snapshot.week);
  const body = JSON.stringify(snapshot);
  const opts = {
    access: "public" as const,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  };
  try {
    await put(key, body, opts);
  } catch (e) {
    console.error("[snapshot-store] write failed, retrying once:", (e as Error).message);
    try {
      await put(key, body, opts);
    } catch (e2) {
      console.error("[snapshot-store] write failed after retry:", (e2 as Error).message);
    }
  }
}

/**
 * 只保留最新 keepWeeks 周快照,其余删除。
 * keepWeeks=8 —— velocity 只需 2 周,留 8 周是为未来"🔥 TOP 连续 N 周"规则
 * 攒 velocity history(spec Section 4.4 / architect L2)。
 */
export async function pruneOldSnapshots(keepWeeks = 8): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { blobs } = await list({ prefix: `${PREFIX}/` });
    const sorted = [...blobs].sort((a, b) =>
      b.pathname.localeCompare(a.pathname),
    );
    const stale = sorted.slice(keepWeeks);
    if (stale.length === 0) return;
    await del(stale.map((b) => b.url));
  } catch (e) {
    console.error("[snapshot-store] prune failed:", (e as Error).message);
  }
}

/** 当前 ISO 周,fetch.ts 写快照时用。 */
export function currentWeek(): string {
  return getIsoWeek();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/trending/snapshot-store.test.ts`
Expected: PASS(14 passed)

- [ ] **Step 5: 跑全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS,无类型错误

- [ ] **Step 6: Commit**

```bash
git add lib/trending/snapshot-store.ts tests/trending/snapshot-store.test.ts
git commit -m "feat(p1): add snapshot-store with blob read/write/prune"
```

---

## Task P1.7: 探测 `clockworks/tiktok-trends-scraper` 输出形状

> `normalizeTikTokTrendItem` 要适配真实 actor 字段名,不能猜。先跑一次 actor 把 raw item dump 出来。

**Files:**
- Create: `scripts/probe-tiktok-trends.ts`

- [ ] **Step 1: 写探测脚本**

创建 `scripts/probe-tiktok-trends.ts`:

```typescript
import { getApifyClient } from "@/lib/apify/client";

async function main() {
  const client = getApifyClient();
  // clockworks/tiktok-trends-scraper —— region + 时间窗筛选,抓 videos 类目
  const run = await client.actor("clockworks/tiktok-trends-scraper").call({
    countryCode: "US",
    // 下列输入键名以 actor README 为准,跑挂了按报错调整:
    maxItems: 5,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  console.log("run id:", run.id);
  console.log("item count:", items.length);
  console.log("first item shape:");
  console.log(JSON.stringify(items[0], null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

在 `package.json` 的 `scripts` 块加一行:

```json
    "probe:trends": "tsx --env-file=.env.local scripts/probe-tiktok-trends.ts",
```

- [ ] **Step 2: 跑探测脚本**

Run: `npm run probe:trends`
Expected: 打印一条 raw item 的 JSON 结构。

**记录下来**:`id` / `url` / `views` / `likes` / `duration` / `publishedAt` / `author` / `hashtags` / `music` 这些信息分别在 raw item 的哪个键。下一个 Task 的 normalizer 按这个真实结构写。

若 actor 输入键名报错,按 Apify 该 actor 页面的 Input schema 调整 `scripts/probe-tiktok-trends.ts` 的 `.call({...})` 参数后重跑。

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-tiktok-trends.ts package.json
git commit -m "chore(p1): add probe script for tiktok-trends-scraper output shape"
```

---

## Task P1.8: v4 schema 类型层 + `normalizeTikTokTrendingHashtag`(v4 重写)

> **v4 重写。** 原 P1.8 是「视频 normalizer」;P1.7 probe 实测发现 `clockworks/tiktok-trends-scraper` 返回的是 **hashtag 趋势榜**(spec v4)。本任务做两件事,**两个 commit checkpoint**:
> - **checkpoint 1 — v4 schema 类型层连带改动**(spec 2.7 C1):`TrendingHashtag` 类型 + `TrendingSnapshot.trendingHashtags` + Zod 同步 + `ViralVideo.trendingContext?` + 修两处 test helper
> - **checkpoint 2 — Stage 1 的 hashtag 记录 normalizer**

**Files:**
- Modify: `lib/trending/types.ts`(加 `TrendingHashtag` + `TrendingSnapshot.trendingHashtags` + Zod 同步 + 注释同步)
- Modify: `lib/review-engine/types.ts`(`ViralVideo` 加 `trendingContext?`)
- Modify: `tests/trending/snapshot-store.test.ts` + `tests/trending/velocity.test.ts`(test helper 补 `trendingHashtags: []`,否则 tsc 红)
- Modify: `lib/apify/normalize.ts`(追加 `normalizeTikTokTrendingHashtag`)
- Test: `tests/trending/types-schema.test.ts`(Zod schema 接受带 / 不带 trendingHashtags)
- Test: `tests/apify/normalize-trending-hashtag.test.ts`

### P1.7 probe 实测的真实字段映射(本任务据此写,**非猜测**)

`clockworks/tiktok-trends-scraper` 的 raw item 是 **hashtag 趋势记录**:

| `TrendingHashtag` 字段 | raw key | 说明 |
|---|---|---|
| `name` | `raw.name` | hashtag 名,如 `"tiktoktvfilmcontest"` |
| `rank` | `raw.rank` | 趋势榜排名,1 = #1 |
| `viewCount` | `raw.viewCount` | 该 hashtag 下视频聚合播放量 |
| `videoCount` | `raw.videoCount` | 使用该 hashtag 的视频数 |
| `rankDiff` | `raw.rankDiff` | 排名变化,>0 上升 |
| `isNew` | `raw.markedAsNew` | actor 标记的新晋趋势 |
| `industryName` | `raw.industryName` | 行业 / 类目标签 |

---

### Checkpoint 1 —— v4 schema 类型层

- [ ] **Step 1: 改 `lib/trending/types.ts`**

在 `TrendTag` type 之后(`TrendingVideoWithVelocity` 之前)插入 `TrendingHashtag`:

```typescript
/**
 * v4 新增:TikTok Stage 1 趋势 hashtag 记录(来自 clockworks/tiktok-trends-scraper)。
 * 字段映射见 P1.7 probe 实测结果。
 */
export type TrendingHashtag = {
  name: string;
  rank: number;
  viewCount: number;
  videoCount: number;
  rankDiff: number;
  isNew: boolean;
  industryName?: string;
};
```

在 `TrendingSnapshot` type 里,`videos` 字段**之前**插入一行(`trendingHashtags` 是**必填**字段):

```typescript
  /** v4 新增:TikTok Stage 1 趋势 hashtag 榜(IG 无此项,空数组即可)。 */
  trendingHashtags: TrendingHashtag[];
```

把 `PlatformMeta` 的 `source` 注释(architect L1 语义漂移)从:
```typescript
  /** TikTok = 真趋势 actor;Instagram = 热门 hashtag 代理 */
```
改成:
```typescript
  /** TikTok = 两阶段(Stage 1 是 trends-actor);Instagram = 热门 hashtag 代理 */
```
并把 `actorRun` / `rawCount` 注释钉死口径:
```typescript
  /** Apify run ID。TikTok 记 Stage 1 trends-scraper 的 run id */
  actorRun: string;
  /** TikTok = Stage 2 抓回的视频条数;IG = 抓回的视频条数 */
  rawCount: number;
```

把 `TrendingSnapshotSchema`(loose Zod)加 `trendingHashtags` —— **optional**(旧快照无此字段不应 parse 失败),内层 passthrough:

```typescript
export const TrendingSnapshotSchema = z
  .object({
    schemaVersion: z.number(),
    week: z.string().min(1),
    videos: z.array(
      z
        .object({
          id: z.string().min(1),
          views: z.number(),
        })
        .passthrough(),
    ),
    // v4:trendingHashtags 加为 optional —— TS type 上是必填,但 Zod 读侧 loose,
    // 旧快照(无此字段)不应 parse 失败。校验锚点不变。
    trendingHashtags: z
      .array(z.object({ name: z.string() }).passthrough())
      .optional(),
  })
  .passthrough();
```

- [ ] **Step 2: 改 `lib/review-engine/types.ts` —— `ViralVideo` 加 `trendingContext?`**

在 `ViralVideo` type 里,`topicConfidence?: number;` 那一行之后(闭合 `}` 之前)插入:

```typescript

  /**
   * v4 新增:TikTok 两阶段 Stage 2 视频记录它来自哪个趋势 hashtag。
   * 按 trendingHashtags 的 rank 升序遍历抓取,视频首次出现即锁定(见 spec 2.6)。
   * 仅 TikTok trending snapshot 来源的视频带此字段。
   */
  trendingContext?: { hashtag: string; hashtagRank: number };
```

- [ ] **Step 3: 修两处 `TrendingSnapshot` test helper(否则 tsc 红)**

`trendingHashtags` 是 `TrendingSnapshot` 的必填字段 —— 已 merge 的测试里构造 `TrendingSnapshot` 的地方会 tsc 报错。

在 `tests/trending/snapshot-store.test.ts`,`SNAP` 常量里 `videos: [],` 之后加一行:
```typescript
  trendingHashtags: [],
```

在 `tests/trending/velocity.test.ts`,`snapshot()` helper 的返回对象里 `videos,` 之后加一行:
```typescript
    trendingHashtags: [],
```

- [ ] **Step 4: 写 Zod schema 行为测试**

创建 `tests/trending/types-schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { TrendingSnapshotSchema } from "@/lib/trending/types";

const base = {
  schemaVersion: 1,
  week: "2026-W20",
  capturedAt: "2026-05-14T08:00:00Z",
  videos: [{ id: "tt-1", views: 1000 }],
  meta: { tiktok: {}, instagram: {}, partial: false },
};

describe("TrendingSnapshotSchema (v4)", () => {
  it("accepts a snapshot WITH trendingHashtags", () => {
    const r = TrendingSnapshotSchema.safeParse({
      ...base,
      trendingHashtags: [{ name: "morningroutine", rank: 1, viewCount: 9, videoCount: 3, rankDiff: 0, isNew: false }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a snapshot WITHOUT trendingHashtags (old snapshot, optional)", () => {
    const r = TrendingSnapshotSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("rejects a snapshot missing the structural anchors", () => {
    expect(TrendingSnapshotSchema.safeParse({ garbage: true }).success).toBe(false);
  });
});
```

- [ ] **Step 5: 跑测试 + 类型检查**

Run: `npm test -- tests/trending/types-schema.test.ts && npm test && npx tsc --noEmit`
Expected: types-schema 3 passed;全量 PASS;tsc clean(确认两处 test helper 修好后 tsc 不再红)

- [ ] **Step 6: Commit checkpoint 1**

```bash
git add lib/trending/types.ts lib/review-engine/types.ts tests/trending/snapshot-store.test.ts tests/trending/velocity.test.ts tests/trending/types-schema.test.ts
git commit -m "feat(p1): v4 schema type layer — TrendingHashtag + trendingContext"
```

---

### Checkpoint 2 —— Stage 1 hashtag 记录 normalizer

- [ ] **Step 7: 写失败测试**

创建 `tests/apify/normalize-trending-hashtag.test.ts`(fixture 按 P1.7 probe 实测的真实字段):

```typescript
import { describe, expect, it } from "vitest";
import { normalizeTikTokTrendingHashtag } from "@/lib/apify/normalize";

// fixture 字段名 = P1.7 probe 实测的 clockworks/tiktok-trends-scraper 真实 raw item
const RAW = {
  id: "7615394994269978635",
  name: "tiktoktvfilmcontest",
  url: "https://www.tiktok.com/tag/tiktoktvfilmcontest",
  rank: 1,
  viewCount: 202_936_112,
  videoCount: 1_234,
  rankDiff: 3,
  markedAsNew: false,
  industryName: "News & Entertainment",
  type: "hashtag",
};

describe("normalizeTikTokTrendingHashtag", () => {
  it("maps a raw trends-scraper item into a TrendingHashtag", () => {
    const h = normalizeTikTokTrendingHashtag(RAW);
    expect(h).not.toBeNull();
    expect(h!.name).toBe("tiktoktvfilmcontest");
    expect(h!.rank).toBe(1);
    expect(h!.viewCount).toBe(202_936_112);
    expect(h!.videoCount).toBe(1_234);
    expect(h!.rankDiff).toBe(3);
    expect(h!.isNew).toBe(false);
    expect(h!.industryName).toBe("News & Entertainment");
  });

  it("returns null when name is missing", () => {
    expect(normalizeTikTokTrendingHashtag({ rank: 1 })).toBeNull();
  });

  it("coerces missing numeric fields to 0 and missing markedAsNew to false", () => {
    const h = normalizeTikTokTrendingHashtag({ name: "x" });
    expect(h).not.toBeNull();
    expect(h!.rank).toBe(0);
    expect(h!.viewCount).toBe(0);
    expect(h!.videoCount).toBe(0);
    expect(h!.rankDiff).toBe(0);
    expect(h!.isNew).toBe(false);
    expect(h!.industryName).toBeUndefined();
  });
});
```

- [ ] **Step 8: 跑测试确认失败**

Run: `npm test -- tests/apify/normalize-trending-hashtag.test.ts`
Expected: FAIL —— `normalizeTikTokTrendingHashtag` is not exported

- [ ] **Step 9: 在 `lib/apify/normalize.ts` 末尾追加 normalizer**

文件顶部 import 区,把:
```typescript
import type { ViralVideo } from "@/lib/review-engine/types";
```
改成(追加 `TrendingHashtag` 的 import):
```typescript
import type { ViralVideo } from "@/lib/review-engine/types";
import type { TrendingHashtag } from "@/lib/trending/types";
```

文件末尾追加:

```typescript

/**
 * clockworks/tiktok-trends-scraper 的 raw item -> TrendingHashtag。
 * 字段映射来自 P1.7 probe 实测(该 actor 返回热门 hashtag 榜,非视频)。
 * name 缺失 → 返回 null(name 是 hashtag 的唯一锚点)。
 */
export function normalizeTikTokTrendingHashtag(
  raw: Record<string, unknown>,
): TrendingHashtag | null {
  const name = raw.name as string | undefined;
  if (!name) return null;

  const industryName = raw.industryName as string | undefined;
  return {
    name,
    rank: Number(raw.rank ?? 0),
    viewCount: Number(raw.viewCount ?? 0),
    videoCount: Number(raw.videoCount ?? 0),
    rankDiff: Number(raw.rankDiff ?? 0),
    isNew: raw.markedAsNew === true,
    ...(industryName ? { industryName } : {}),
  };
}
```

- [ ] **Step 10: 跑测试确认通过 + 全量 + 类型检查**

Run: `npm test -- tests/apify/normalize-trending-hashtag.test.ts && npm test && npx tsc --noEmit`
Expected: normalize-trending-hashtag 3 passed;全量 PASS;tsc clean

- [ ] **Step 11: Commit checkpoint 2**

```bash
git add lib/apify/normalize.ts tests/apify/normalize-trending-hashtag.test.ts
git commit -m "feat(p1): add normalizeTikTokTrendingHashtag for Stage 1 trends actor"
```

---

## Task P1.9: `scrapeTikTokTrendingHashtags` —— Stage 1(v4 重写)

**Files:**
- Modify: `lib/apify/scrapers.ts`(文件末尾追加)

> **v4 重写。** 原 P1.9 是「包装 actor 返回视频」;v4 两阶段下,本任务只做 **Stage 1** —— 包装 `clockworks/tiktok-trends-scraper` 返回 `TrendingHashtag[]`(趋势 hashtag 榜)。Stage 2(用 hashtag 抓视频)**直接复用现有 `scrapeTikTokByHashtag`,无需新代码**,在 P1.12 fetch.ts 里编排。
> 薄包装层,无单测(真实 Apify 调用无法单元测试;normalizer 已在 P1.8 单测,actor 输入键已在 P1.7 probe 验证)。

- [ ] **Step 1: 在 `lib/apify/scrapers.ts` 末尾追加**

把顶部 import 区,从:
```typescript
import { normalizeInstagramItem, normalizeTikTokItem } from "./normalize";
```
改成(追加 `normalizeTikTokTrendingHashtag`):
```typescript
import {
  normalizeInstagramItem,
  normalizeTikTokItem,
  normalizeTikTokTrendingHashtag,
} from "./normalize";
```
并在文件顶部 import 区追加 `TrendingHashtag` 类型 import:
```typescript
import type { TrendingHashtag } from "@/lib/trending/types";
```

文件末尾追加:

```typescript

/**
 * Stage 1:抓 TikTok 趋势 hashtag 榜(clockworks/tiktok-trends-scraper)。
 * 该 actor 返回的是热门 hashtag 排行榜(rank/viewCount/videoCount/…),不是视频
 * —— 见 P1.7 probe 实测 + spec v4。Stage 2 用这些 hashtag 喂 scrapeTikTokByHashtag。
 * actor 输入键(countryCode / maxItems)以 P1.7 probe 验证为准。
 */
export async function scrapeTikTokTrendingHashtags(opts?: {
  countryCode?: string;
  maxItems?: number;
}): Promise<{ hashtags: TrendingHashtag[]; runId: string }> {
  const client = getApifyClient();
  const { countryCode = "US", maxItems = 20 } = opts ?? {};

  const run = await client.actor("clockworks/tiktok-trends-scraper").call({
    countryCode,
    maxItems,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const hashtags = (items as Record<string, unknown>[])
    .map((item) => normalizeTikTokTrendingHashtag(item))
    .filter((h): h is TrendingHashtag => h !== null)
    .sort((a, b) => a.rank - b.rank);

  return { hashtags, runId: run.id };
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add lib/apify/scrapers.ts
git commit -m "feat(p1): add scrapeTikTokTrendingHashtags (Stage 1 trends actor)"
```

---

## Task P1.10: `lib/trending/ig-hot-hashtags.ts` —— IG 热门 hashtag 列表

**Files:**
- Create: `lib/trending/ig-hot-hashtags.ts`

- [ ] **Step 1: 创建文件**

创建 `lib/trending/ig-hot-hashtags.ts`:

```typescript
/**
 * IG 趋势的"代理信号"—— 人工维护的当前热门 hashtag 列表。
 *
 * 为什么是代理而非真 Explore:Apify Store 无干净的 IG Explore/trending actor,
 * IG Explore feed 对匿名访问封闭(见 spec H2)。折中:cron 抓这组 hashtag 下的
 * 高播放 reels 当作 IG 趋势代理。看板 UI 上与 TikTok 真趋势区分标注。
 *
 * 维护:每 4-8 周人工 review 一次,换掉过气标签。改动只需编辑这个数组。
 * 最后更新:2026-05-13
 */
export const IG_HOT_HASHTAGS: string[] = [
  "reels",
  "trending",
  "viralreels",
  "explorepage",
  "fyp",
  "transitionreel",
  "grwm",
  "dayinmylife",
];
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add lib/trending/ig-hot-hashtags.ts
git commit -m "feat(p1): add maintained IG hot-hashtag list for trend proxy"
```

---

## Task P1.11: `lib/trending/topic-classifier.ts` —— Haiku 题材标签

**Files:**
- Create: `lib/trending/topic-classifier.ts`
- Test: `tests/trending/topic-classifier.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/trending/topic-classifier.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...a: unknown[]) => createMock(...a) };
  },
}));

import { classifyTopics } from "@/lib/trending/topic-classifier";
import type { ViralVideo } from "@/lib/review-engine/types";

function vid(id: string, over: Partial<ViralVideo> = {}): ViralVideo {
  return {
    id,
    platform: "tiktok",
    url: `https://www.tiktok.com/@u/video/${id}`,
    cover: "",
    title: "morning workout routine",
    description: "high protein breakfast after gym",
    topic: "",
    tags: ["#fitness"],
    views: 1000,
    likes: 10,
    comments: 1,
    shares: 1,
    duration: 20,
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "h",
    bgm: "b",
    authorHandle: "@u",
    publishedAt: "2026-05-01",
    ...over,
  };
}

function mockReply(obj: unknown) {
  createMock.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(obj) }],
  });
}

beforeEach(() => {
  createMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("classifyTopics", () => {
  it("writes topic and topicConfidence onto each video", async () => {
    mockReply({ topic: "早餐健身", confidence: 0.92 });
    const [out] = await classifyTopics([vid("a")], ["早餐健身", "旅行 vlog"]);
    expect(out.topic).toBe("早餐健身");
    expect(out.topicConfidence).toBeCloseTo(0.92);
  });

  it("leaves topicConfidence undefined when the LLM call throws", async () => {
    createMock.mockRejectedValueOnce(new Error("api down"));
    const [out] = await classifyTopics([vid("a")], ["早餐健身"]);
    expect(out.topicConfidence).toBeUndefined();
    // 分类失败不写 topic,保留原值(空串)
    expect(out.topic).toBe("");
  });

  it("leaves topicConfidence undefined when reply JSON is malformed", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json" }],
    });
    const [out] = await classifyTopics([vid("a")], ["早餐健身"]);
    expect(out.topicConfidence).toBeUndefined();
  });

  it("clamps confidence into [0,1]", async () => {
    mockReply({ topic: "x", confidence: 1.7 });
    const [out] = await classifyTopics([vid("a")], ["x"]);
    expect(out.topicConfidence).toBe(1);
  });

  it("processes every video in the batch", async () => {
    mockReply({ topic: "早餐健身", confidence: 0.8 });
    mockReply({ topic: "旅行 vlog", confidence: 0.7 });
    const out = await classifyTopics([vid("a"), vid("b")], ["早餐健身", "旅行 vlog"]);
    expect(out).toHaveLength(2);
    expect(out[0].topic).toBe("早餐健身");
    expect(out[1].topic).toBe("旅行 vlog");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/trending/topic-classifier.test.ts`
Expected: FAIL —— Cannot find module `@/lib/trending/topic-classifier`

- [ ] **Step 3: 实现 `lib/trending/topic-classifier.ts`**

创建 `lib/trending/topic-classifier.ts`:

```typescript
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ViralVideo } from "@/lib/review-engine/types";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function systemPrompt(libraryTopics: string[]): string {
  return `你是短视频题材分类器。给定一条视频的标题/描述/tags,判断它的题材。

已知题材库(优先归一化到下列之一,机制同 inferTopic):
${libraryTopics.map((t) => `- ${t}`).join("\n")}

若都不匹配,可输出一个新的简短题材词。
同时给出 0-1 的置信度 —— 描述信息越模糊、越拿不准,置信度越低。

仅返回 JSON:{"topic":"...","confidence":0.0-1.0}`;
}

/**
 * 给一批 trending 视频打题材标签。
 * - topic 字符串写入 v.topic(干净字符串,不掺哨兵值)
 * - 置信度写入独立字段 v.topicConfidence(0-1)
 * - 分类失败 / JSON 损坏 → 不写 topicConfidence(undefined),topic 保留原值
 *   retrieval.ts 会把 undefined 视为 0,按阈值过滤自然跳过。
 *
 * @param videos 待分类视频
 * @param libraryTopics 本地库已知题材列表,作 hint 传入(来自 loadVideos 的 distinct topics)
 */
export async function classifyTopics(
  videos: ViralVideo[],
  libraryTopics: string[],
  concurrency = 5,
): Promise<ViralVideo[]> {
  const system = systemPrompt(libraryTopics);
  const model = process.env.ENRICH_MODEL || "claude-haiku-4-5-20251001";

  async function classifyOne(v: ViralVideo): Promise<ViralVideo> {
    try {
      const r = await getClient().messages.create({
        model,
        max_tokens: 100,
        system,
        messages: [
          {
            role: "user",
            content: JSON.stringify(
              { title: v.title, description: v.description, tags: v.tags },
              null,
              2,
            ),
          },
        ],
      });
      const block = r.content[0];
      const text = block?.type === "text" ? block.text : "";
      const clean = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "");
      const parsed = JSON.parse(clean) as {
        topic?: string;
        confidence?: number;
      };
      if (typeof parsed.topic !== "string" || typeof parsed.confidence !== "number") {
        return v;
      }
      const confidence = Math.max(0, Math.min(1, parsed.confidence));
      return { ...v, topic: parsed.topic, topicConfidence: confidence };
    } catch {
      return v;
    }
  }

  const out: ViralVideo[] = [];
  for (let i = 0; i < videos.length; i += concurrency) {
    const batch = videos.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((v) => classifyOne(v)));
    out.push(...results);
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/trending/topic-classifier.test.ts`
Expected: PASS(5 passed)

- [ ] **Step 5: Commit**

```bash
git add lib/trending/topic-classifier.ts tests/trending/topic-classifier.test.ts
git commit -m "feat(p1): add Haiku topic-classifier with confidence scoring"
```

---

## Task P1.12: `lib/trending/fetch.ts` —— TikTok 两阶段编排(v4 重写)

**Files:**
- Create: `lib/trending/fetch.ts`
- Test: `tests/trending/fetch.test.ts`

> **v4 重写。** TikTok 改两阶段:Stage 1 `scrapeTikTokTrendingHashtags`(P1.9)拿趋势 hashtag 榜 → 取 top-5 → Stage 2 按 rank 升序复用现有 `scrapeTikTokByHashtag` 抓每个 hashtag 下的视频,给视频打 `trendingContext`(首次命中锁定)。IG 不变。产出的 `TrendingSnapshot` 含 `trendingHashtags` + `videos`。**原 P1.12 的测试 mock 结构(`scrapeTikTokTrendingMock` 返回 `{videos,runId}`)整段作废,连实现一起重写。**

- [ ] **Step 1: 写失败测试**

创建 `tests/trending/fetch.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";
import type { TrendingHashtag } from "@/lib/trending/types";

const scrapeTikTokTrendingHashtagsMock = vi.fn();
const scrapeTikTokByHashtagMock = vi.fn();
const scrapeInstagramByHashtagMock = vi.fn();
const enrichBatchMock = vi.fn();
const classifyTopicsMock = vi.fn();
const loadVideosMock = vi.fn();

vi.mock("@/lib/apify/scrapers", () => ({
  scrapeTikTokTrendingHashtags: (...a: unknown[]) => scrapeTikTokTrendingHashtagsMock(...a),
  scrapeTikTokByHashtag: (...a: unknown[]) => scrapeTikTokByHashtagMock(...a),
  scrapeInstagramByHashtag: (...a: unknown[]) => scrapeInstagramByHashtagMock(...a),
}));
vi.mock("@/lib/research/enrich-one", () => ({
  enrichBatch: (...a: unknown[]) => enrichBatchMock(...a),
}));
vi.mock("@/lib/trending/topic-classifier", () => ({
  classifyTopics: (...a: unknown[]) => classifyTopicsMock(...a),
}));
vi.mock("@/lib/data/load-videos", () => ({
  loadVideos: (...a: unknown[]) => loadVideosMock(...a),
}));

import { fetchTrendingSnapshot } from "@/lib/trending/fetch";

function vid(id: string, platform: "tiktok" | "instagram"): ViralVideo {
  return {
    id, platform,
    url: `https://x/${id}`, cover: "", title: id, description: "",
    topic: "", tags: [], views: 1000, likes: 1, comments: 1, shares: 1,
    duration: 20, playStyle: "未分类", visualStyle: "未分类", hook: "h",
    bgm: "b", authorHandle: "@u", publishedAt: "2026-05-01",
  };
}
function ht(name: string, rank: number): TrendingHashtag {
  return { name, rank, viewCount: 1000, videoCount: 10, rankDiff: 0, isNew: false };
}

beforeEach(() => {
  scrapeTikTokTrendingHashtagsMock.mockReset();
  scrapeTikTokByHashtagMock.mockReset();
  scrapeInstagramByHashtagMock.mockReset();
  enrichBatchMock.mockReset();
  classifyTopicsMock.mockReset();
  loadVideosMock.mockReset();
  loadVideosMock.mockResolvedValue([{ topic: "早餐健身" }, { topic: "旅行 vlog" }]);
  // enrich / classify 默认透传(保留 trendingContext 等字段)
  enrichBatchMock.mockImplementation((vs: ViralVideo[]) => Promise.resolve(vs));
  classifyTopicsMock.mockImplementation((vs: ViralVideo[]) => Promise.resolve(vs));
  // 默认:Stage 1 给 2 个 hashtag,Stage 2 每个 hashtag 给 1 条视频,IG 给 1 条
  scrapeTikTokTrendingHashtagsMock.mockResolvedValue({
    hashtags: [ht("morningroutine", 1), ht("glowup", 2)],
    runId: "run-stage1",
  });
  scrapeTikTokByHashtagMock.mockImplementation((opts: { hashtags: string[] }) =>
    Promise.resolve([vid(`tt-${opts.hashtags[0]}`, "tiktok")]),
  );
  scrapeInstagramByHashtagMock.mockResolvedValue([vid("ig1", "instagram")]);
});

describe("fetchTrendingSnapshot (two-stage TikTok)", () => {
  it("produces a snapshot with trendingHashtags + merged videos", async () => {
    const snap = await fetchTrendingSnapshot();
    expect(snap.schemaVersion).toBe(1);
    expect(snap.trendingHashtags.map((h) => h.name)).toEqual(["morningroutine", "glowup"]);
    // 2 TT 视频(每 hashtag 1 条)+ 1 IG 视频
    expect(snap.videos).toHaveLength(3);
    expect(snap.meta.tiktok.ok).toBe(true);
    expect(snap.meta.tiktok.source).toBe("trends-actor");
    expect(snap.meta.instagram.ok).toBe(true);
    expect(snap.meta.partial).toBe(false);
  });

  it("tags each TikTok video with trendingContext (hashtag + rank)", async () => {
    const snap = await fetchTrendingSnapshot();
    const ttVideo = snap.videos.find((v) => v.id === "tt-morningroutine")!;
    expect(ttVideo.trendingContext).toEqual({ hashtag: "morningroutine", hashtagRank: 1 });
    // IG 视频不带 trendingContext
    const igVideo = snap.videos.find((v) => v.id === "ig1")!;
    expect(igVideo.trendingContext).toBeUndefined();
  });

  it("first-lock by rank: a video under multiple hashtags keeps the highest-rank one", async () => {
    // morningroutine(rank 1)和 glowup(rank 2)都返回同一条 shared 视频
    scrapeTikTokByHashtagMock.mockImplementation(() =>
      Promise.resolve([vid("tt-shared", "tiktok")]),
    );
    const snap = await fetchTrendingSnapshot();
    const shared = snap.videos.filter((v) => v.id === "tt-shared");
    expect(shared).toHaveLength(1); // 去重
    expect(shared[0].trendingContext).toEqual({ hashtag: "morningroutine", hashtagRank: 1 });
  });

  it("Stage 1 fails → tiktok.ok=false, trendingHashtags=[], IG still continues", async () => {
    scrapeTikTokTrendingHashtagsMock.mockRejectedValue(new Error("stage1 down"));
    const snap = await fetchTrendingSnapshot();
    expect(snap.meta.tiktok.ok).toBe(false);
    expect(snap.trendingHashtags).toEqual([]);
    expect(snap.meta.instagram.ok).toBe(true);
    expect(snap.meta.partial).toBe(true);
    expect(snap.videos.map((v) => v.id)).toEqual(["ig1"]);
    expect(scrapeTikTokByHashtagMock).not.toHaveBeenCalled();
  });

  it("throws when BOTH platforms fail (caller must not write an empty snapshot)", async () => {
    scrapeTikTokTrendingHashtagsMock.mockRejectedValue(new Error("tt down"));
    scrapeInstagramByHashtagMock.mockRejectedValue(new Error("ig down"));
    await expect(fetchTrendingSnapshot()).rejects.toThrow(/both platforms failed/i);
  });

  it("passes library topics from loadVideos into the classifier", async () => {
    await fetchTrendingSnapshot();
    expect(classifyTopicsMock).toHaveBeenCalledTimes(1);
    const [, libraryTopics] = classifyTopicsMock.mock.calls[0];
    expect(libraryTopics).toEqual(["早餐健身", "旅行 vlog"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/trending/fetch.test.ts`
Expected: FAIL —— Cannot find module `@/lib/trending/fetch`

- [ ] **Step 3: 实现 `lib/trending/fetch.ts`**

创建 `lib/trending/fetch.ts`:

```typescript
import "server-only";
import {
  scrapeTikTokTrendingHashtags,
  scrapeTikTokByHashtag,
  scrapeInstagramByHashtag,
} from "@/lib/apify/scrapers";
import { enrichBatch } from "@/lib/research/enrich-one";
import { classifyTopics } from "./topic-classifier";
import { loadVideos } from "@/lib/data/load-videos";
import { currentWeek } from "./snapshot-store";
import {
  TRENDING_SCHEMA_VERSION,
  type PlatformMeta,
  type TrendingHashtag,
  type TrendingSnapshot,
} from "./types";
import { IG_HOT_HASHTAGS } from "./ig-hot-hashtags";
import type { ViralVideo } from "@/lib/review-engine/types";

// spec M1 钉死的抓取参数 —— 调大会线性涨成本,不要随意改
const TT_TRENDING_HASHTAG_COUNT = 5; // Stage 2 取趋势榜 top-5 hashtag
const TT_VIDEOS_PER_HASHTAG = 30;    // 每个趋势 hashtag 抓 30 条视频
const IG_RESULTS_LIMIT = 50;

function failedMeta(source: PlatformMeta["source"]): PlatformMeta {
  return { source, actorRun: "", rawCount: 0, enrichedCount: 0, ok: false };
}

/**
 * TikTok 两阶段:Stage 1 抓趋势 hashtag 榜 → 取 top-N → Stage 2 按 rank 升序
 * 复用 scrapeTikTokByHashtag 抓视频 + 打 trendingContext(首次命中锁定,见 spec 2.6)。
 * 返回 { hashtags, videos, runId } —— Stage 1 抛错时返回空。
 */
async function fetchTikTokTwoStage(): Promise<{
  hashtags: TrendingHashtag[];
  videos: ViralVideo[];
  runId: string;
  ok: boolean;
}> {
  let hashtags: TrendingHashtag[] = [];
  let runId = "";
  try {
    const stage1 = await scrapeTikTokTrendingHashtags({ maxItems: 20 });
    hashtags = stage1.hashtags;
    runId = stage1.runId;
  } catch (e) {
    console.error("[trending/fetch] TikTok Stage 1 failed:", e);
    return { hashtags: [], videos: [], runId: "", ok: false };
  }

  // Stage 2:按 rank 升序遍历 top-N hashtag,首次命中锁定 trendingContext
  const topHashtags = hashtags.slice(0, TT_TRENDING_HASHTAG_COUNT);
  const seen = new Set<string>();
  const videos: ViralVideo[] = [];
  for (const h of topHashtags) {
    try {
      const raw = await scrapeTikTokByHashtag({
        hashtags: [h.name],
        topic: "",
        resultsPerPage: TT_VIDEOS_PER_HASHTAG,
      });
      for (const v of raw) {
        if (seen.has(v.id)) continue; // 首次命中锁定:已属更高 rank hashtag 的不覆盖
        seen.add(v.id);
        videos.push({
          ...v,
          trendingContext: { hashtag: h.name, hashtagRank: h.rank },
        });
      }
    } catch (e) {
      console.error(`[trending/fetch] TikTok Stage 2 failed for #${h.name}:`, e);
    }
  }

  return { hashtags, videos, runId, ok: true };
}

/**
 * 抓 TikTok 趋势(两阶段)+ IG 热门 hashtag 代理 → enrichBatch 富化 → Haiku 题材标签
 * → 合并成一份 TrendingSnapshot(不落盘,落盘交给调用方 + snapshot-store)。
 *
 * 容错:单平台失败 → 该平台 meta.ok=false + partial=true,另一平台继续。
 * 两个平台都失败 → throw(调用方据此跳过写空快照,避免覆盖上周好数据)。
 */
export async function fetchTrendingSnapshot(): Promise<TrendingSnapshot> {
  let trendingHashtags: TrendingHashtag[] = [];
  let ttVideos: ViralVideo[] = [];
  let ttMeta: PlatformMeta = failedMeta("trends-actor");
  let igVideos: ViralVideo[] = [];
  let igMeta: PlatformMeta = failedMeta("hashtag-proxy");

  const [ttResult, igResult] = await Promise.allSettled([
    fetchTikTokTwoStage(),
    scrapeInstagramByHashtag({
      hashtags: IG_HOT_HASHTAGS,
      topic: "",
      resultsLimit: IG_RESULTS_LIMIT,
    }),
  ]);

  if (ttResult.status === "fulfilled" && ttResult.value.ok) {
    trendingHashtags = ttResult.value.hashtags;
    ttVideos = ttResult.value.videos;
    ttMeta = {
      source: "trends-actor",
      actorRun: ttResult.value.runId, // Stage 1 run id(spec L2)
      rawCount: ttVideos.length,      // Stage 2 视频数(spec L2)
      enrichedCount: 0,
      ok: true,
    };
  } else {
    const reason =
      ttResult.status === "rejected" ? ttResult.reason : "Stage 1 failed";
    console.error("[trending/fetch] TikTok failed:", reason);
  }

  if (igResult.status === "fulfilled") {
    igVideos = igResult.value;
    igMeta = {
      source: "hashtag-proxy",
      actorRun: "",
      rawCount: igVideos.length,
      enrichedCount: 0,
      ok: true,
    };
  } else {
    console.error("[trending/fetch] Instagram scrape failed:", igResult.reason);
  }

  if (!ttMeta.ok && !igMeta.ok) {
    throw new Error("[trending/fetch] both platforms failed — skip writing snapshot");
  }

  // 富化(playStyle / visualStyle / hook)+ 题材标签
  const merged = [...ttVideos, ...igVideos];
  const libraryTopics = Array.from(
    new Set((await loadVideos()).map((v) => v.topic)),
  );
  const enriched = await enrichBatch(merged);
  const classified = await classifyTopics(enriched, libraryTopics);

  ttMeta.enrichedCount = classified.filter((v) => v.platform === "tiktok").length;
  igMeta.enrichedCount = classified.filter((v) => v.platform === "instagram").length;

  return {
    schemaVersion: TRENDING_SCHEMA_VERSION,
    week: currentWeek(),
    capturedAt: new Date().toISOString(),
    trendingHashtags,
    videos: classified,
    meta: {
      tiktok: ttMeta,
      instagram: igMeta,
      partial: !ttMeta.ok || !igMeta.ok,
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/trending/fetch.test.ts`
Expected: PASS(6 passed)

- [ ] **Step 5: 跑全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS,无类型错误

- [ ] **Step 6: Commit**

```bash
git add lib/trending/fetch.ts tests/trending/fetch.test.ts
git commit -m "feat(p1): two-stage TikTok fetchTrendingSnapshot orchestration"
```

---

## Task P1.13: `app/api/cron/trending/route.ts` —— Cron handler(双认证)

**Files:**
- Create: `app/api/cron/trending/route.ts`
- Test: `tests/api/cron-trending.test.ts`

> **🔧 v4.1 修订说明:** route 逻辑**不变**(它只是把 `fetchTrendingSnapshot()` 的产出透传给 `writeSnapshot` + `pruneOldSnapshots`)。唯一改动:Step 1 测试里 mock `fetchTrendingSnapshot` 的返回对象,在原有 `{ week, meta: { partial } }` 基础上**补 `trendingHashtags: []`**(v4 后 `TrendingSnapshot` 含此必填字段)。其余照原 task 实施。

- [ ] **Step 1: 写失败测试**

创建 `tests/api/cron-trending.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchSnapshotMock = vi.fn();
const writeSnapshotMock = vi.fn();
const pruneMock = vi.fn();

vi.mock("@/lib/trending/fetch", () => ({
  fetchTrendingSnapshot: (...a: unknown[]) => fetchSnapshotMock(...a),
}));
vi.mock("@/lib/trending/snapshot-store", () => ({
  writeSnapshot: (...a: unknown[]) => writeSnapshotMock(...a),
  pruneOldSnapshots: (...a: unknown[]) => pruneMock(...a),
}));

import { POST } from "@/app/api/cron/trending/route";

function req(authHeader?: string): Request {
  return new Request("https://x/api/cron/trending", {
    method: "POST",
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

beforeEach(() => {
  fetchSnapshotMock.mockReset();
  writeSnapshotMock.mockReset();
  pruneMock.mockReset();
  process.env.CRON_SECRET = "cron-secret";
  process.env.ADMIN_TRIGGER_SECRET = "admin-secret";
  fetchSnapshotMock.mockResolvedValue({ week: "2026-W20", meta: { partial: false } });
});

describe("POST /api/cron/trending", () => {
  it("returns 401 when no auth header is present", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong bearer token", async () => {
    const res = await POST(req("Bearer nope"));
    expect(res.status).toBe(401);
  });

  it("accepts the Vercel cron secret", async () => {
    const res = await POST(req("Bearer cron-secret"));
    expect(res.status).toBe(200);
    expect(writeSnapshotMock).toHaveBeenCalledTimes(1);
    expect(pruneMock).toHaveBeenCalledWith(8);
  });

  it("accepts the admin trigger secret (manual kick path)", async () => {
    const res = await POST(req("Bearer admin-secret"));
    expect(res.status).toBe(200);
  });

  it("returns 502 and does not write when both platforms failed", async () => {
    fetchSnapshotMock.mockRejectedValue(new Error("both platforms failed"));
    const res = await POST(req("Bearer cron-secret"));
    expect(res.status).toBe(502);
    expect(writeSnapshotMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/api/cron-trending.test.ts`
Expected: FAIL —— Cannot find module `@/app/api/cron/trending/route`

- [ ] **Step 3: 实现 `app/api/cron/trending/route.ts`**

创建 `app/api/cron/trending/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { fetchTrendingSnapshot } from "@/lib/trending/fetch";
import {
  writeSnapshot,
  pruneOldSnapshots,
} from "@/lib/trending/snapshot-store";

export const runtime = "nodejs";
export const maxDuration = 300;

const KEEP_WEEKS = 8;

/**
 * 双认证(architect H1):
 * - Vercel Cron 自动带 Authorization: Bearer ${CRON_SECRET}
 * - 手动触发(调试 / 套餐不支持 cron 的降级入口)带 Bearer ${ADMIN_TRIGGER_SECRET}
 * 任一通过即可。
 */
function isAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  const cronSecret = process.env.CRON_SECRET;
  const adminSecret = process.env.ADMIN_TRIGGER_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (adminSecret && auth === `Bearer ${adminSecret}`) return true;
  return false;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let snapshot;
  try {
    snapshot = await fetchTrendingSnapshot();
  } catch (e) {
    // 两个平台都失败 → fetchTrendingSnapshot throw → 不写空快照
    console.error("[cron/trending] fetch failed:", (e as Error).message);
    return NextResponse.json(
      { error: "fetch_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  await writeSnapshot(snapshot);
  await pruneOldSnapshots(KEEP_WEEKS);

  return NextResponse.json({
    ok: true,
    week: snapshot.week,
    partial: snapshot.meta.partial,
    videoCount: snapshot.videos.length,
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/api/cron-trending.test.ts`
Expected: PASS(5 passed)

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/trending/route.ts tests/api/cron-trending.test.ts
git commit -m "feat(p1): add cron route with dual auth (cron secret + admin token)"
```

---

## Task P1.14: `vercel.ts` —— cron schedule 配置

**Files:**
- Create: `vercel.ts`
- Modify: `package.json`(加 `@vercel/config` 依赖)

- [ ] **Step 1: 装 `@vercel/config`**

Run: `npm i @vercel/config`
Expected: `package.json` 的 `dependencies` 多出 `@vercel/config`

- [ ] **Step 2: 创建 `vercel.ts`**

创建 `vercel.ts`:

```typescript
import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    {
      // 每周一 08:00 UTC 抓 trending snapshot
      path: "/api/cron/trending",
      schedule: "0 8 * * 1",
    },
  ],
};
```

- [ ] **Step 3: 类型检查 + build smoke**

Run: `npx tsc --noEmit && npm run build`
Expected: 类型无错;build 成功(确认 vercel.ts 不破坏 next build)

- [ ] **Step 4: Commit**

```bash
git add vercel.ts package.json package-lock.json
git commit -m "feat(p1): add vercel.ts with weekly trending cron schedule"
```

---

## Task P1.15: `computeHashtagVelocity` —— hashtag 级 velocity(v4.1 新增,纯函数 TDD)

**Files:**
- Modify: `lib/trending/types.ts`(加 `TrendingHashtagWithVelocity` 类型)
- Modify: `lib/trending/velocity.ts`(追加 `computeHashtagVelocity`)
- Test: `tests/trending/hashtag-velocity.test.ts`

> **v4.1 新增(spec 2.8 H2)。** 两阶段下视频集合周周变 → `computeVelocity` 静默退化成几乎全 NEW。趋势 hashtag 榜才有跨周连续性 —— `computeHashtagVelocity` 是 v4 里真正能做周环比的对象,看板的涨跌 badge 主要挂它。**`computeVelocity` 不动**,这是追加函数;复用已有的私有 `classifyTrend(weekOverWeek, isNew)`。

- [ ] **Step 1: 加 `TrendingHashtagWithVelocity` 类型到 `lib/trending/types.ts`**

在 `TrendingVideoWithVelocity` type 之后追加:

```typescript
/** v4.1 新增:hashtag 级 velocity 派生类型 —— 趋势连续性主载体(见 spec 2.8)。 */
export type TrendingHashtagWithVelocity = TrendingHashtag & {
  velocity: {
    /** (本周 viewCount - 上周 viewCount) / 上周 viewCount;上周无此 hashtag = null */
    weekOverWeek: number | null;
    rank: { current: number; previous: number | null };
    trend: TrendTag;
  };
};
```

- [ ] **Step 2: 写失败测试**

创建 `tests/trending/hashtag-velocity.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeHashtagVelocity } from "@/lib/trending/velocity";
import {
  TRENDING_SCHEMA_VERSION,
  type TrendingHashtag,
  type TrendingSnapshot,
} from "@/lib/trending/types";

function ht(name: string, rank: number, viewCount: number): TrendingHashtag {
  return { name, rank, viewCount, videoCount: 10, rankDiff: 0, isNew: false };
}

function snap(
  week: string,
  hashtags: TrendingHashtag[],
  over: Partial<TrendingSnapshot> = {},
): TrendingSnapshot {
  return {
    schemaVersion: TRENDING_SCHEMA_VERSION,
    week,
    capturedAt: `${week}-captured`,
    trendingHashtags: hashtags,
    videos: [],
    meta: {
      tiktok: { source: "trends-actor", actorRun: "r", rawCount: 0, enrichedCount: 0, ok: true },
      instagram: { source: "hashtag-proxy", actorRun: "", rawCount: 0, enrichedCount: 0, ok: true },
      partial: false,
    },
    ...over,
  };
}

describe("computeHashtagVelocity", () => {
  it("marks every hashtag NEW when previous is null", () => {
    const cur = snap("2026-W20", [ht("a", 1, 1000), ht("b", 2, 500)]);
    const result = computeHashtagVelocity(cur, null);
    expect(result).toHaveLength(2);
    expect(result.every((h) => h.velocity.trend === "new")).toBe(true);
    expect(result.every((h) => h.velocity.weekOverWeek === null)).toBe(true);
    expect(result.every((h) => h.velocity.rank.previous === null)).toBe(true);
  });

  it("marks every hashtag NEW when previous schemaVersion mismatches", () => {
    const cur = snap("2026-W20", [ht("a", 1, 1000)]);
    const prev = snap("2026-W19", [ht("a", 1, 800)], {
      schemaVersion: 99 as unknown as typeof TRENDING_SCHEMA_VERSION,
    });
    expect(computeHashtagVelocity(cur, prev)[0].velocity.trend).toBe("new");
  });

  it("computes rising / falling / stable from viewCount week-over-week", () => {
    const prev = snap("2026-W19", [ht("up", 1, 1000), ht("down", 2, 1000), ht("flat", 3, 1000)]);
    const cur = snap("2026-W20", [ht("up", 1, 1500), ht("down", 2, 800), ht("flat", 3, 1010)]);
    const result = computeHashtagVelocity(cur, prev);
    const byName = Object.fromEntries(result.map((h) => [h.name, h.velocity]));
    expect(byName.up.trend).toBe("rising");
    expect(byName.up.weekOverWeek).toBeCloseTo(0.5);
    expect(byName.down.trend).toBe("falling");
    expect(byName.flat.trend).toBe("stable");
  });

  it("matches hashtags by name and tracks rank change", () => {
    const prev = snap("2026-W19", [ht("a", 3, 1000)]);
    const cur = snap("2026-W20", [ht("a", 1, 1100)]);
    const a = computeHashtagVelocity(cur, prev)[0];
    expect(a.velocity.rank).toEqual({ current: 1, previous: 3 });
  });

  it("marks a hashtag NEW when absent from previous", () => {
    const prev = snap("2026-W19", [ht("a", 1, 1000)]);
    const cur = snap("2026-W20", [ht("a", 1, 1000), ht("newbie", 2, 900)]);
    const newbie = computeHashtagVelocity(cur, prev).find((h) => h.name === "newbie")!;
    expect(newbie.velocity.trend).toBe("new");
    expect(newbie.velocity.weekOverWeek).toBeNull();
  });

  it("treats present-but-prev-viewCount-0 as stable, not new", () => {
    const prev = snap("2026-W19", [ht("a", 1, 0)]);
    const cur = snap("2026-W20", [ht("a", 1, 5000)]);
    const a = computeHashtagVelocity(cur, prev)[0];
    expect(a.velocity.trend).toBe("stable");
    expect(a.velocity.weekOverWeek).toBeNull();
    expect(a.velocity.rank.previous).toBe(1);
  });

  it("sorts output by current rank ascending", () => {
    const cur = snap("2026-W20", [ht("third", 3, 1), ht("first", 1, 1), ht("second", 2, 1)]);
    expect(computeHashtagVelocity(cur, null).map((h) => h.name)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- tests/trending/hashtag-velocity.test.ts`
Expected: FAIL —— `computeHashtagVelocity` is not exported

- [ ] **Step 4: 实现 `computeHashtagVelocity`**

在 `lib/trending/velocity.ts`:

把顶部 type import 从:
```typescript
import {
  TRENDING_SCHEMA_VERSION,
  type TrendingSnapshot,
  type TrendingVideoWithVelocity,
  type TrendTag,
} from "./types";
```
改成(追加 `TrendingHashtag` + `TrendingHashtagWithVelocity`):
```typescript
import {
  TRENDING_SCHEMA_VERSION,
  type TrendingHashtag,
  type TrendingHashtagWithVelocity,
  type TrendingSnapshot,
  type TrendingVideoWithVelocity,
  type TrendTag,
} from "./types";
```

在文件末尾追加(`classifyTrend` 已是文件内私有函数,直接复用):

```typescript

/**
 * v4.1:hashtag 级 velocity —— 与 computeVelocity 同构,比较对象换成
 * trendingHashtags,按 name 跨周匹配。趋势 hashtag 榜有跨周连续性,这是 v4
 * 两阶段下真正能做周环比的对象(见 spec 2.8 H2)。输出按当周 rank 升序。
 * 边界:previous 为 null / schemaVersion 不一致 → 全标 new。
 */
export function computeHashtagVelocity(
  current: TrendingSnapshot,
  previous: TrendingSnapshot | null,
): TrendingHashtagWithVelocity[] {
  const curSorted = [...current.trendingHashtags].sort(
    (a, b) => a.rank - b.rank,
  );

  const usePrevious =
    previous !== null && previous.schemaVersion === TRENDING_SCHEMA_VERSION;

  const prevByName = new Map<string, TrendingHashtag>();
  if (usePrevious) {
    for (const h of previous!.trendingHashtags) prevByName.set(h.name, h);
  }

  return curSorted.map((h) => {
    const prev = prevByName.get(h.name);
    const inPrevious = prev !== undefined;
    const weekOverWeek =
      inPrevious && prev!.viewCount > 0
        ? (h.viewCount - prev!.viewCount) / prev!.viewCount
        : null;
    return {
      ...h,
      velocity: {
        weekOverWeek,
        rank: { current: h.rank, previous: inPrevious ? prev!.rank : null },
        trend: classifyTrend(weekOverWeek, !inPrevious),
      },
    };
  });
}
```

- [ ] **Step 5: 跑测试确认通过 + 全量 + 类型检查**

Run: `npm test -- tests/trending/hashtag-velocity.test.ts && npm test && npx tsc --noEmit`
Expected: hashtag-velocity 7 passed;全量 PASS;tsc clean

- [ ] **Step 6: Commit**

```bash
git add lib/trending/types.ts lib/trending/velocity.ts tests/trending/hashtag-velocity.test.ts
git commit -m "feat(p1): add computeHashtagVelocity for cross-week trend continuity"
```

---

# Phase P2 — Trending 读侧 surfaces

> P2 产出:`/trending` 看板可访问、`/analyze` 的 retrieval 多一层免费 snapshot 兜底。依赖 P1 的快照数据格式。

## Task P2.1: `retrieval.ts` —— snapshot 兜底层

**Files:**
- Modify: `lib/review-engine/retrieval.ts`
- Test: `tests/review-engine/retrieval-snapshot.test.ts`(纯函数 `pickSnapshotMatches`)
- Test: `tests/review-engine/retrieval-integration.test.ts`(`retrieveSimilarVideos` 链路集成)

> 本任务两个 commit checkpoint:Step 5 提交纯函数,Step 12 提交链路集成 —— 各自独立可验证。
> (回应 plan review M3:不做会触发 P2 整段重编号的拆分,改为任务内双 commit 保留编号稳定。)
>
> **🔧 v4.1 修订说明:** 链路集成测试(Step 7)里的 `snapshotWith()` helper 构造的对象**补一行 `trendingHashtags: [],`**(v4 后 `TrendingSnapshot` 含此必填字段,否则 tsc 报错)。`pickSnapshotMatches` 纯函数与 retrieval 兜底层逻辑**不受 v4 影响**(只读 `videos[]`),其余照原 task 实施。

- [ ] **Step 1: 写失败测试**

创建 `tests/review-engine/retrieval-snapshot.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { pickSnapshotMatches } from "@/lib/review-engine/retrieval";
import type { ViralVideo } from "@/lib/review-engine/types";

function vid(id: string, topic: string, topicConfidence: number | undefined, views: number): ViralVideo {
  return {
    id, platform: "tiktok",
    url: `https://x/${id}`, cover: "", title: id, description: "",
    topic, tags: [], views, likes: 1, comments: 1, shares: 1,
    duration: 20, playStyle: "未分类", visualStyle: "未分类", hook: "h",
    bgm: "b", authorHandle: "@u", publishedAt: "2026-05-01",
    ...(topicConfidence === undefined ? {} : { topicConfidence }),
  };
}

describe("pickSnapshotMatches", () => {
  it("returns videos whose topic fuzzy-matches the canonical topic", () => {
    const pool = [
      vid("a", "早餐健身", 0.9, 5000),
      vid("b", "旅行 vlog", 0.9, 9000),
    ];
    const out = pickSnapshotMatches(pool, "健身早餐", 5);
    expect(out.map((v) => v.id)).toContain("a");
    expect(out.map((v) => v.id)).not.toContain("b");
  });

  it("skips low-confidence videos even if topic matches", () => {
    const pool = [
      vid("lowconf", "早餐健身", 0.2, 5000),
      vid("highconf", "早餐健身", 0.9, 4000),
    ];
    const out = pickSnapshotMatches(pool, "早餐健身", 5);
    expect(out.map((v) => v.id)).toEqual(["highconf"]);
  });

  it("skips videos with undefined topicConfidence (treated as 0)", () => {
    const pool = [vid("noconf", "早餐健身", undefined, 5000)];
    const out = pickSnapshotMatches(pool, "早餐健身", 5);
    expect(out).toHaveLength(0);
  });

  it("returns an empty array when nothing clears the fuzzy-match threshold", () => {
    const pool = [vid("a", "宠物日常", 0.9, 5000)];
    const out = pickSnapshotMatches(pool, "量子物理", 5);
    expect(out).toHaveLength(0);
  });

  it("caps results at topK, sorted by views desc", () => {
    const pool = [
      vid("a", "健身", 0.9, 1000),
      vid("b", "健身", 0.9, 9000),
      vid("c", "健身", 0.9, 5000),
    ];
    const out = pickSnapshotMatches(pool, "健身", 2);
    expect(out.map((v) => v.id)).toEqual(["b", "c"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/review-engine/retrieval-snapshot.test.ts`
Expected: FAIL —— `pickSnapshotMatches` is not exported

- [ ] **Step 3: 在 retrieval.ts 加 `pickSnapshotMatches` 纯函数**

在 `lib/review-engine/retrieval.ts`,`RetrievalSource` type 那一行之前,插入:

```typescript
/** snapshot 兜底层:高置信题材标签的最低阈值。低于此值的视频不进 /analyze 匹配。 */
const SNAPSHOT_CONFIDENCE_THRESHOLD = 0.6;
/** snapshot 兜底层:canonicalTopic 与视频 topic 的 jaccard 模糊匹配最低分。 */
const SNAPSHOT_TOPIC_MATCH_THRESHOLD = 0.2;

/**
 * 从全局 trending snapshot 里按用户题材模糊匹配采样。
 * 纯函数:先按 topicConfidence 过滤(只信高置信标签,architect M3),
 * 再用已有的 jaccard 对 canonicalTopic 与 v.topic 算重叠分,
 * 取超阈值的、按 views 降序的 top-K。全部不命中 → 返回空数组(调用方据此走 live)。
 */
export function pickSnapshotMatches(
  snapshotVideos: ViralVideo[],
  canonicalTopic: string,
  topK: number,
): ViralVideo[] {
  const topicTokens = tokens(canonicalTopic);
  return snapshotVideos
    .filter((v) => (v.topicConfidence ?? 0) >= SNAPSHOT_CONFIDENCE_THRESHOLD)
    .map((v) => ({ v, score: jaccard(topicTokens, tokens(v.topic)) }))
    .filter((x) => x.score >= SNAPSHOT_TOPIC_MATCH_THRESHOLD)
    .sort((a, b) => b.v.views - a.v.views)
    .slice(0, topK)
    .map((x) => x.v);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/review-engine/retrieval-snapshot.test.ts`
Expected: PASS(5 passed)

- [ ] **Step 5: Commit 纯函数(checkpoint 1)**

```bash
git add lib/review-engine/retrieval.ts tests/review-engine/retrieval-snapshot.test.ts
git commit -m "feat(p2): add pickSnapshotMatches pure function for snapshot retrieval"
```

- [ ] **Step 6: `RetrievalSource` + `RetrievalStage` 各加 `"snapshot"`**

在 `lib/review-engine/retrieval.ts`,把:

```typescript
export type RetrievalSource = "local" | "cache" | "live" | "fallback";
```

改成:

```typescript
export type RetrievalSource = "local" | "cache" | "live" | "snapshot" | "fallback";
```

再把 `RetrievalStage`:

```typescript
export type RetrievalStage =
  | "topic_inference"
  | "local_lookup"
  | "cache_hit"
  | "live_research"
  | "ready"
  | "fallback";
```

改成(加 `"snapshot"` —— snapshot 命中是独立阶段,**不能复用 `"cache_hit"` 误标**,plan review C3):

```typescript
export type RetrievalStage =
  | "topic_inference"
  | "local_lookup"
  | "cache_hit"
  | "snapshot"
  | "live_research"
  | "ready"
  | "fallback";
```

- [ ] **Step 7: 写失败的链路集成测试**

创建 `tests/review-engine/retrieval-integration.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";

const loadVideosMock = vi.fn();
const inferTopicMock = vi.fn();
const readTopicCacheMock = vi.fn();
const writeTopicCacheMock = vi.fn();
const researchTopicLiveMock = vi.fn();
const readLatestTwoMock = vi.fn();

vi.mock("@/lib/data/load-videos", () => ({
  loadVideos: (...a: unknown[]) => loadVideosMock(...a),
}));
vi.mock("@/lib/research/topic-inference", () => ({
  inferTopic: (...a: unknown[]) => inferTopicMock(...a),
}));
vi.mock("@/lib/topic-cache/blob-cache", () => ({
  readTopicCache: (...a: unknown[]) => readTopicCacheMock(...a),
  writeTopicCache: (...a: unknown[]) => writeTopicCacheMock(...a),
}));
vi.mock("@/lib/research/topic-research", () => ({
  researchTopicLive: (...a: unknown[]) => researchTopicLiveMock(...a),
}));
vi.mock("@/lib/trending/snapshot-store", () => ({
  readLatestTwoSnapshots: (...a: unknown[]) => readLatestTwoMock(...a),
}));

import { retrieveSimilarVideos } from "@/lib/review-engine/retrieval";

function vid(
  id: string,
  topic: string,
  topicConfidence: number | undefined,
  views: number,
): ViralVideo {
  return {
    id, platform: "tiktok", url: `https://x/${id}`, cover: "", title: id,
    description: "", topic, tags: [], views, likes: 1, comments: 1, shares: 1,
    duration: 20, playStyle: "p", visualStyle: "vs", hook: "h", bgm: "b",
    authorHandle: "@u", publishedAt: "2026-05-01",
    ...(topicConfidence === undefined ? {} : { topicConfidence }),
  };
}

function snapshotWith(videos: ViralVideo[]) {
  return {
    schemaVersion: 1, week: "2026-W20", capturedAt: "x", videos,
    meta: { tiktok: {}, instagram: {}, partial: false },
  };
}

beforeEach(() => {
  loadVideosMock.mockReset();
  inferTopicMock.mockReset();
  readTopicCacheMock.mockReset();
  writeTopicCacheMock.mockReset();
  researchTopicLiveMock.mockReset();
  readLatestTwoMock.mockReset();
  // 默认:本地库为空、题材推断为库外、topic-cache miss、live 有结果
  loadVideosMock.mockResolvedValue([]);
  inferTopicMock.mockResolvedValue({ canonicalTopic: "早餐健身", isFromLibrary: false });
  readTopicCacheMock.mockResolvedValue(null);
  researchTopicLiveMock.mockResolvedValue({
    topic: "早餐健身", hashtags: ["fitness"],
    videos: [vid("live1", "早餐健身", undefined, 5000)],
  });
});

describe("retrieveSimilarVideos — snapshot fallback layer", () => {
  it("returns source=snapshot when the trending snapshot has a high-confidence topic match", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snapshotWith([vid("snap1", "早餐健身", 0.9, 8000)]),
      previous: null,
    });
    const result = await retrieveSimilarVideos({ topic: "早餐健身" });
    expect(result.source).toBe("snapshot");
    expect(result.videos.map((v) => v.id)).toContain("snap1");
    expect(researchTopicLiveMock).not.toHaveBeenCalled(); // 命中后不再走 live
  });

  it("falls through to live when the snapshot has no topic match (miss)", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snapshotWith([vid("snap1", "宠物日常", 0.9, 8000)]),
      previous: null,
    });
    const result = await retrieveSimilarVideos({ topic: "早餐健身" });
    expect(result.source).toBe("live");
    expect(researchTopicLiveMock).toHaveBeenCalledTimes(1);
  });

  it("skips low-confidence snapshot videos and falls through to live", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snapshotWith([vid("lowconf", "早餐健身", 0.2, 8000)]),
      previous: null,
    });
    const result = await retrieveSimilarVideos({ topic: "早餐健身" });
    expect(result.source).toBe("live");
  });

  it("falls through to live when there is no snapshot at all", async () => {
    readLatestTwoMock.mockResolvedValue({ current: null, previous: null });
    const result = await retrieveSimilarVideos({ topic: "早餐健身" });
    expect(result.source).toBe("live");
  });
});
```

- [ ] **Step 8: 跑集成测试确认失败**

Run: `npm test -- tests/review-engine/retrieval-integration.test.ts`
Expected: FAIL —— retrieveSimilarVideos 还没插 snapshot 兜底层,「命中」用例的 `source` 不会是 `"snapshot"`

- [ ] **Step 9: 在 retrieval 链 cache 与 live 之间插 snapshot 兜底层**

在 `lib/review-engine/retrieval.ts`,顶部 import 区追加:

```typescript
import { readLatestTwoSnapshots } from "@/lib/trending/snapshot-store";
```

在 `retrieveSimilarVideos` 函数体里,「3) Blob 周缓存」整段结束之后(`}` 闭合 `if (cached && ...)` 之后)、「4) Cache miss → 实时搜索」的 `emit({ stage: "live_research", ... })` 之前,插入:

```typescript
  // 3.5) Trending snapshot 兜底层(免费,live 抓取之前先试)
  //      全局快照按 canonicalTopic 模糊匹配采样;命中则直接返回,省一次 Apify。
  try {
    const { current } = await readLatestTwoSnapshots();
    if (current && current.videos.length > 0) {
      const snapMatches = pickSnapshotMatches(
        current.videos,
        canonicalTopic,
        topK,
      );
      if (snapMatches.length > 0) {
        emit({
          stage: "snapshot",
          message: `命中本周趋势快照:${snapMatches.length} 条同题材样本`,
          data: { week: current.week },
        });
        return {
          topic: canonicalTopic,
          videos: pickFromTopicPool(snapMatches, videoSignature, topK),
          matched: true,
          source: "snapshot",
          inference,
        };
      }
    }
  } catch (e) {
    console.error("[retrieval] snapshot fallback failed:", e);
  }

```

- [ ] **Step 10: 跑集成测试确认通过**

Run: `npm test -- tests/review-engine/retrieval-integration.test.ts`
Expected: PASS(4 passed)

- [ ] **Step 11: 跑全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS,无类型错误

- [ ] **Step 12: Commit 链路集成(checkpoint 2)**

```bash
git add lib/review-engine/retrieval.ts tests/review-engine/retrieval-integration.test.ts
git commit -m "feat(p2): insert trending-snapshot fallback layer into retrieval chain"
```

---

## Task P2.2: `app/api/trending/route.ts` —— 精简卡片投影 + 趋势 hashtag 榜投影

**Files:**
- Create: `app/api/trending/route.ts`
- Test: `tests/api/trending-route.test.ts`

> **🔧 v4.1 修订说明(spec v4.1 H3 决策:投影带 hashtag 榜):** 原 task 的 `/api/trending` 只返回 `{ week, cards }`。v4.1 改为返回 `{ week, cards, trendingHashtags }`:
> - 新增 `trendingHashtags` —— 对 `snapshot.trendingHashtags` 过 `computeHashtagVelocity(current, previous)`(P1.15),再做**精简投影**:每项只留 `{ name, rank, viewCount, videoCount, velocity }`(不含 `rankDiff` / `industryName` 等);看板 hashtag 榜视图(spec 4.7)用
> - `cards`(视频精简投影)逻辑不变,但每张 card 的投影里**追加 `trendingContext` 字段**(`{ hashtag, hashtagRank } | undefined`),供卡片显示「来自趋势 #hashtag」小字
> - Step 1 测试相应追加:① 验证 response 含 `trendingHashtags` 且是精简投影(不含 `rankDiff`)② 验证 card 投影含 `trendingContext` ③ 无快照时 `trendingHashtags: []`
> - 测试 fixture 的 `TrendingSnapshot` 要含 `trendingHashtags`
> 其余(精简投影是 list 端点最佳实践、平台筛选、空状态)照原 task 实施。

- [ ] **Step 1: 写失败测试**

创建 `tests/api/trending-route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrendingSnapshot } from "@/lib/trending/types";
import type { ViralVideo } from "@/lib/review-engine/types";

const readLatestTwoMock = vi.fn();
vi.mock("@/lib/trending/snapshot-store", () => ({
  readLatestTwoSnapshots: (...a: unknown[]) => readLatestTwoMock(...a),
}));

import { GET } from "@/app/api/trending/route";

function vid(id: string, platform: "tiktok" | "instagram", views: number): ViralVideo {
  return {
    id, platform, url: `https://x/${id}`, cover: "c", title: id,
    description: "desc", topic: "Travel", tags: ["#x"], views,
    likes: 1, comments: 1, shares: 1, duration: 20,
    playStyle: "p", visualStyle: "vs", hook: "h", bgm: "b",
    authorHandle: "@u", publishedAt: "2026-05-01",
  };
}

function snap(week: string, videos: ViralVideo[]): TrendingSnapshot {
  return {
    schemaVersion: 1, week, capturedAt: `${week}T08:00:00Z`, videos,
    meta: {
      tiktok: { source: "trends-actor", actorRun: "r", rawCount: videos.length, enrichedCount: videos.length, ok: true },
      instagram: { source: "hashtag-proxy", actorRun: "", rawCount: 0, enrichedCount: 0, ok: true },
      partial: false,
    },
  };
}

beforeEach(() => readLatestTwoMock.mockReset());

describe("GET /api/trending", () => {
  it("returns slim card projection, not the full enriched video", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snap("2026-W20", [vid("a", "tiktok", 9000)]),
      previous: null,
    });
    const res = await GET(new Request("https://x/api/trending"));
    const body = await res.json();
    const card = body.cards[0];
    // 精简投影只含卡片字段
    expect(Object.keys(card).sort()).toEqual(
      ["cover", "id", "platform", "title", "topic", "url", "velocity", "views"].sort(),
    );
    // 不含完整富化字段
    expect(card).not.toHaveProperty("description");
    expect(card).not.toHaveProperty("playStyle");
    expect(card).not.toHaveProperty("hook");
  });

  it("filters by platform query param", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snap("2026-W20", [vid("tt", "tiktok", 9000), vid("ig", "instagram", 8000)]),
      previous: null,
    });
    const res = await GET(new Request("https://x/api/trending?platform=instagram"));
    const body = await res.json();
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].platform).toBe("instagram");
  });

  it("returns empty cards with week=null when no snapshot exists", async () => {
    readLatestTwoMock.mockResolvedValue({ current: null, previous: null });
    const res = await GET(new Request("https://x/api/trending"));
    const body = await res.json();
    expect(body.cards).toEqual([]);
    expect(body.week).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/api/trending-route.test.ts`
Expected: FAIL —— Cannot find module `@/app/api/trending/route`

- [ ] **Step 3: 实现 `app/api/trending/route.ts`**

创建 `app/api/trending/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { readLatestTwoSnapshots } from "@/lib/trending/snapshot-store";
import { computeVelocity } from "@/lib/trending/velocity";

export const runtime = "nodejs";

/** 卡片精简投影 —— 只含看板渲染需要的字段,不返回完整富化快照。 */
export type TrendingCard = {
  id: string;
  platform: "tiktok" | "instagram";
  url: string;
  cover: string;
  title: string;
  topic: string;
  views: number;
  velocity: {
    weekOverWeek: number | null;
    rank: { current: number; previous: number | null };
    trend: "rising" | "stable" | "falling" | "new";
  };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform"); // "tiktok" | "instagram" | null(=all)

  const { current, previous } = await readLatestTwoSnapshots();
  if (!current) {
    return NextResponse.json({ week: null, cards: [] });
  }

  const withVelocity = computeVelocity(current, previous);
  const filtered =
    platform === "tiktok" || platform === "instagram"
      ? withVelocity.filter((v) => v.platform === platform)
      : withVelocity;

  const cards: TrendingCard[] = filtered.map((v) => ({
    id: v.id,
    platform: v.platform,
    url: v.url,
    cover: v.cover,
    title: v.title,
    topic: v.topic,
    views: v.views,
    velocity: v.velocity,
  }));

  return NextResponse.json({ week: current.week, cards });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/api/trending-route.test.ts`
Expected: PASS(3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/api/trending/route.ts tests/api/trending-route.test.ts
git commit -m "feat(p2): add /api/trending endpoint with slim card projection"
```

---

## Task P2.3: `components/trending/TrendingCard.tsx` —— 单卡片 + velocity badge

**Files:**
- Create: `components/trending/TrendingCard.tsx`
- Test: `tests/trending/trending-card-format.test.ts`

> badge 文案的格式化逻辑抽成纯函数 `formatVelocityBadge` 单独测(architect L4:`weekOverWeek: null` 绝不渲染 `+null%` / `NaN%`)。
>
> **🔧 v4.1 修订说明:** `TrendingCard` 组件**追加渲染** `card.trendingContext`(若有)—— 在卡片上显示一行小字「来自趋势 #{hashtag}(榜 #{hashtagRank})」(spec 4.7)。`trendingContext` 为 `undefined` 时不渲染该行(IG 视频、非 trending 来源)。`formatVelocityBadge` 纯函数与 L4 的 null 处理**不变**;card 的 props 类型补上 `trendingContext?: { hashtag: string; hashtagRank: number }`。

- [ ] **Step 1: 写失败测试**

创建 `tests/trending/trending-card-format.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatVelocityBadge } from "@/components/trending/TrendingCard";

describe("formatVelocityBadge", () => {
  it("renders NEW for trend=new with null weekOverWeek (never +null% / NaN%)", () => {
    const badge = formatVelocityBadge({ weekOverWeek: null, rank: { current: 0, previous: null }, trend: "new" });
    expect(badge.label).toBe("NEW");
    expect(badge.label).not.toContain("null");
    expect(badge.label).not.toContain("NaN");
  });

  it("renders +45% for a rising video", () => {
    const badge = formatVelocityBadge({ weekOverWeek: 0.45, rank: { current: 0, previous: 1 }, trend: "rising" });
    expect(badge.label).toBe("+45%");
  });

  it("renders -8% for a falling video", () => {
    const badge = formatVelocityBadge({ weekOverWeek: -0.08, rank: { current: 2, previous: 1 }, trend: "falling" });
    expect(badge.label).toBe("-8%");
  });

  it("renders 持平 for a stable video", () => {
    const badge = formatVelocityBadge({ weekOverWeek: 0.01, rank: { current: 1, previous: 1 }, trend: "stable" });
    expect(badge.label).toBe("持平");
  });

  it("never produces NaN even if weekOverWeek is null but trend is not 'new'", () => {
    // 防御:数据不一致时也不能渲染 NaN
    const badge = formatVelocityBadge({ weekOverWeek: null, rank: { current: 0, previous: 0 }, trend: "stable" });
    expect(badge.label).not.toContain("NaN");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/trending/trending-card-format.test.ts`
Expected: FAIL —— Cannot find module `@/components/trending/TrendingCard`

- [ ] **Step 3: 实现 `components/trending/TrendingCard.tsx`**

创建 `components/trending/TrendingCard.tsx`:

```typescript
import { TrendingUp, TrendingDown, Sparkles, Minus } from "lucide-react";
import type { TrendingCard as TrendingCardData } from "@/app/api/trending/route";

type Velocity = TrendingCardData["velocity"];

type Badge = {
  label: string;
  color: string;
  Icon: typeof TrendingUp;
};

/**
 * velocity → badge 文案。纯函数,单独测。
 * architect L4:weekOverWeek 为 null(首周 / 上周无此条 / schemaVersion 不一致)
 * 一律渲染 NEW,绝不产出 +null% / NaN%。
 */
export function formatVelocityBadge(velocity: Velocity): Badge {
  if (velocity.trend === "new" || velocity.weekOverWeek === null) {
    return { label: "NEW", color: "#22d3ee", Icon: Sparkles };
  }
  if (velocity.trend === "rising") {
    const pct = Math.round(velocity.weekOverWeek * 100);
    return { label: `+${pct}%`, color: "#22c55e", Icon: TrendingUp };
  }
  if (velocity.trend === "falling") {
    const pct = Math.round(velocity.weekOverWeek * 100);
    return { label: `${pct}%`, color: "#f43f5e", Icon: TrendingDown };
  }
  return { label: "持平", color: "#94a3b8", Icon: Minus };
}

function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(0)}K`;
  return String(views);
}

export function TrendingCard({ card }: { card: TrendingCardData }) {
  const badge = formatVelocityBadge(card.velocity);
  const platformLabel = card.platform === "tiktok" ? "TT" : "IG";

  return (
    <a
      href={card.url}
      target="_blank"
      rel="noopener noreferrer"
      className="glass-card group block overflow-hidden transition-transform hover:-translate-y-1"
    >
      <div className="relative aspect-[9/16] bg-white/[0.04]">
        {card.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.cover}
            alt={card.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-white/30 text-xs">
            无封面
          </div>
        )}
        {/* 平台角标 */}
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {platformLabel}
        </span>
        {/* velocity badge */}
        <span
          className="absolute right-2 top-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{ background: `${badge.color}26`, color: badge.color }}
        >
          <badge.Icon className="h-3 w-3" />
          {badge.label}
        </span>
      </div>
      <div className="p-3">
        <p className="line-clamp-2 text-sm text-white/85">{card.title}</p>
        <div className="mt-2 flex items-center justify-between text-xs text-white/45">
          <span>{card.topic || "未分类"}</span>
          <span>{formatViews(card.views)} 播放</span>
        </div>
        {card.platform === "instagram" && (
          <p className="mt-1 text-[10px] text-white/30">热门标签代理</p>
        )}
      </div>
    </a>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/trending/trending-card-format.test.ts`
Expected: PASS(5 passed)

- [ ] **Step 5: Commit**

```bash
git add components/trending/TrendingCard.tsx tests/trending/trending-card-format.test.ts
git commit -m "feat(p2): add TrendingCard with null-safe velocity badge"
```

---

## Task P2.4: `components/trending/PlatformFilter.tsx` —— 平台筛选(client)

**Files:**
- Create: `components/trending/PlatformFilter.tsx`

> 纯 UI client component,无独立单测(交互行为在 P2.7 E2E 覆盖)。

- [ ] **Step 1: 实现 `components/trending/PlatformFilter.tsx`**

创建 `components/trending/PlatformFilter.tsx`:

```typescript
"use client";

type Platform = "all" | "tiktok" | "instagram";

const OPTIONS: { value: Platform; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
];

export function PlatformFilter({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (p: Platform) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-lg bg-white/[0.04] p-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
            value === opt.value
              ? "bg-white/10 text-white"
              : "text-white/50 hover:text-white/80"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export type { Platform };
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add components/trending/PlatformFilter.tsx
git commit -m "feat(p2): add PlatformFilter client component"
```

---

## Task P2.5: `components/trending/TrendingBoard.tsx` —— 看板主体(client)

**Files:**
- Create: `components/trending/TrendingBoard.tsx`

> client component:持有 platform 筛选状态,按筛选请求 `/api/trending`。初始数据由 RSC(P2.6)注入,避免首屏空白。
>
> **🔧 v4.1 修订说明:** `TrendingBoard` 除原有的视频卡片网格外,**新增一个趋势 hashtag 榜视图**(spec 4.7):
> - props 追加 `initialTrendingHashtags`(带 velocity 的精简 hashtag 投影,来自 P2.6 RSC / `/api/trending`)
> - 渲染一个 hashtag 榜列表区块:每行 `#name` · rank · viewCount · videoCount · **周环比 badge**(用 hashtag 的 `velocity` 出 rising/falling/stable/new,复用 P2.3 的 `formatVelocityBadge` 或同款逻辑)
> - hashtag 榜放在视频网格之上或并排;平台筛选切到 Instagram 时 hashtag 榜可隐藏(IG 无 trendingHashtags)
> - 拉 `/api/trending` 的 fetch 把返回的 `trendingHashtags` 也 setState 进去
> 视频网格、平台筛选状态、空状态逻辑不变。

- [ ] **Step 1: 实现 `components/trending/TrendingBoard.tsx`**

创建 `components/trending/TrendingBoard.tsx`:

```typescript
"use client";

import { useState } from "react";
import { TrendingCard } from "./TrendingCard";
import { PlatformFilter, type Platform } from "./PlatformFilter";
import type { TrendingCard as TrendingCardData } from "@/app/api/trending/route";

export function TrendingBoard({
  initialWeek,
  initialCards,
}: {
  initialWeek: string | null;
  initialCards: TrendingCardData[];
}) {
  const [platform, setPlatform] = useState<Platform>("all");
  const [cards, setCards] = useState<TrendingCardData[]>(initialCards);
  const [loading, setLoading] = useState(false);

  async function handleChange(next: Platform) {
    setPlatform(next);
    setLoading(true);
    try {
      const qs = next === "all" ? "" : `?platform=${next}`;
      const res = await fetch(`/api/trending${qs}`);
      const body = await res.json();
      setCards(body.cards ?? []);
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }

  if (initialWeek === null) {
    return (
      <div className="glass-card p-12 text-center text-white/50">
        首次趋势数据将于下周一生成。
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-white/45">本周热点 · {initialWeek}</p>
        <PlatformFilter value={platform} onChange={handleChange} />
      </div>
      {loading ? (
        <div className="py-12 text-center text-white/40">加载中…</div>
      ) : cards.length === 0 ? (
        <div className="py-12 text-center text-white/40">该平台暂无数据</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((card) => (
            <TrendingCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add components/trending/TrendingBoard.tsx
git commit -m "feat(p2): add TrendingBoard client component with platform filter"
```

---

## Task P2.6: `app/trending/page.tsx` —— 看板 RSC

**Files:**
- Create: `app/trending/page.tsx`

> RSC:服务端直读最新 + 上周快照,算 velocity,把精简卡片注入 client `TrendingBoard`。
>
> **🔧 v4.1 修订说明:** RSC 除 `computeVelocity(current, previous)` 出视频 velocity 外,**还要调 `computeHashtagVelocity(current, previous)`**(P1.15)算 hashtag 级 velocity,做精简投影后作为 `initialTrendingHashtags` 一并注入 `TrendingBoard`(P2.5)。空状态(无快照)时 `initialTrendingHashtags = []`。视频卡片投影逻辑不变,但每张 card 投影**追加 `trendingContext`**(透传视频的该字段)。

- [ ] **Step 1: 实现 `app/trending/page.tsx`**

创建 `app/trending/page.tsx`:

```typescript
import { TrendingUp } from "lucide-react";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { TrendingBoard } from "@/components/trending/TrendingBoard";
import { readLatestTwoSnapshots } from "@/lib/trending/snapshot-store";
import { computeVelocity } from "@/lib/trending/velocity";
import type { TrendingCard } from "@/app/api/trending/route";

export const runtime = "nodejs";
// 看板按周更新,RSC 缓存 1 小时即可
export const revalidate = 3600;

export default async function TrendingPage() {
  const { current, previous } = await readLatestTwoSnapshots();

  let week: string | null = null;
  let cards: TrendingCard[] = [];
  if (current) {
    week = current.week;
    cards = computeVelocity(current, previous).map((v) => ({
      id: v.id,
      platform: v.platform,
      url: v.url,
      cover: v.cover,
      title: v.title,
      topic: v.topic,
      views: v.views,
      velocity: v.velocity,
    }));
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-6 py-12 lg:px-10">
        <div className="mb-10 text-center">
          <span className="pill mb-4">
            <TrendingUp className="h-3.5 h-3.5 text-[#22d3ee]" />
            平台热点 · 每周更新
          </span>
          <h1 className="text-gradient-primary text-4xl font-semibold tracking-tight md:text-5xl">
            本周 TikTok / Instagram 在涨什么
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/60">
            每周一抓 TikTok 全局趋势 + Instagram 热门标签,按周环比标注涨跌。
          </p>
        </div>
        <TrendingBoard initialWeek={week} initialCards={cards} />
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: 类型检查 + build smoke**

Run: `npx tsc --noEmit && npm run build`
Expected: 类型无错;build 成功,输出里能看到 `/trending` route

- [ ] **Step 3: 本地手测**

Run: `npm run dev`
打开 `http://localhost:3000/trending`:
- 无快照时显示「首次趋势数据将于下周一生成」
- 有快照时显示卡片网格 + 平台筛选切换正常 + badge 无 `NaN%` / `+null%`

(无 Blob 数据时只能验空状态;P1 cron 跑过后再验完整渲染。)

- [ ] **Step 4: Commit**

```bash
git add app/trending/page.tsx
git commit -m "feat(p2): add /trending board page (RSC)"
```

---

## Task P2.7: E2E —— `/trending` 看板 + `/analyze` P0 filter

**Files:**
- Modify: `package.json`(加 `@playwright/test`)
- Create: `playwright.config.ts`
- Create: `e2e/trending.spec.ts`

> 仓库当前无 Playwright,需先装。E2E 只做关键路径 smoke。

- [ ] **Step 1: 装 Playwright**

Run:
```bash
npm i -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: 创建 `playwright.config.ts`**

创建 `playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

在 `package.json` 的 `scripts` 加:

```json
    "test:e2e": "playwright test",
```

- [ ] **Step 3: 创建 `e2e/trending.spec.ts`**

创建 `e2e/trending.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test("/trending renders without NaN% or +null% in any badge", async ({ page }) => {
  await page.goto("/trending");
  // 页面要么显示空状态,要么显示卡片网格 —— 两种都不能含坏文案
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain("NaN");
  expect(bodyText).not.toContain("null%");
  // 标题始终在
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("/trending platform filter is interactive", async ({ page }) => {
  await page.goto("/trending");
  const tiktokBtn = page.getByRole("button", { name: "TikTok" });
  // 空状态下筛选器可能不渲染;有数据时点击不报错
  if (await tiktokBtn.isVisible()) {
    await tiktokBtn.click();
    await expect(page.locator("body")).not.toContainText("NaN");
  }
});
```

- [ ] **Step 4: 跑 E2E**

Run: `npm run test:e2e`
Expected: 2 passed(dev server 自动起;`/trending` 渲染、无坏文案、筛选器可点)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.ts e2e/trending.spec.ts
git commit -m "test(p2): add Playwright E2E smoke for /trending board"
```

---

## Task P2.8: 全量验证 + push

**Files:** 无

- [ ] **Step 1: 跑全量单测 + 类型检查 + lint + build**

Run:
```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```
Expected: 全部 PASS,无类型错误,lint 干净,build 成功

- [ ] **Step 2: 确认提交历史完整**

Run: `git log --oneline f24a31b..HEAD`
Expected: 看到 P0 → P1 → P2 全部 commit,顺序合理

- [ ] **Step 3: Push**

Run: `git push -u origin feat/hot-tracking-p0-p2`
Expected: 分支推到 remote

---

## v4.1 plan 修订记录(spec v4 → v4.1 驱动)

实施进行到 P1.7 时,probe 实测发现 `clockworks/tiktok-trends-scraper` 返回 hashtag 榜非视频,spec 改到 v4.1(两阶段 TikTok + hashtag/video 双留 + `computeHashtagVelocity`)。本 plan 据 spec v4.1 同步重写:

**完整重写的任务(含完整代码 + 测试):**
| Task | v4.1 前 | v4.1 后 |
|---|---|---|
| **P1.8** | `normalizeTikTokTrendItem`(视频 normalizer,BLOCKED ON P1.7) | v4 schema 类型层(`TrendingHashtag` 类型 + `TrendingSnapshot.trendingHashtags` + Zod 同步 + `ViralVideo.trendingContext` + 修两处 test helper)+ `normalizeTikTokTrendingHashtag`;两个 commit checkpoint;字段映射用 P1.7 probe 实测结果 |
| **P1.9** | `scrapeTikTokTrending` 返回视频 | `scrapeTikTokTrendingHashtags` 返回 `TrendingHashtag[]`(Stage 1);Stage 2 直接复用现有 `scrapeTikTokByHashtag` |
| **P1.12** | `fetch.ts` 单阶段抓取 | TikTok 两阶段编排(Stage 1 hashtag 榜 → top-5 → Stage 2 复用 scraper 抓视频 + 打 `trendingContext` 首次锁定);测试 mock 整段重写;成本参数 `N=5 / 30 条` 钉死 |

**新增任务:**
| Task | 内容 |
|---|---|
| **P1.15** | `computeHashtagVelocity` 纯函数 + `TrendingHashtagWithVelocity` 类型(spec 2.8 H2:hashtag 级 velocity 作趋势连续性主载体);TDD,复用 `classifyTrend` |

**加 🔧 v4.1 修订说明(原 task 体保留,标注精确增量):**
- **P1.13** —— cron 测试 fixture 补 `trendingHashtags: []`(route 逻辑不变)
- **P2.1** —— `snapshotWith()` helper 补 `trendingHashtags: []`(retrieval 逻辑不变)
- **P2.2** —— `/api/trending` 返回加 `trendingHashtags` 精简投影 + card 投影加 `trendingContext`
- **P2.3** —— `TrendingCard` 加渲染 `trendingContext` 小字
- **P2.5** —— `TrendingBoard` 加趋势 hashtag 榜视图
- **P2.6** —— RSC 加调 `computeHashtagVelocity` + 注入 `initialTrendingHashtags`

**不受影响**(plan 无改动):P0.1 / P1.1 / P1.2 / P1.3(基础)/ P1.5(`computeVelocity` 不动)/ P1.6 / P1.7 / P1.10 / P1.11 / P1.14 / P2.4 / P2.7 / P2.8

> **实施恢复点:** spec v4.1 + 本 plan 修订经 window 3 review 通过后,从 **P1.8** 恢复 subagent-driven 实施。

---

## architect plan review 处置记录

| # | 等级 | 处置 |
|---|---|---|
| C2 | Critical | ✅ 约束表 P1 指针全部核对修正:cron 双认证 P1.12→**P1.13**、velocity P1.6→**P1.5**、schemaVersion 处理 P1.6→**P1.5**、topicConfidence 写入 P1.10→**P1.11**、enrichBatch 复用 P1.10→**P1.12**(P2.x 指针经核对本就正确,未动) |
| C3 | Critical | ✅ P2.1 加 `retrieveSimilarVideos` 链路集成测试(`tests/review-engine/retrieval-integration.test.ts`,4 分支);`RetrievalStage` 加 `"snapshot"`,emit 从误用的 `"cache_hit"` 改为 `"snapshot"` |
| M1 | Critical | ✅ P1.6 补 `readSnapshot`(4 例)+ `readLatestTwoSnapshots`(4 例)测试,覆盖 list→sort→取 top2;stub 全局 `fetch` |
| H3 | 强烈建议 | ✅ P1.8 标 **BLOCKED ON P1.7**,新增 Step 1 强制用 probe 真实输出核对键名;fixture/normalizer 显式标 provisional → verified |
| H2 | 建议 | ✅ P1.5 补「上周 snapshot 无 schemaVersion 字段(undefined)」test case |
| M3 | 建议 | ⚠️ 不做整段拆分重编号(会触发 C2 同类的指针漂移风险);改为 P2.1 任务内双 commit checkpoint(纯函数 / 链路集成各一次提交) |

## Self-Review(plan 作者已执行)

**1. Spec coverage** —— 逐节核对 spec v3:
- Section 1 架构 → P1/P2 全部任务实现数据流;数据隔离(独立 `trending/` namespace)→ P1.6 `snapshotKey`
- Section 2 schema → P1.3(types + schemaVersion)、P1.4(topicConfidence)、P1.2(getIsoWeek 共享)
- Section 3 /analyze 集成 → P0.1(30d filter)、P2.1(snapshot 兜底层 + `RetrievalSource`/`RetrievalStage` 各加 `"snapshot"` + 链路集成测试覆盖 命中/未命中/低置信跳过/无快照 四分支)
- Section 4 看板 UI → P2.3-P2.6(卡片 / 筛选 / 看板 / RSC);4.5 `weekOverWeek: null` → P2.3 `formatVelocityBadge` 测试;4.4 🔥 TOP 完整规则 → 见下方「未覆盖说明」
- Section 5 错误处理 → P1.12(单/双平台失败)、P1.13(双认证 + 502 不写空)、P1.6(Blob 写重试)、P2.6(空状态)
- Section 6 测试 → 每个新模块 TDD;§6.2 retrieval 链路集成测试 → P2.1 Step 7-10;snapshot-store 读侧(`readSnapshot`/`readLatestTwoSnapshots`)测试 → P1.6;E2E → P2.7
- architect 实施约束(H1/velocity TDD/精简投影/schemaVersion/topicConfidence/复用现有层)→ 见顶部「实施约束」表,逐条映射到任务

**未覆盖说明(有意为之,非遗漏):**
- **🔥 TOP 连续 N 周规则** —— spec Section 4.4 明确 v1 降级:需 ≥3 周 velocity history 才能算,本 plan 的 `formatVelocityBadge` 只实现 NEW/rising/falling/stable。完整 TOP 规则等 cron 跑满 3 周后再做,**应作为独立后续任务录入 task list / memory**(architect L1)。
- **GitHub Actions cron 降级 workflow** —— 仅当 P1.1 验证发现套餐不支持 cron 时才需要;P1.1 的 `docs/deploy/hot-tracking-cron.md` 已写明降级方案,workflow 文件留到确认需要时再建(YAGNI)。

**2. Placeholder scan** —— 无 "TBD" / "TODO" / "类似 Task N";每个 code step 都有完整代码块;P1.7/P1.8 对 actor 字段不确定性已用「probe 先行 + 多 fallback normalizer」显式处理,非占位符。

**3. Type consistency** —— 跨任务核对:
- `TrendingSnapshot` / `PlatformMeta` / `TrendingVideoWithVelocity`(P1.3)在 P1.5/P1.6/P1.12/P2.2 一致引用
- `computeVelocity(current, previous)` 签名在 P1.5 定义,P2.2/P2.6 调用一致
- `TrendingCard` type 在 P2.2 定义并 export,P2.3/P2.5/P2.6 一致 import
- `scrapeTikTokTrending` 返回 `{ videos, runId }`(P1.9)— P1.12 按此结构解构
- `classifyTopics(videos, libraryTopics, concurrency?)`(P1.11)— P1.12 按此调用
- `pickSnapshotMatches` / `RetrievalSource` / `RetrievalStage` 三处 `"snapshot"`(P2.1)自洽

---

## Execution Handoff

Plan 已写完。按用户要求:**先 commit + push 本 plan,通知窗口 3 review 任务分解,review 通过后再走 `superpowers:subagent-driven-development` 实施。**

实施阶段两种方式(留待窗口 3 review 后选择):
1. **Subagent-Driven(推荐)** —— 每个 Task 派新 subagent,任务间 review,快速迭代
2. **Inline Execution** —— 当前 session 批量执行,checkpoint review
