# Hot Tracking — P0/P1/P2 Design

**Status**: ✅ **设计完成 — 6/6 节已 present + 用户批准,待 spec review 后转 writing-plans**
**Worktree**: `.claude/worktrees/hot-tracking`(branch `feat/hot-tracking-p0-p2`)
**Started**: 2026-05-13
**Author**: Claude (Opus 4.7) + yixin

---

## 背景

### 母诉求
团队 2026-05-12 反馈:「当前的热点的来源是什么,又是怎么样被列为热点的。这个产品的最终目的不管是对内还是对外都是热点追踪」。

参见 memory: `feedback_hot_tracking_gap.md`。

### 当前实现的真相(5/13 状态)
- 100% Apify hashtag 搜索,按 views 排序就是「热点」
- `publishedAt` 跨度 2019-06 → 2026-04(7 年),无时间窗过滤
- 169 条 enriched-cutplans 是历史样本,不是趋势数据
- 无主动发现机制

### Memory 里 P0-P3 路线
- **P0**: retrieval 加 publishedAt 时间窗过滤
- **P1**: Vercel Cron 定时抓 + velocity 字段 + 排序加权
- **P2**: 真趋势发现(TikTok Discover / IG Explore Trending)
- **P3**: 自有视频画像库(手动喂参考视频)

本 spec 解决 **P0 + P1 + P2 一并**,P3 留 v2。

---

## 已收集的产品决策

| 维度 | 答案 |
|---|---|
| 产品形态 | **两者并行**:新增独立趋势看板页面 + 同时改善现有 /analyze 输入样本质量 |
| 看板覆盖范围 | **Platform Global Trending**(抓 TikTok Discover / IG Explore 顶部,不介入题材) |
| 「新」时间窗定义 | **30 天**(月度热点,足够过滤掉历史经典爆款,又能保留样本量) |
| P0 时间窗 filter 应用范围 | **只应用在 live + trending-snapshot**,本地池 169 条作为「经典样本」保留,UI 标 badge |
| Vercel 配置文件 | **vercel.ts**(需 `npm i @vercel/config`) |
| 看板布局 | **合并 + platform badge**(单列 top 50,每卡 TT/IG 角标) |
| snapshot Blob namespace | **独立 namespace** `trending/`(与 `topic-cache/` 分开) |
| snapshot key | **合并 tt+ig 单文件**(减少 Blob ops) |
| 类目分组 | **暂不做**(global trending 无题材维度) |
| Cron secret | **Vercel 自带 `CRON_SECRET` env var** |
| 第一周无上周数据时 velocity | **全部标 🆕 NEW** |
| trending 视频题材归类 | **cron 时 Haiku 打题材标签**(本地库题材列表当 hint) |

### 关键论证

**P0 必须跟 P1/P2 一起做**(不能单独先上 P0):
1. P0 是 P1 的前置依赖 — P1 velocity 公式需要 `publishedAt` 切片
2. 代码 footprint 小到不值得分阶段
3. P0 第一天上线就能消除「7 年老爆款」,给 P1/P2 数据累积期争取时间

**为什么 P0 filter 不应用到本地池**:
- 169 条富化样本 publishedAt 跨 7 年,应用 30 天 filter 后几乎全空
- 本地池作为「经典样本」UI 标 badge 保留
- live + trending-snapshot 才是「新」的数据源,对它们应用 filter

---

## 选定方案 A — 周快照

### 一句话总览
Vercel Cron 每周一次抓 TikTok/IG Global Trending → Haiku 富化 + 题材标签 → 存 Vercel Blob → 看板渲染 + /analyze 兜底用。

### 数据流

```
┌─ Vercel Cron: 每周一 08:00 UTC ─────────────┐
│  → POST /api/cron/trending(验 CRON_SECRET) │
│  → fetchTrendingSnapshot()                  │
│      ├─ Apify: TT Discover top 50           │
│      └─ Apify: IG Explore top 50            │
│  → enrichSnapshot()                         │
│      ├─ enrichBatch(playStyle/visual/hook)  │
│      └─ Haiku 题材标签(本地库题材当 hint)  │
│  → writeSnapshot(week)  →  Vercel Blob      │
│      key: trending/snapshot-<week>.json     │
│  → pruneOldSnapshots(keepWeeks=8)           │
└─────────────────────────────────────────────┘

           ▼                              ▼
┌─────────────────────────┐   ┌─────────────────────────────┐
│ /trending 看板(new)    │   │ /analyze(existing)         │
│  - SSR RSC 直读快照      │   │  retrieval.ts 升级:         │
│  - 读最新+上周快照       │   │   ① P0: ≤30d filter on      │
│  - velocity.ts 算 badge │   │      live + snapshot only   │
│  - top 50 合并排序       │   │   ② cache miss 多一层兜底:  │
│  - platform badge       │   │      trending snapshot      │
└─────────────────────────┘   │      按 topic 模糊匹配采样  │
                              └─────────────────────────────┘
```

### 成本估算
- ~1-2 Apify run/周 × 4 周 = **$5-10/月**
- cron 时多一笔 Haiku 题材分类(~100 条/周,成本可忽略)
- 跟「本周在涨」语义 1:1 对齐
- 不引新数据依赖(继续用 Vercel Blob);仅 `@vercel/config` 一个配置依赖
- 8 周滚动 = 自然形成 velocity history

### 备选已 reject
- **方案 B 日快照**:7× Apify 成本($30-50/月),但跟「本周」产品语义错配
- **方案 C Postgres**:留作 v2 升级路径,169 条富化样本的产品体量配不上

---

## 关键模块清单

| 模块 | 状态 | 职责 |
|---|---|---|
| `lib/utils/iso-week.ts` | 🆕 新增 | 从 `blob-cache.ts` 抽出的 `getIsoWeek()` 纯函数,两处共用 |
| `lib/trending/types.ts` | 🆕 新增 | `TrendingSnapshot` / `TrendingVideoWithVelocity` 类型 |
| `lib/trending/fetch.ts` | 🆕 新增 | 调 Apify trending actors + `enrichSnapshot()`(富化 + 题材标签) |
| `lib/trending/snapshot-store.ts` | 🆕 新增 | Blob 读写 + 周 key + `pruneOldSnapshots()` |
| `lib/trending/velocity.ts` | 🆕 新增 | 纯函数:对比相邻两周快照算 velocity / rank / trend |
| `lib/trending/topic-classifier.ts` | 🆕 新增 | Haiku 给 trending 视频打题材标签(本地库题材当 hint) |
| `app/api/cron/trending/route.ts` | 🆕 新增 | Vercel Cron handler(验签 + 失败容错) |
| `app/trending/page.tsx` | 🆕 新增 | 看板 RSC,直读快照 |
| `app/api/trending/route.ts` | 🆕 新增 | 看板平台筛选/轮询用 |
| `vercel.ts` | 🆕 新增 | cron schedule 配置(需 `npm i @vercel/config`) |
| `lib/topic-cache/blob-cache.ts` | ✏️ 修改 | 改为 import `lib/utils/iso-week.ts`(去重) |
| `lib/research/topic-research.ts` | ✏️ 修改 | TT/IG sort 前各加 30d filter(P0) |
| `lib/review-engine/retrieval.ts` | ✏️ 修改 | cache 与 live 之间插入 snapshot 兜底层 |
| `lib/apify/scrapers.ts` | ✏️ 修改(追加) | 新增 `scrapeTikTokTrending` / `scrapeInstagramExplore` |

### 不动的模块
- `lib/topic-cache/blob-cache.ts` 的缓存逻辑(trending 用独立 `trending/` namespace)
- `lib/enrichment/batch-runner.ts` / `lib/research/enrich-one.ts` 的 `enrichBatch`(直接复用)
- 现有 `scrapeTikTokByHashtag` / `scrapeInstagramByHashtag`(不删,trending 是新增 actor 调用)

---

## Section 1 — Architecture

参见上方「数据流」与「关键模块清单」。方案 A(周快照)已由用户批准。

### Section 1 收尾开放问题(已决策)

1. **Trending snapshot 与 topic-cache 是否共享 Blob namespace?** → **独立 namespace**
   - `topic-cache/<topic>-<week>.json` ← per-topic,已有
   - `trending/snapshot-<week>.json` ← global,新增
   - 理由:粒度不同(per-topic vs global)、读侧路径不同、prune 策略不同

2. **Vercel cron 配置文件用 `vercel.json` 还是 `vercel.ts`?** → **vercel.ts**
   - 现状:项目无 vercel.json 也无 vercel.ts
   - 顺手现代化、未来加更多 cron 不痛苦,需 `npm i @vercel/config`

---

## Section 2 — Data Schema

### 2.1 `TrendingSnapshot`

`ViralVideo` 已自带 `platform: "tiktok" | "instagram"` 字段;Q3 决策合并 tt+ig 单文件,所以**无**顶层 `source` 字段,靠 `v.platform` 区分。

```typescript
type TrendingSnapshot = {
  week: string;            // ISO week "2026-W20"
  capturedAt: string;      // ISO timestamp
  videos: ViralVideo[];    // tt + ig 混合,靠 v.platform 区分;含 Haiku 题材标签写入 v.topic
  meta: {
    tiktok: PlatformMeta;
    instagram: PlatformMeta;
    partial: boolean;      // 任一平台失败 = true
  };
};

type PlatformMeta = {
  actorRun: string;        // Apify run ID,用于追溯
  rawCount: number;        // 抓回多少条
  enrichedCount: number;   // Haiku 富化成功多少条
  ok: boolean;             // 该平台本次抓取是否成功
};
```

### 2.2 velocity 派生类型

纯派生,**不落盘** —— 由 `velocity.ts` 在读取时对比相邻两周快照实时计算。

```typescript
type TrendingVideoWithVelocity = ViralVideo & {
  velocity: {
    weekOverWeek: number | null;   // (thisWeek.views - lastWeek.views) / lastWeek.views;上周无此条 = null
    rank: { current: number; previous: number | null };
    trend: "rising" | "stable" | "falling" | "new";
  };
};
```

### 2.3 Blob key 命名

- 合并单文件:`trending/snapshot-2026-W20.json`(含 tt + ig)
- 独立 `trending/` namespace,与 `topic-cache/` 分开

### 2.4 共享 `getIsoWeek`

`getIsoWeek()` 现在是 `blob-cache.ts` 的私有函数,trending 的 snapshot key 也要用。抽到 `lib/utils/iso-week.ts`,`blob-cache.ts` 与 `snapshot-store.ts` 同时 import —— 避免周计算逻辑复制两份。这是与本目标直接相关的顺手改进,不引入无关重构。

### 2.5 兼容性

- 跟现有 `ViralVideo` type 完全兼容(trending 视频复用同一 type)
- 现有 `TopicCacheEntry` 不动

---

## Section 3 — /analyze 集成

### 3.1 P0 时间窗 filter

在 `lib/research/topic-research.ts` 里,TT 与 IG 各自的 `.sort()` 之前插入 30 天过滤。`publishedAt` **缺失时不丢**(保留),只过滤明确超 30 天的:

```typescript
const CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;
function withinWindow(v: ViralVideo): boolean {
  if (!v.publishedAt) return true; // 时间未知不丢
  const age = Date.now() - new Date(v.publishedAt).getTime();
  return age <= CUTOFF_MS;
}
```

应用点:`tiktokVideos` 与 `instagramVideos` 的 `.sort()` 之前。**只作用于 live 数据**,本地池(`loadVideos()`)不过滤。

### 3.2 retrieval.ts 的 snapshot 兜底层

trending snapshot 是 **global**(无单一题材),要插在 `retrieval.ts` 现有第 3 步(Blob 周缓存)与第 4 步(live 搜索)之间作为免费兜底层。

升级前顺序:
```
local → topic-cache → live-fetch → cross-topic fallback
```
升级后:
```
local → topic-cache → trending-snapshot(按 topic 模糊匹配) → live-fetch(P0 filter) → cross-topic fallback
```

**global 快照如何按 `canonicalTopic` 归类** —— 采用 cron 时 LLM 打标签方案:

- **cron 端**(`lib/trending/topic-classifier.ts`):`enrichSnapshot()` 富化后,Haiku 给每条 trending 视频分类题材,写入 `v.topic`。分类器把本地库题材列表(`loadVideos()` 的 distinct topics)当 hint 传入,**优先归一化到已知题材**,机制与现有 `inferTopic` 一致。
- **retrieval 端**:读最新快照,用 `jaccard()`(retrieval.ts 已有)对 `canonicalTopic` 与每条快照视频的 `v.topic` 做模糊匹配,取超阈值的 top-N;全部低于阈值 → 跳过此层直接走 live。
- 命中时 `RetrievalResult.source = "snapshot"`。

为什么选 LLM 打标签而非纯 token 匹配:题材归类精度直接影响 /analyze 样本质量,用户明确要求 LLM 分类;cron 是每周一次,多一笔 Haiku 成本可忽略。

### 3.3 UI badge

`retrieval.ts` 的 `RetrievalSource` 增加 `"snapshot"`:

```typescript
export type RetrievalSource = "local" | "cache" | "live" | "snapshot" | "fallback";
```

前端按 `source` + `publishedAt` 标:
- 「经典」← `source: "local"`(169 条 enriched-cutplans)
- 「近期」← `source: "live" | "snapshot" | "cache"`
- 「N 天前」← 由 `publishedAt` 计算具体天数

---

## Section 4 — Trending 看板 UI

### 4.1 路由
- `/trending` — SSR 页面(RSC),无需登录(看板对外可见)
- `app/api/trending/route.ts` — 给前端平台筛选/轮询用

### 4.2 数据获取
RSC 直接调 `snapshot-store.ts` 读最新 + 上周快照 → 过 `velocity.ts` 算增量 → 渲染。首屏无客户端 fetch。

### 4.3 布局(合并 + platform badge)

```
┌────────────────────────────────────────────────┐
│  本周热点 · 2026 W20(截止 5/19)  [全部 ▾]      │
├────────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐           │
│  │ #1 TT│ │ #2 IG│ │ #3 TT│ │ #4 IG│ ← 视频卡片│
│  │📈+45%│ │📈+12%│ │🆕 NEW│ │📉-8% │ ← velocity│
│  └──────┘ └──────┘ └──────┘ └──────┘           │
│  ... top 50 合并排序,每卡左上角 TT/IG 角标      │
└────────────────────────────────────────────────┘
```

### 4.4 badge 规则
- 🆕 **NEW** — 本周首次进 top 50;第一周无上周快照时全部标 NEW
- 📈 **+N%** / 📉 **-N%** — `velocity.weekOverWeek`(rising / falling)
- 🔥 **TOP** — 连续 2+ 周稳居 top 10。需读 ≥3 周快照才算得出,**v1 降级**为「本周 top 10」简单标记,velocity history 累积到 3 周后再启用完整规则
- 排序:本周 views 降序
- `[全部 ▾]` 下拉切 TikTok / Instagram / 全部,走 `app/api/trending/route.ts`

### 4.5 空状态
无任何快照时(首次部署、cron 尚未跑)渲染「首次数据将于下周一生成」,不报错。

---

## Section 5 — 错误处理

### 5.1 Apify actor 失败
- TT 抓失败 → 继续抓 IG;反之亦然。对应平台 `meta.<platform>.ok = false`,`meta.partial = true`
- 两个平台都失败 → **不写空快照**(避免覆盖上周好数据),只 log,留待下周 cron 重抓

### 5.2 Cron 路由认证
- `app/api/cron/trending/route.ts` 必须验 `Authorization: Bearer ${process.env.CRON_SECRET}`,不匹配返回 401
- Vercel Cron 调用时自动带此头;`CRON_SECRET` 由 Vercel 平台管理

### 5.3 富化 / 题材分类部分失败
- `enrichBatch` 已有 fallback(Haiku miss → 留原字段),直接复用
- 题材标签分类同理:分类失败的视频 `v.topic` 留空,retrieval 端 `jaccard` 模糊匹配自然跳过该条

### 5.4 Blob 写失败
- 重试 1 次;仍失败 → log + 退出。快照幂等,下周 cron 重抓

### 5.5 看板读不到快照
- `/trending` 无快照 → 渲染空状态(见 4.5),不抛错

---

## Section 6 — 测试(TDD)

按 `superpowers:test-driven-development`,每个新模块先写失败测试,再实现 minimal pass,再 refactor。

### 6.1 单测
- `lib/trending/velocity.ts` — 纯函数,**最优先**。覆盖:新视频(上周无)、排名上升 / 下降、views 涨 / 跌、第一周无上周快照(全 NEW)
- `lib/utils/iso-week.ts` — 抽出的纯函数,补跨年周边界测试
- `lib/trending/snapshot-store.ts` — mock `@vercel/blob` 的 `put` / `head`,测周 key 生成 + `pruneOldSnapshots(keepWeeks=8)`
- `lib/trending/topic-classifier.ts` — mock Haiku,测题材归一化到 hint 列表 + 分类失败留空
- `lib/apify/scrapers.ts` 新增的 `scrapeTikTokTrending` / `scrapeInstagramExplore` — mock Apify client

### 6.2 集成测
- `app/api/cron/trending/route.ts` — 验签(401 路径)+ 单平台失败容错 + 两平台全失败不写空快照
- `lib/review-engine/retrieval.ts` 升级路径 — mock cache miss,验证走 snapshot 兜底层 + topic 模糊匹配命中 / 未命中两种分支

### 6.3 E2E(Playwright)
- `/trending` — mock 快照渲染,验 badge 显示 + 平台筛选下拉
- `/analyze` 改后 — fixture 验证 P0 30 天 filter 生效(超 30 天样本被过滤、`publishedAt` 缺失样本保留)

---

## 当前 brainstorming 流程状态

按 `superpowers:brainstorming` skill:

- [x] **Step 1**: Explore project context
- [x] **Step 2**: Visual companion offer — 跳过(无 UI 视觉对比需求)
- [x] **Step 3**: Clarifying questions — 产品决策 + 开放问题答完
- [x] **Step 4**: Propose 2-3 approaches — 选定方案 A
- [x] **Step 5**: Present design sections — 6/6 done,逐节用户批准
- [x] **Step 6**: Write design doc — 当前文件
- [ ] **Step 7**: Spec self-review
- [ ] **Step 8**: User reviews spec
- [ ] **Step 9**: Invoke `superpowers:writing-plans` skill

## 相关 memory 引用

- `feedback_hot_tracking_gap.md` — 团队反馈 + P0-P3 路线
- `project_overview.md` — 双轨架构 + 当前阶段
- `feedback_enterprise_swg_cert.md` — npm install 治本(已 push to main as `f24a31b`)

## 当前 git 状态

- worktree branch: `feat/hot-tracking-p0-p2`
- base commit: `f24a31b`(origin/main tip when worktree created)
