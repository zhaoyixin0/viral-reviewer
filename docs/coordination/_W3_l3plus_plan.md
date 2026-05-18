# L3+ Plan: trending 完整 dashboard + review 爆款洞察 Banner

> W3 私域 plan(`_W3_` 前缀)。仅供 W3 内部 review,不派发,**不实施**。
> 作者:W3-planner-agent,2026-05-17。
> 关联需求:user 综合需求 A(trending L3 升级)+ 需求 B(review InsightBanner)。

---

## 0. 文档导航

| 章节 | 内容 |
|---|---|
| 1 | Scope 总览(T1-T6 一行版) |
| 2 | T1 — 富化层(`enrichTrendingVideo`) |
| 3 | T2 — 聚合层(aggregate) + Insight schema |
| 4 | T3 — cron route 编排升级 |
| 5 | T4 — `/api/trending` + RSC 服务多维度 dashboard |
| 6 | T5 — TrendingBoard multi-tab UI |
| 7 | T6 — review InsightBanner |
| 8 | 依赖关系图 |
| 9 | 窗口分配 + 7-10 天 timeline |
| 10 | 成本预算(Apify / Gemini / GCS / Cloud Run) |
| 11 | 风险评估 + mitigation |
| 12 | 关键决策点(等 user 拍板) |
| 13 | 不在 scope 内的(防 scope creep) |

---

## 1. Scope 总览

| ID | Task | 目标(一句话) | Owner | 估时 |
|---|---|---|---|---|
| T1 | 单视频富化 helper `enrichTrendingVideo` | 给 trending top-N 视频跑 Gemini → CutPlan,沿用 `lib/video/gemini-understand.ts` | W4 | 1.5 天 |
| T2 | 聚合层 + `TrendingInsight` schema | 把 N 份 CutPlan 聚合成 hashtag/BGM/event/velocity 多维报表 + Zod schema | W4 | 1.5 天 |
| T3 | cron route 编排 + 持久化 v2 snapshot | 在 `fetchTrendingSnapshot` 之后串 T1+T2,落盘 v2 snapshot + 兼容 v1 读侧 | W4 | 1 天 |
| T4 | `/api/trending` + RSC 数据投影 | 把 v2 snapshot 的 insight 投影成多 tab DTO,送给前端 | W2 | 1 天 |
| T5 | TrendingBoard multi-tab 升级 | 5 个 tab(赛道/手法/BGM/event/velocity),沿用 glass-card 视觉 | W2 | 2 天 |
| T6 | review InsightBanner | 在 `OutputPanel` 顶部插一段 banner,数据 100% 读自 v2 snapshot insight | W1 | 1.5 天 |

合计:8.5 工日(并行后实际 5-7 自然日)。

---

## 2. T1 · 单视频富化 helper `enrichTrendingVideo`

### 2.1 目标

给一个 `ViralVideo`(只有 metadata)产出一份完整 `CutPlan`(含 actions / dimensions / density),沿用 `lib/video/gemini-understand.ts` 已验证的 Gemini 2.5 Pro pipeline。

### 2.2 改动文件

**新增**:
- `lib/trending/enrich-trending-video.ts` — 单视频富化 helper
- `lib/trending/enrich-batch.ts` — 批量包装(成功 plans + 失败 reasons,**stage1 数据不丢**,参照 memory `stage2-failure-loses-stage1.md`)
- `tests/trending/enrich-trending-video.test.ts` — unit(mock Gemini + mock download)
- `tests/trending/enrich-batch.test.ts` — unit(部分失败 batch 路径)

**修改**:无(完全是新模块)。

### 2.3 改动逻辑(伪代码,**不写真实现**)

```text
function enrichTrendingVideo(video: ViralVideo):
  Promise<{ ok: true; cutPlan: CutPlan } | { ok: false; reason: string }>

  1. download video.url → tmp/<id>.mp4
     - 复用 technique-match/route.ts:209 的 host hard-check 模式
       (只允 storage.googleapis.com + apify-CDN 白名单,trending 视频 url 来自 Apify
        不来自 user input → SSRF 已防,但 host 校验仍要做)
     - download timeout 30s,失败 → { ok:false, reason:"download_failed:<err>" }

  2. ffprobe → VideoMeta(沿用 lib/video/ffprobe-meta.ts)
     - 失败 → { ok:false, reason:"ffprobe_failed:<err>" }

  3. invokeGeminiUnderstand(videoPath, meta, hints={...trending context})
     - 沿用 lib/video/gemini-understand.ts 已暴露的 entry function
     - 把 video.trendingContext.hashtag / topic 注入到 hints(让 Gemini 理解上下文)
     - 失败(Gemini timeout / parse fail) → { ok:false, reason:"gemini_failed:<err>" }
     - 注意:**LLM 输出字段全部走 loose Zod**(memory `llm-schema-looseness.md`)
       —— gemini-understand.ts 已经是 loose schema,不要改严

  4. 清理 tmp 文件(finally + try/catch silent)

  5. return { ok:true, cutPlan }
```

```text
function enrichBatch(videos: ViralVideo[], opts: { concurrency: number; maxVideos: number }):
  Promise<{
    plans: Array<{ video: ViralVideo; cutPlan: CutPlan }>;   // 成功
    failures: Array<{ videoId: string; reason: string }>;     // 失败(不丢)
  }>

  1. 用 p-limit / 手写 semaphore 控制并发(default 3)
     —— Gemini File API rate-limit ~5/s,3 并发安全
  2. videos.slice(0, maxVideos) 截断:每周富化预算 cap
  3. allSettled 收集,fulfilled → plans,rejected/{ok:false} → failures
  4. 全部失败也 return(让 caller 决定是否写 partial v2 snapshot)
```

### 2.4 输入/输出 contract

```typescript
// lib/trending/enrich-trending-video.ts
export type EnrichResult =
  | { ok: true; cutPlan: CutPlan }
  | { ok: false; reason: string };

export async function enrichTrendingVideo(
  video: ViralVideo,
  opts?: { tmpDir?: string; maxPollAttempts?: number },
): Promise<EnrichResult>;

// lib/trending/enrich-batch.ts
export type EnrichBatchOptions = {
  concurrency?: number;     // default 3
  maxVideos?: number;       // default 15(参 T3 预算)
};

export type EnrichBatchResult = {
  plans: Array<{ video: ViralVideo; cutPlan: CutPlan }>;
  failures: Array<{ videoId: string; reason: string }>;
};

export async function enrichBatch(
  videos: ViralVideo[],
  opts?: EnrichBatchOptions,
): Promise<EnrichBatchResult>;
```

### 2.5 测试要求

- **unit**:
  - Gemini mock 成功 → 返回 cutPlan(`tests/trending/enrich-trending-video.test.ts`)
  - download 失败 → `{ok:false, reason:"download_failed:..."}`
  - Gemini parse 失败(LLM 返回 invalid JSON)→ `{ok:false, reason:"gemini_failed:..."}`
  - tmp 文件被清理(spy on `rm`)
- **batch unit**:
  - 5 in / 3 success 2 fail → `plans.length===3 && failures.length===2`
  - concurrency 限流(spy 计 max parallel)
  - `maxVideos=2` → 只跑前 2 条
- **e2e**(可选,放 T3):一条真实 trending 视频跑通(scripts/probe-enrich-trending.ts)

### 2.6 验收 gates

- `npx tsc --noEmit` → exit 0
- `npx vitest run tests/trending/enrich-*` → 全绿
- 文件行数 ≤ 300(单 file ≤ 400 spec)
- function < 50 行
- 无 hardcoded API key / URL

### 2.7 File ownership lock

```yaml
T1 OWNS (exclusive write):
  - lib/trending/enrich-trending-video.ts (new)
  - lib/trending/enrich-batch.ts (new)
  - tests/trending/enrich-trending-video.test.ts (new)
  - tests/trending/enrich-batch.test.ts (new)

T1 DEPENDS ON (read-only):
  - lib/video/gemini-understand.ts (W2 owned, do NOT modify)
  - lib/video/ffprobe-meta.ts (shared, do NOT modify)
  - lib/cut-plan/schema.ts (shared, do NOT modify)
  - lib/review-engine/types.ts (shared, do NOT modify)
```

---

## 3. T2 · 聚合层 + `TrendingInsight` schema

### 3.1 目标

把 N 份 CutPlan + ViralVideo metadata 聚合成多维度报表,产出 `TrendingInsight` 单一数据对象,落进 v2 snapshot。

### 3.2 改动文件

**新增**:
- `lib/trending/insight-schema.ts` — Zod schema + TS types(`TrendingInsight` / `HashtagInsight` / `BgmInsight` / `EventInsight` / `VelocityInsight`)
- `lib/trending/aggregate.ts` — 聚合纯函数(无 side effect,无 I/O)
- `lib/trending/event-detector.ts` — 事件检测(MVP 走 hashtag 关键词匹配,见决策点 D1)
- `tests/trending/aggregate.test.ts` — unit
- `tests/trending/event-detector.test.ts` — unit
- `tests/trending/insight-schema.test.ts` — Zod parse 回归

**修改**:
- `lib/trending/types.ts` — 把 `TrendingSnapshot` schema 升级到 v2(加 `insight?: TrendingInsight` + bump `TRENDING_SCHEMA_VERSION = 2`),**保留 v1 字段全部不变**,`insight` 在 Zod 里 `optional + passthrough` —— 读侧 v1 旧快照 parse 仍过(参照 `lib/trending/types.ts:80` 现有 loose 模式)

### 3.3 改动逻辑

```text
function aggregate(
  enrichedPlans: Array<{ video, cutPlan }>,
  trendingHashtags: TrendingHashtag[],
  previousSnapshot: TrendingSnapshot | null,
): TrendingInsight

  // ---------- A) hashtag 维度 ----------
  for hashtag in trendingHashtags:
    plans_in_hashtag = enrichedPlans.filter(p => p.video.trendingContext?.hashtag === hashtag.name)
    techniqueDistribution = countTechniques(plans_in_hashtag)
      // 从 cutPlan.actions[].kind+type / dimensions.camera.dominantMovements 统计
      // 输出: { push_in: 0.6, match_cut: 0.25, jump_cut: 0.15 }(归一化到 1)
    avgDensity = avg(plans_in_hashtag.map(p => p.cutPlan.density.overall))
    topVideoIds = top-3 by views in plans_in_hashtag
    → HashtagInsight { name, videoCount, techniqueDistribution, avgDensity, topVideoIds }

  // ---------- B) BGM 维度 ----------
  bgmCounter = {}
  for plan in enrichedPlans:
    name = plan.cutPlan.bgm?.name
    if (name && name !== "") bgmCounter[name].push(plan.video.id)
  bgmInsights = sortBy hits desc, slice(0, 10)
    → Array<BgmInsight { name, hitCount, hitVideoIds, trending?: boolean }>

  // ---------- C) event 维度(MVP:hashtag 关键词 + LLM 决策点 D1) ----------
  events = detectEvents(trendingHashtags, enrichedPlans)
  // MVP 实现:维护 lib/trending/event-keywords.ts 词典
  //   { met_gala: ["metgala","ootd"], holiday_xmas: ["christmas","xmas"], ... }
  // 命中任一关键词 → 算该 event 活跃
  // → Array<EventInsight { name, displayName, matchedHashtags, matchedVideoCount, sampleVideoIds }>

  // ---------- D) velocity 维度 ----------
  velocity = computeInsightVelocity(currentInsight, previousSnapshot?.insight ?? null)
  // 对比上周 insight,算 push_in/match_cut/... 的周环比
  // 对比上周 bgmInsights,新登榜 BGM = "rising"
  // 对比上周 events,新出现 event = "new"
  // → VelocityInsight { techniqueWoW: {...}, bgmWoW: {...}, eventWoW: {...} }

  return {
    week, capturedAt,
    hashtagInsights, bgmInsights, eventInsights, velocity,
    totalEnriched: enrichedPlans.length,
  }
```

### 3.4 Zod schema 草案

```typescript
// lib/trending/insight-schema.ts
import { z } from "zod";

export const HashtagInsightSchema = z.object({
  name: z.string(),
  videoCount: z.number().int().min(0),
  // 全部 string key + number value(0-1)归一化分布
  techniqueDistribution: z.record(z.string(), z.number().min(0).max(1)).default({}),
  avgDensity: z.number().min(0).max(100).default(0),
  topVideoIds: z.array(z.string()).default([]),
});

export const BgmInsightSchema = z.object({
  name: z.string(),       // 用 z.string() 而非 z.enum —— LLM 输出歌名千变万化(loose schema rule)
  hitCount: z.number().int().min(0),
  hitVideoIds: z.array(z.string()).default([]),
  trending: z.boolean().nullable().optional(),
});

export const EventInsightSchema = z.object({
  name: z.string(),       // 字典 key,如 "met_gala"
  displayName: z.string(),// "Met Gala 2026"
  matchedHashtags: z.array(z.string()).default([]),
  matchedVideoCount: z.number().int().min(0),
  sampleVideoIds: z.array(z.string()).default([]),
});

export const VelocityInsightSchema = z.object({
  techniqueWoW: z.record(z.string(), z.number()).default({}),  // push_in: +0.15(上周 0.45→本周 0.6)
  bgmWoW: z.array(z.object({
    name: z.string(),
    trend: z.enum(["rising","stable","falling","new"]),
    deltaHits: z.number(),
  })).default([]),
  eventWoW: z.array(z.object({
    name: z.string(),
    trend: z.enum(["new","stable","ended"]),
  })).default([]),
});

export const TrendingInsightSchema = z.object({
  week: z.string(),
  capturedAt: z.string(),
  hashtagInsights: z.array(HashtagInsightSchema).default([]),
  bgmInsights: z.array(BgmInsightSchema).default([]),
  eventInsights: z.array(EventInsightSchema).default([]),
  velocity: VelocityInsightSchema,
  totalEnriched: z.number().int().min(0),
}).passthrough();   // forward-compat(参 HMAC token nonce forward-compat pattern,memory `feedback_hmac_token_implementation_defenses.md`)

export type TrendingInsight = z.infer<typeof TrendingInsightSchema>;
// ... 其余类型 export
```

### 3.5 v1→v2 schema 兼容(critical)

在 `lib/trending/types.ts`:

```typescript
// bump version
export const TRENDING_SCHEMA_VERSION = 2 as const;
// → 但 velocity.ts:40 的对比逻辑必须改 ——
//   旧 velocity check `previous.schemaVersion === TRENDING_SCHEMA_VERSION` 会让全部上周快照失效
//   改成:`previous.schemaVersion >= 1 && previous.schemaVersion <= 2`(向后兼容比较窗口)

export const TrendingSnapshotSchema = z.object({
  schemaVersion: z.number(),
  week: z.string().min(1),
  videos: z.array(z.object({ id: z.string().min(1), views: z.number() }).passthrough()),
  trendingHashtags: z.array(z.object({ name: z.string() }).passthrough()).optional(),
  insight: TrendingInsightSchema.optional(),  // v2 新加,v1 旧快照无此字段也能 parse
}).passthrough();
```

### 3.6 测试要求

- **aggregate.test.ts**:
  - 3 plans + 1 hashtag → hashtagInsights[0].techniqueDistribution 归一化 sum=1 ± 0.01
  - 空 plans → 返回 `{ ...all empty arrays, totalEnriched: 0 }`(不抛)
  - bgm name 全 null → bgmInsights = []
  - velocity:`previousSnapshot=null` → techniqueWoW={} 全空
  - velocity:同一 hashtag push_in 上周 0.4 / 本周 0.6 → techniqueWoW["push_in"]=0.2
- **event-detector.test.ts**:
  - "metgala" hashtag 命中 → eventInsights 含 met_gala
  - 无命中 → eventInsights=[]
  - case-insensitive
- **insight-schema.test.ts**:
  - parse v1 旧 snapshot(无 insight 字段)→ ok,insight=undefined
  - parse v2 snapshot 含 insight → ok,字段完整
  - parse insight 含 extra 字段 → passthrough 不丢

### 3.7 验收 gates

- tsc 0 / vitest 全绿
- `lib/trending/aggregate.ts` ≤ 250 行
- 聚合函数无 side effect(可作 `expect(fn(a,b)).toEqual(fn(a,b))` 幂等检查)

### 3.8 File ownership lock

```yaml
T2 OWNS:
  - lib/trending/insight-schema.ts (new)
  - lib/trending/aggregate.ts (new)
  - lib/trending/event-detector.ts (new)
  - lib/trending/event-keywords.ts (new, 词典常量)
  - tests/trending/aggregate.test.ts (new)
  - tests/trending/event-detector.test.ts (new)
  - tests/trending/insight-schema.test.ts (new)
  - lib/trending/types.ts (modify — schema bump v1→v2)
  - lib/trending/velocity.ts (modify — schemaVersion 兼容比较窗口)

T2 BLOCKS:
  - T3(cron route)需要 enrich-batch 接口 + insight-schema export
```

---

## 4. T3 · cron route 编排升级 + GCS 持久化

### 4.1 目标

把 T1(富化)+ T2(聚合)串到 cron route,产出 v2 snapshot 写盘。**v1 旧快照不重写**(自然 8 周 prune 淘汰)。

### 4.2 改动文件

**修改**:
- `lib/trending/fetch.ts` — `fetchTrendingSnapshot()` 末尾加 insight 流水线
- `app/api/cron/trending/route.ts` — 加 timeout watchdog(防 Gemini 卡死 → Cloud Scheduler 180s deadline)
- `lib/trending/snapshot-store.ts` — `readSnapshot` 已 loose schema 不动;`pruneOldSnapshots(keepWeeks=8)` 不动
- `tests/trending/fetch.test.ts` — 加 insight pipeline 通路测试

**新增**:
- `scripts/probe-enrich-trending.ts` — 单次手动 probe(`npm run probe:enrich-trending`)
- 在 `package.json` scripts 加 entry

### 4.3 改动逻辑

```text
in fetchTrendingSnapshot():
  ... 现有 Apify + classifyTopics 不变 ...

  // 新增 step:富化 top-N
  topN = selectTopForEnrichment(classified, n=15)
    // 选取规则:每 hashtag top-3 by views,IG 全部 top-3 by views
    // n=15 控制每周 Gemini 成本(决策点 D5)
  enrichResult = await enrichBatch(topN, { concurrency: 3, maxVideos: 15 })

  // 失败处理(stage1 不丢)
  if enrichResult.plans.length === 0:
    log.warn("enrichment all failed, snapshot will have empty insight")
    insight = emptyInsight(week)  // 仍写 snapshot,videos 数据保留
  else:
    insight = aggregate(enrichResult.plans, trendingHashtags, previousSnapshot)

  return {
    schemaVersion: 2,
    week, capturedAt,
    trendingHashtags, videos: classified,
    meta: { ...existing, enrichment: { attempted: topN.length, succeeded: enrichResult.plans.length, failures: enrichResult.failures } },
    insight,
  }
```

```text
in app/api/cron/trending/route.ts:
  - 加 AbortController + setTimeout 150s(给 Cloud Scheduler 180s 留 buffer)
  - 富化阶段必须可中断(传 signal 给 enrichBatch)
  - 部分富化结果也持久化(decision D5:不全 retry 也不全 drop)
```

### 4.4 输入/输出 contract

```typescript
// lib/trending/select-for-enrichment.ts (new helper inside lib/trending/)
export function selectTopForEnrichment(
  videos: ViralVideo[],
  opts: { topPerHashtag: number; maxTotal: number },
): ViralVideo[];

// fetchTrendingSnapshot signature 不变,但返回的 TrendingSnapshot 现在含 .insight
```

### 4.5 测试要求

- `tests/trending/fetch.test.ts` 加:
  - mock enrichBatch 返回 3 plans → snapshot.insight.totalEnriched===3
  - mock enrichBatch 返回 0 plans → snapshot.insight 仍存在(emptyInsight)
  - timeout 触发 → 已富化部分仍落盘
- e2e probe(scripts/probe-enrich-trending.ts):
  - 真实 1 条 Apify 抓回的视频 → 富化 → aggregate → 输出 JSON 到 stdout
  - 让 W3 手测确认 insight 字段非空

### 4.6 验收 gates

- tsc 0 / vitest 全绿 / build 0
- `npm run probe:enrich-trending` 真跑一次,看 stdout 有 insight
- cron route 本地 curl(带 ADMIN_TRIGGER_SECRET)→ 200 + week / videoCount / **新加 insight 字段** in response
- pre-push reviewer 不准 skip(memory `feedback_pre_push_reviewer_skip_dep_changes.md`)

### 4.7 File ownership lock

```yaml
T3 OWNS:
  - lib/trending/fetch.ts (modify)
  - lib/trending/select-for-enrichment.ts (new)
  - app/api/cron/trending/route.ts (modify, only POST handler + timeout)
  - scripts/probe-enrich-trending.ts (new)
  - package.json scripts entry (modify, single line)
  - tests/trending/fetch.test.ts (modify)

T3 DEPENDS ON:
  - T1 enrichBatch
  - T2 aggregate + insight-schema + types.ts bump
T3 BLOCKS:
  - T4(/api/trending 要读 v2 snapshot.insight)
  - T6(InsightBanner 数据来源 = v2 snapshot.insight)
```

---

## 5. T4 · `/api/trending` + RSC 数据投影

### 5.1 目标

后端把 v2 snapshot.insight 投影成多 tab 友好 DTO,送给前端。

### 5.2 改动文件

**修改**:
- `app/api/trending/route.ts` — GET response 加 `insight` 字段(投影)
- `app/trending/page.tsx` — RSC 把 insight 注入 TrendingBoard props

**新增**:
- `lib/trending/insight-projection.ts` — 投影函数(从 TrendingInsight → BoardInsightDTO,移除前端不需要的 raw fields)
- `tests/trending/insight-projection.test.ts` — unit

### 5.3 改动逻辑

```text
function projectInsightForBoard(insight: TrendingInsight, platform: "tiktok"|"instagram"|"all"):
  BoardInsightDTO

  // 平台筛选:platform === "instagram" 时,过滤掉 trendingContext.hashtag 来源(TT 独有)
  hashtagTab = insight.hashtagInsights filter by platform
  // 给前端去掉 internal-only 字段(topVideoIds 留,actions 内细节不传)

  return {
    hashtagTab: [...],
    techniqueTab: aggregate technique distribution across hashtags,
    bgmTab: insight.bgmInsights.slice(0, 10),
    eventTab: insight.eventInsights,
    velocityTab: insight.velocity,
  }

// /api/trending GET handler 调用 projectInsightForBoard(snapshot.insight, query.platform)
```

### 5.4 contract 草案

```typescript
// lib/trending/insight-projection.ts
export type BoardInsightDTO = {
  hashtagTab: Array<{ name: string; videoCount: number; techniqueDistribution: Record<string, number>; avgDensity: number; topVideoIds: string[] }>;
  techniqueTab: Array<{ technique: string; share: number; trend: "rising"|"stable"|"falling"|"new" }>;
  bgmTab: Array<{ name: string; hitCount: number; trending?: boolean; trend?: "rising"|"stable"|"falling"|"new" }>;
  eventTab: Array<{ name: string; displayName: string; matchedHashtags: string[]; matchedVideoCount: number }>;
  velocityTab: { techniqueWoW: Record<string, number>; bgmWoW: BgmWoWEntry[]; eventWoW: EventWoWEntry[] };
};

export function projectInsightForBoard(
  insight: TrendingInsight | undefined,
  platform: "tiktok" | "instagram" | "all",
): BoardInsightDTO | null;   // insight===undefined 时返 null(老快照场景)
```

### 5.5 测试要求

- unit:projection 平台过滤正确
- unit:`insight===undefined` → 返 `null`,不抛(降级路径)
- integration:`/api/trending?platform=tiktok` 含 `insight.hashtagTab[].name`

### 5.6 验收 gates

- tsc 0 / vitest 全绿
- curl `/api/trending?platform=all` 返回 200,body 含 `insight` 字段
- 老 v1 snapshot 读出(模拟 prune 之前)→ `insight: null` 返回,不 500

### 5.7 File ownership lock

```yaml
T4 OWNS:
  - app/api/trending/route.ts (modify, GET handler 加字段)
  - app/trending/page.tsx (modify, RSC 加 insight 投影)
  - lib/trending/insight-projection.ts (new)
  - tests/trending/insight-projection.test.ts (new)

T4 BLOCKS: T5(UI 渲染需要 DTO 形状定稳)
```

---

## 6. T5 · TrendingBoard multi-tab UI 升级

### 6.1 目标

把现在的"hashtag 榜 + 视频卡片 grid"升级到 5 个 tab,沿用 glass-card 视觉。

### 6.2 改动文件

**修改**:
- `components/trending/TrendingBoard.tsx` — 加 tab nav state

**新增**:
- `components/trending/tabs/HashtagTab.tsx`(已有 hashtag 板挪进来 + 加 techniqueDistribution mini-bar)
- `components/trending/tabs/TechniqueTab.tsx`(横向 bar chart:push_in 60% / match_cut 25% / ...)
- `components/trending/tabs/BgmTab.tsx`(top-10 BGM list,hit count + trend badge)
- `components/trending/tabs/EventTab.tsx`(active events 卡片,关联 hashtag chips)
- `components/trending/tabs/VelocityTab.tsx`(三栏:技法 WoW / BGM WoW / event WoW)
- `components/trending/InsightTabs.tsx`(tab nav 容器)
- `components/trending/charts/TechniqueBar.tsx`(共享小组件)
- `tests/components/trending/insight-tabs.test.tsx`(RTL render smoke)

### 6.3 改动逻辑

```text
TrendingBoard 内部 state:
  - activeTab: "hashtag" | "technique" | "bgm" | "event" | "velocity" | "videos"
  - 现有视频 grid 挪到 "videos" tab(保留兼容)
  - 默认 tab = "hashtag"(用户最熟悉的入口)

InsightTabs 组件:
  - 平铺 6 个 tab(含 "videos")
  - 数据全部从 props.insightDto 取,不发 fetch
  - 平台 filter 触发 /api/trending → setInsightDto + setCards

降级:insightDto===null → 隐藏 5 个 insight tab,只显示 videos tab(老 v1 快照场景)
```

### 6.4 contract

```typescript
// components/trending/TrendingBoard.tsx props 加:
type Props = {
  initialWeek: string | null;
  initialCards: TrendingCardData[];
  initialTrendingHashtags: TrendingHashtagCard[];
  initialInsight: BoardInsightDTO | null;  // T4 提供
};
```

### 6.5 测试要求

- RTL smoke:6 个 tab 都渲染,默认 tab=hashtag
- RTL:`initialInsight=null` → 只渲染 videos tab,不 throw
- RTL:点击 technique tab → 显示 TechniqueBar 渲染
- Playwright e2e(可选,T5 收尾):访问 /trending → tab nav 可见 → 切换不报错

### 6.6 验收 gates

- tsc 0 / vitest 全绿 / build 0
- 手测 `/trending` 本地 dev:5 个 tab 都能切换;一个 hashtag 卡片 hover 出 technique distribution
- 本地无 trending data 时(initialWeek=null)沿用 "首次趋势数据将于下周一生成" 文案不报错
- `/canary` 命中 `/trending` 路由 smoke(deploy 后)

### 6.7 File ownership lock

```yaml
T5 OWNS:
  - components/trending/TrendingBoard.tsx (modify)
  - components/trending/InsightTabs.tsx (new)
  - components/trending/tabs/*.tsx (new, 5 files)
  - components/trending/charts/TechniqueBar.tsx (new)
  - tests/components/trending/insight-tabs.test.tsx (new)

T5 DOES NOT TOUCH:
  - components/trending/TrendingCard.tsx (W4 owned vis lock)
  - components/trending/PlatformFilter.tsx (W4 owned)
```

---

## 7. T6 · review InsightBanner

### 7.1 目标

在 `/technique-match` 结果页顶部插一段 banner,显示"结合 [赛道] 本周趋势:技法 X% / BGM Y / 事件 Z / 建议 N 句"。**数据 100% 读自 GCS v2 snapshot.insight**,不增 LLM call。

### 7.2 改动文件

**新增**:
- `lib/insight/generate-banner.ts` — generator(读 snapshot.insight + user format/topic → 选 top-1 hashtag insight + template fill 或 LLM call,见决策点 D2)
- `lib/insight/insight-template.ts` — 文案 template(deterministic 模式)
- `components/review/InsightBanner.tsx` — 渲染组件
- `tests/insight/generate-banner.test.ts`
- `tests/components/review/insight-banner.test.tsx`

**修改**:
- `components/review/OutputPanel.tsx` — 顶部插 `<InsightBanner ... />`(在 mode badge 之后,verdict 之前)
- `app/api/technique-match/route.ts` — 在 `loadReferenceCutPlans` 之后、Opus matchTechniques 之前调用 `generateBanner` → 把 banner 加进 result event payload

### 7.3 改动逻辑

```text
function generateBanner(input: {
  userFormat: string;          // "vlog" / "tutorial" / ...
  userTopic?: string;          // "travel" / null
  snapshot: TrendingSnapshot | null,
}): Promise<InsightBannerData | null>

  if !snapshot?.insight: return null

  // 1) 选 best matching hashtag insight
  //    匹配规则:
  //    a) userTopic 命中任一 hashtag.name(含模糊匹配)→ 用那个
  //    b) 否则用 hashtagInsights[0](top-1)
  //    c) 全无 → 退到 techniqueTab 聚合数据
  bestHashtag = findBestHashtag(snapshot.insight.hashtagInsights, userTopic, userFormat)

  // 2) 提取 top-2 techniques
  techniques = top2(bestHashtag?.techniqueDistribution ?? insight.techniqueTab)

  // 3) 提取 top-1 BGM
  bgm = snapshot.insight.bgmInsights[0]

  // 4) 检测 active event
  event = snapshot.insight.eventInsights[0]   // 已按相关度排过

  // 5) 文案合成(deterministic template 模式,decision D2 默认)
  return {
    week: snapshot.week,
    headline: `结合本周 [${bestHashtag?.name ?? userTopic ?? userFormat} 赛道] 趋势`,
    bullets: [
      `剪辑手法:${techniques[0].name} 占 ${pct(techniques[0].share)}${techniques[1] ? ` + ${techniques[1].name} 占 ${pct(techniques[1].share)}` : ""}`,
      bgm ? `BGM Top1:"${bgm.name}"(命中 ${bgm.hitCount} 视频)` : null,
      event ? `热点事件:${event.displayName}` : null,
    ].filter(Boolean),
    actionable: composeActionable(userFormat, techniques, bgm, event),  // 2-3 句建议
    sourceWeek: snapshot.week,
    sampleVideoIds: bestHashtag?.topVideoIds ?? [],
  }
```

### 7.4 contract 草案

```typescript
// lib/insight/generate-banner.ts
export type InsightBannerData = {
  week: string;
  headline: string;          // "结合本周 [vlog 赛道] 趋势"
  bullets: string[];         // 2-4 条 facts
  actionable: string;        // "建议:开头 0-3s 用 push-in 卡 BGM drop 点,..."
  sourceWeek: string;
  sampleVideoIds: string[];  // 链到 trending top 视频
};

export async function generateBanner(input: {
  userFormat: string;
  userTopic?: string;
  snapshot: TrendingSnapshot | null;
}): Promise<InsightBannerData | null>;
```

### 7.5 SSE 集成点

`app/api/technique-match/route.ts:357` 之后(load_refs 之后)插:

```text
const snapshot = await readLatestTwoSnapshots().then(r => r.current);
const banner = await generateBanner({ userFormat, userTopic: topic, snapshot });
send({ type: "stage", stage: "insight", message: "生成爆款洞察", data: { banner } });
// banner 也加进 final result event:
send({ type: "result", data: { ..., insightBanner: banner } });
```

性能预算:`generateBanner` deterministic 模式 < 50ms(纯内存计算)。如果 D2 选 LLM 模式,要 < 3s 或异步走 partial event。

### 7.6 测试要求

- `tests/insight/generate-banner.test.ts`:
  - snapshot=null → return null
  - snapshot.insight 空 → headline 仍生成,bullets 退化文案
  - userTopic 命中 hashtag → bestHashtag 选对
  - top techniques 选对 + percentage 渲染正确
- `tests/components/review/insight-banner.test.tsx`:
  - banner=null → 组件返回 `null`,不渲染容器(不破坏现有 OutputPanel 布局)
  - 3 bullets 全渲染
  - sampleVideoIds 链接到 trending 卡片

### 7.7 验收 gates

- tsc 0 / vitest 全绿
- 手测:本地有 v2 snapshot 时,跑一次 technique-match → banner 显示在 verdict 之上
- 本地无 v2 snapshot 时(老快照)→ banner 不渲染,review 正常完成
- 注意:**multi-commit cross-check**(memory `feedback_reviewer_prompt_multi_commit_cross_check.md`)—— T6 commit 1(generator)+ commit 2(UI)review prompt 必含"上 commit 的 transient state"check

### 7.8 File ownership lock

```yaml
T6 OWNS:
  - lib/insight/generate-banner.ts (new)
  - lib/insight/insight-template.ts (new)
  - components/review/InsightBanner.tsx (new)
  - tests/insight/generate-banner.test.ts (new)
  - tests/components/review/insight-banner.test.tsx (new)
  - components/review/OutputPanel.tsx (modify, +1 ~ +3 lines around line 90)
  - app/api/technique-match/route.ts (modify, ~5 lines after line 404)

T6 DEPENDS ON:
  - T3(v2 snapshot 已落盘可读)
  - T4(insight-projection,可复用)
T6 DOES NOT TOUCH:
  - lib/sample-references/index.ts (W2 owned)
  - lib/technique-matching/* (W1 owned)
```

---

## 8. 依赖关系图

```
              ┌──────────────────────┐
              │ T2  aggregate +      │
              │     insight schema   │
              │  (W4, 1.5d)          │
              └────┬─────────────────┘
                   │ types.ts schema bump
                   ▼
┌──────────────┐   ┌──────────────────────┐
│ T1 enrich    │──▶│ T3 cron route +      │
│   helper     │   │     v2 snapshot      │
│  (W4, 1.5d)  │   │     persistence      │
└──────────────┘   │  (W4, 1d)            │
                   └────┬─────────────────┘
                        │ v2 snapshot on GCS
                        ├─────────────────┐
                        ▼                 ▼
              ┌──────────────────────┐ ┌─────────────────────┐
              │ T4 /api/trending +   │ │ T6 review           │
              │    insight projection│ │    InsightBanner    │
              │  (W2, 1d)            │ │  (W1, 1.5d)         │
              └────┬─────────────────┘ └─────────────────────┘
                   │ BoardInsightDTO
                   ▼
              ┌──────────────────────┐
              │ T5 TrendingBoard     │
              │    multi-tab UI      │
              │  (W2, 2d)            │
              └──────────────────────┘
```

**关键路径**:T2 → T3 → T4 → T5(W4+W2 串行)= 5.5 工日
**并行支路**:T1(W4)与 T2(W4)同窗口串行;T6(W1)在 T3 完成后独立跑

---

## 9. 窗口分配 + 7-10 天 timeline

| Day | W1 | W2 | W4 |
|---|---|---|---|
| D1 | idle / 等 T6 unblock | idle / 等 T3 unblock | T1 富化 helper(代码 + unit test) |
| D2 | idle | idle | T1 收尾 + 开始 T2 schema + aggregate |
| D3 | idle | idle | T2 收尾(包括 v1→v2 兼容) |
| D4 | idle | idle | T3 cron route 编排 + probe script + 手动 probe |
| D5 | **T6 generator + test** | **T4 /api/trending + projection** | (W4 idle 或开始下一 epic) |
| D6 | **T6 InsightBanner UI + 接入 SSE** | **T5 TrendingBoard tabs + InsightTabs 框架** | idle |
| D7 | T6 收尾 + e2e 手测 | T5 5 个 tab 内容填充 + RTL test | idle |
| D8 | buffer | T5 收尾 + canary smoke | buffer |

**预算总长**:7 自然日(顺利),9 自然日(buffer 含)。

**windows.md 派发节奏**:
- D0 末:派发 T1+T2+T3 到 window-4.md(W4 一次性领 3 task,连续做)
- D4 末(T3 merge 后):派发 T4 到 window-2.md + T6 到 window-1.md
- D5 末(T4 merge 后):派发 T5 到 window-2.md

---

## 10. 成本预算

### 10.1 每周新增(user 选 B/B/B 后更新)

| 项 | 单价 | 数量 | 小计/周 |
|---|---|---|---|
| Apify TT+IG | $0.20 / 次(现状) | 7 次 | $1.40 |
| Gemini 2.5 Pro 富化 + retry(D5=B) | $0.08 / 视频 × 1.3x | 15 视频 × 1.3 × 7 天 = 137 | $10.92 |
| Gemini Pro event detection(D1=B) | $0.05 / 次 | 7 次 / 周 | $0.35 |
| Haiku banner 生成(D2=B) | $0.001 / review | ~30 reviews/天 × 7 = 210 | $0.21 |
| GCS storage(v2 snapshot ~30KB) | $0.020 / GB / 月 | 30KB × 8 周 ≈ 0.24MB | < $0.001 |
| Cloud Run CPU(cron 富化 + retry ~7min) | $0.00002400 / vCPU-sec × 4 vCPU × 420s | 7 次 / 周 | $0.28 |
| Cloud Storage egress(read insight)| $0.12 / GB | < 1MB / day | < $0.001 |

**周成本增量**:~$13 / 周(基线 $1.40 → $13.16)
**月成本增量**:~$53 / 月(对比默认 A/A/A 的 ~$40,差 +$13)

### 10.2 cap 机制

- `maxVideos = 15`(T3 select-for-enrichment)= 硬上限
- Gemini quota alarm:GCP console 设 monthly cap $50 → 超额自动停
- snapshot prune `keepWeeks = 8` 不变,GCS 容量不会涨

### 10.3 review 时调用成本

- `generateBanner` deterministic 模式 = $0(纯内存)
- 若选 D2 LLM 模式 = +$0.001 / review × ~10-50 reviews/天 = < $1 / 月

---

## 11. 风险评估 + mitigation

| # | 风险 | 严重度 | Mitigation |
|---|---|---|---|
| R1 | cron route Gemini 富化超 Cloud Scheduler 180s deadline | HIGH | T3 内置 AbortController 150s timeout;富化用 Promise.allSettled,部分成功也持久化;失败 videoId 进 failures 数组(`stage2-failure-loses-stage1.md` 教训) |
| R2 | Gemini 配额(File API rate-limit 或 daily quota)被打满 | MED | concurrency=3 限流;failures 数组带 reason,运维可读;GCP console 设 alert(请求 5xx > 10/h 触发) |
| R3 | v1→v2 schema 不兼容,老快照读崩 | HIGH | TrendingSnapshotSchema 已是 loose passthrough,`insight` 字段 optional;velocity.ts schemaVersion 比较改成 `>=1 && <=2` 窗口;`tests/trending/insight-schema.test.ts` 锁定 v1 read forward-compat |
| R4 | event detector 误判(MVP hashtag 关键词)产生噪音 | LOW | MVP 词典只放高确认度 event(met_gala / xmas / vday 等);eventInsights[].matchedVideoCount < 3 → 不渲染到 UI;长期方案在决策点 D1(LLM) |
| R5 | 富化失败率过高(>50%)→ insight 数据稀疏 | MED | failures 数组上报 GCP log;若一周 successfulCount < 5,banner 退化文案"本周数据稀疏,使用上周参考";probe script 每周 1 次手测 |
| R6 | 跨窗口文件冲突(T2 修 types.ts / velocity.ts 同时 T4 读 types) | MED | T4 必须等 T3 merge 后才能 push(types.ts 改动已在 main);windows.md 派发用 `feat/l3plus-*` 分支,W3 monitor pattern-watch 已就绪(memory `feedback_monitor_pattern_watch.md`) |
| R7 | InsightBanner 文案 LLM 模式(若 D2 选 LLM)拖慢 review 总耗时 | MED | SSE partial event:banner 异步发,UI 占位 skeleton;失败 → 退到 deterministic template |
| R8 | 富化下载 trending video URL 失败率高(Apify URL 短期过期) | MED | download timeout 30s + 1 retry;失败 reason 进 failures;不影响其他视频继续富化 |
| R9 | `loadReferenceCutPlans` cache (CACHE_TTL_MS=60s) 与 cron 新写 snapshot 时机错位 | LOW | trending snapshot 不进 sample-references cache(已是分离路径);InsightBanner 直接读 snapshot-store(`readLatestTwoSnapshots`),不走 reference cache |
| R10 | 删 / 加 npm dep 触发 transitive 回归 | HIGH if 触发 | 本 plan 不应增 dep(`p-limit` 用手写 semaphore 替代);若必须加,fresh install audit(memory `feedback_dep_removal_transitive_check.md`)+ pre-push reviewer 不准 skip dep changes |

---

## 12. 关键决策点(user 已拍板 2026-05-17)

> **User 决策**:D1=B(LLM event)、D2=B(Haiku banner)、D5=B(retry 1 次)。
> D3 = 不在 scope(默认 A,推迟独立 epic),D4 = 2 周 MVP(默认 A,无需扩)。

### D1 · Event detection · **选 B:LLM**
- 实施:`lib/trending/event-detector.ts` 内置 strategy 接口,先 keywords-stub + 一周后加 Gemini Pro 1 call。
- 富化阶段后追加 1 次 Gemini Pro 调用(输入本周 hashtag 榜 + top hashtag descriptions,输出 active events list)。
- **必须** loose Zod schema(memory `llm-schema-looseness.md`):events array 各字段 z.string()/optional/passthrough。
- 失败时退到 keywords 字典(已实现,作 fallback)。
- 成本:+$0.05/周。

### D2 · InsightBanner 文案 · **选 B:Haiku**
- 实施:`lib/insight/generate-banner.ts` 内置 `template` + `llm` 两个 strategy,user 决策走 `llm`。
- `claude-haiku-4-5-20251001` 一次 call,输入:bestHashtag.techniqueDistribution top-2 + bgm.name + event.displayName + userFormat,输出:headline + bullets + actionable 整段自然语言(JSON schema 锁定字段名,内容自由)。
- **SSE partial event** 防延迟感知:先发 banner stage event with `loading: true` 让前端占位 skeleton,Haiku 响应后(< 3s)发完整 banner 数据。
- LLM 失败 → 立即退到 template strategy(无 user 可见错误)。
- 成本:+$0.001/review × ~30 reviews/天 = ~$1/月。

### D3 · review history 持久化 · 不在 scope
- 不持久化(默认 A)。推迟独立 epic("review history")。

### D4 · velocity 跨周窗口 · 2 周 MVP(默认 A)
- T2 沿用 2 周。8 周历史已留(`pruneOldSnapshots(keepWeeks=8)`),未来扩易。

### D5 · 富化失败 video · **选 B:retry 1 次**
- 实施:T1 `enrichTrendingVideo` 内部对 transient error(timeout / 5xx / network)retry 1 次,exponential backoff 5s。
- non-retryable error(invalid input / 4xx)立即失败,不浪费。
- `enrichBatch` 收 retry 后仍失败的进 failures 数组(stage1 不丢原则不变)。
- 成本:富化 ~$8.4 → ~$10.9/周(+30%)。

---

## 13. 不在 scope 内的(防 worker 扩 scope)

- ❌ user 个性化推荐(基于 review history 的 ML)
- ❌ 付费 tier / billing
- ❌ mobile app
- ❌ trending 数据多语言 i18n(只英文 +中文 source)
- ❌ TrendingCard 视觉重做(W4 owned,T5 不动)
- ❌ Apify scraper 切换其他平台(YouTube Shorts / Bilibili)
- ❌ Gemini 富化结果回灌到 `data/enriched-cutplans/`(trending 富化结果落 v2 snapshot 即可,不污染手工富化池)
- ❌ `loadReferenceCutPlans` 加 trending 池作为新 path(已有 5 层 fallback,trending 数据靠 InsightBanner 单独展示足够,不混入 retrieval)
- ❌ review history 持久化(D3 决策,推迟)
- ❌ InsightBanner LLM 文案(D2 决策,template 先上)
- ❌ Event detector LLM 路径(D1 决策,关键词先上)
- ❌ Velocity 4/8 周趋势线(D4 决策,2 周 MVP)
- ❌ 移除任何现有 npm dep(memory `feedback_dep_removal_transitive_check.md`,本 plan 零 dep 变动)

---

## 14. 跨 task 风险防御清单(给所有 worker)

每个 T 进入 implementation 前必读:

1. **commit N+1 起手读 commit N W3 nit list**(memory `feedback_read_prev_commit_nits_before_next.md`)
2. **scope 偏差必 explicit document**(memory `feedback_scope_deviation_document.md`):实施时发现更好架构,commit body 必含 scope 引用 + 偏差 rationale
3. **HMAC 类 secret 不在本 plan 范围**(无新 token 引入)
4. **Gemini schema 永远 loose**(memory `llm-schema-looseness.md`):**所有** LLM 自由输出字段 `z.string()` 不用 `z.enum()`,描述性字段允 nullable
5. **两阶段 LLM 任何一阶段失败,stage 1 数据持久化**(memory `stage2-failure-loses-stage1.md`)
6. **pre-push reviewer 不准 skip dep changes / module deletion / config files**(memory `feedback_pre_push_reviewer_skip_dep_changes.md`)
7. **HTTP 行为假设必独立 source 验证**(memory `feedback_verify_http_behavior_assumptions.md`)
