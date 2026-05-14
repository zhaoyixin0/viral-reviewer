# Hot Tracking — P0/P1/P2 Design

**Status**: ✅ **设计完成(v2,已纳入 architect review)— 待用户 review 后转 writing-plans**
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
| 看板覆盖范围 | **Platform Global Trending**(抓 TikTok 趋势 / IG 热门 hashtag 代理,不介入题材) |
| 「新」时间窗定义 | **30 天**(月度热点,足够过滤掉历史经典爆款,又能保留样本量) |
| P0 时间窗 filter 应用范围 | **只应用在 live + trending-snapshot**,本地池 169 条作为「经典样本」保留,UI 标 badge |
| Vercel 配置文件 | **vercel.ts**(需 `npm i @vercel/config`)— architect 提 YAGNI 异议,用户复议后保留 |
| 看板布局 | **合并 + platform badge**(单列 top 50,每卡 TT/IG 角标) |
| snapshot Blob namespace | **独立 namespace** `trending/`(与 `topic-cache/` 分开) |
| snapshot key | **合并 tt+ig 单文件**(减少 Blob ops) |
| 类目分组 | **暂不做**(global trending 无题材维度) |
| Cron secret | **Vercel 自带 `CRON_SECRET` env var** |
| 第一周无上周数据时 velocity | **全部标 🆕 NEW** |
| trending 视频题材归类 | **cron 时 Haiku 打题材标签**(本地库题材列表当 hint,输出带 confidence) |
| TikTok trending 数据源 | **`clockworks/tiktok-trends-scraper`**(已确认,见 H2) |
| Instagram trending 数据源 | **热门 hashtag 代理**:复用 `scrapeInstagramByHashtag` + 人工维护的热门 hashtag 列表。**非真 Explore**,UI 明确标注。真 Explore 进 v2 backlog |

### 关键论证

**P0 必须跟 P1/P2 一起做**(不能单独先上 P0):
1. P0 是 P1 的前置依赖 — P1 velocity 公式需要 `publishedAt` 切片
2. 代码 footprint 小到不值得分阶段
3. P0 第一天上线就能消除「7 年老爆款」,给 P1/P2 数据累积期争取时间

**为什么 P0 filter 不应用到本地池**:
- 169 条富化样本 publishedAt 跨 7 年,应用 30 天 filter 后几乎全空
- 本地池作为「经典样本」UI 标 badge 保留
- live + trending-snapshot 才是「新」的数据源,对它们应用 filter

**为什么 IG 用 hashtag 代理而非真 Explore**(architect H2 + memory `video-download-stack.md`):
- Apify Store 无干净的 IG Explore/trending actor;`apify/instagram-reel-scraper` 只吃 profile/hashtag/username
- IG Explore feed 高度个性化、对匿名访问封闭,无 cookies 大概率拿不到
- 折中:cron 抓一组人工维护的「当前热门 hashtag」,作为 IG 趋势的**代理信号**,UI 上与 TikTok 真趋势区分标注

---

## 选定方案 A — 周快照

### 一句话总览
Vercel Cron 每周一次抓 TikTok 趋势 + IG 热门 hashtag → Haiku 富化 + 题材标签 → 存 Vercel Blob → 看板渲染 + /analyze 兜底用。

### 数据流

```
┌─ Vercel Cron: 每周一 08:00 UTC ─────────────────────┐
│  → POST /api/cron/trending                          │
│      认证: Cron header(CRON_SECRET)                │
│            或 admin token(手动触发,见 H1)         │
│  → fetchTrendingSnapshot()                          │
│      ├─ Apify: clockworks/tiktok-trends-scraper     │
│      │         (region + 30d time window)           │
│      └─ Apify: scrapeInstagramByHashtag             │
│                (人工维护的热门 hashtag 列表)        │
│  → enrichSnapshot()                                 │
│      ├─ enrichBatch(playStyle/visual/hook)          │
│      └─ Haiku 题材标签 + confidence(本地库题材hint)│
│  → writeSnapshot(week)  →  Vercel Blob              │
│      key: trending/snapshot-<week>.json             │
│  → pruneOldSnapshots(keepWeeks=8)                   │
└─────────────────────────────────────────────────────┘

           ▼                              ▼
┌─────────────────────────┐   ┌─────────────────────────────┐
│ /trending 看板(new)    │   │ /analyze(existing)         │
│  - SSR RSC 直读快照      │   │  retrieval.ts 升级:         │
│  - velocity.ts 算 badge │   │   ① P0: ≤30d filter on      │
│  - top 50 合并排序       │   │      live + snapshot only   │
│  - platform badge       │   │   ② cache miss 多一层兜底:  │
│  - /api/trending 精简投影│   │      trending snapshot      │
│    (平台筛选用)         │   │      按 topic 模糊匹配采样  │
└─────────────────────────┘   └─────────────────────────────┘
```

### 成本估算
- **TikTok**:`clockworks/tiktok-trends-scraper` `$1.70 / 1000 results`,50 条/周 ≈ **$0.09/周**
- **Instagram**:`apify/instagram-hashtag-scraper` `$2.60 / 1000 results`,~50 条/周 ≈ **$0.13/周**
- cron 时多一笔 Haiku 富化 + 题材分类(~100 条/周,成本可忽略)
- 合计 **≤ $5/月**(含 Apify 平台 run 开销冗余),远低于日快照方案
- 8 周滚动 = 自然形成 velocity history

### 备选已 reject
- **方案 B 日快照**:7× Apify 成本,且跟「本周」产品语义错配
- **方案 C Postgres**:留作 v2 升级路径,169 条富化样本的产品体量配不上

### ⚠️ 部署前置(architect H1)
**Vercel Cron 在当前部署套餐下的可用性尚未验证**(本机无 Vercel CLI 无法查)。实施前必须确认:
- 部署套餐是否支持 cron(Hobby 套餐 cron 有频率限制)
- 周度 schedule `0 8 * * 1` 是否被套餐允许
若套餐不支持,降级方案:外部调度器(GitHub Actions cron)POST 到带 admin token 的 `/api/cron/trending`。

---

## 关键模块清单

| 模块 | 状态 | 职责 |
|---|---|---|
| `lib/utils/iso-week.ts` | 🆕 新增 | 从 `blob-cache.ts` 抽出的 `getIsoWeek()` 纯函数,两处共用 |
| `lib/trending/types.ts` | 🆕 新增 | `TrendingSnapshot` / `TrendingVideoWithVelocity` 类型(含 `schemaVersion`) |
| `lib/trending/ig-hot-hashtags.ts` | 🆕 新增 | 人工维护的 IG 热门 hashtag 列表 + 维护说明注释 |
| `lib/trending/fetch.ts` | 🆕 新增 | 调 TikTok trends actor + IG hashtag 代理 + `enrichSnapshot()` |
| `lib/trending/snapshot-store.ts` | 🆕 新增 | Blob 读写 + 周 key + `pruneOldSnapshots()` |
| `lib/trending/velocity.ts` | 🆕 新增 | 纯函数:对比相邻两周快照算 velocity / rank / trend |
| `lib/trending/topic-classifier.ts` | 🆕 新增 | Haiku 给 trending 视频打题材标签 + confidence(本地库题材当 hint) |
| `app/api/cron/trending/route.ts` | 🆕 新增 | Cron handler(双认证:cron header / admin token + 失败容错) |
| `app/trending/page.tsx` | 🆕 新增 | 看板 RSC,直读快照 |
| `app/api/trending/route.ts` | 🆕 新增 | 看板平台筛选用,返回**精简卡片投影**(非完整快照) |
| `vercel.ts` | 🆕 新增 | cron schedule 配置(需 `npm i @vercel/config`) |
| `lib/apify/scrapers.ts` | ✏️ 修改(追加) | 新增 `scrapeTikTokTrending`(包装 `clockworks/tiktok-trends-scraper`) |
| `lib/topic-cache/blob-cache.ts` | ✏️ 修改 | 改为 import `lib/utils/iso-week.ts`(去重) |
| `lib/research/topic-research.ts` | ✏️ 修改 | TT/IG sort 前各加 30d filter(P0) |
| `lib/review-engine/retrieval.ts` | ✏️ 修改 | cache 与 live 之间插入 snapshot 兜底层 |

### 不动的模块
- `lib/topic-cache/blob-cache.ts` 的缓存逻辑(trending 用独立 `trending/` namespace)
- `lib/enrichment/batch-runner.ts` / `lib/research/enrich-one.ts` 的 `enrichBatch`(直接复用)
- 现有 `scrapeTikTokByHashtag`(不删);`scrapeInstagramByHashtag` **复用**给 IG 代理,不改

---

## Section 1 — Architecture

### 1.1 整体形态
两个消费端共享一套周快照数据:
- **写侧**:Vercel Cron(每周一)→ `/api/cron/trending` → 抓取 + 富化 + 写 Blob。单一定时入口,幂等。
- **读侧 A — `/trending` 看板**:SSR RSC 直读最新 + 上周快照,经 `velocity.ts` 算增量后渲染。
- **读侧 B — `/analyze` retrieval**:在现有检索链的 cache 与 live 之间插入 snapshot 兜底层,把全局趋势按用户题材模糊匹配后采样,作为 live 抓取前的**免费**一档。

### 1.2 数据隔离
- trending 快照走独立 Blob namespace `trending/`,与 `topic-cache/` 完全分开(粒度不同:global vs per-topic;prune 策略不同)。
- trending 视频复用现有 `ViralVideo` type,不新建并行模型;velocity 是**派生类型,不落盘**。

### 1.3 模块边界
- `fetch.ts` 只管「抓 + 富化 + 题材标签」,产出 `TrendingSnapshot`,不碰 Blob。
- `snapshot-store.ts` 只管 Blob 读写 + prune,不碰业务逻辑。
- `velocity.ts` 是纯函数,输入两周快照、输出带 velocity 的视频列表,可独立单测。
- `topic-classifier.ts` 只做题材分类,可独立 mock。
- 每个单元「做什么 / 怎么用 / 依赖什么」边界清晰,互不读内部。

### 1.4 收尾开放问题(已决策)
1. **Blob namespace** → 独立 `trending/`(理由见 1.2)
2. **Vercel 配置文件** → `vercel.ts`(architect 提 YAGNI 异议,用户复议后保留;需 `npm i @vercel/config`)

---

## Section 2 — Data Schema

### 2.1 `TrendingSnapshot`

`ViralVideo` 已自带 `platform: "tiktok" | "instagram"` 字段;合并 tt+ig 单文件,无顶层 `source` 字段,靠 `v.platform` 区分。

```typescript
type TrendingSnapshot = {
  schemaVersion: 1;        // 见 2.5,velocity.ts 跨周比较时校验
  week: string;            // ISO week "2026-W20"
  capturedAt: string;      // ISO timestamp
  videos: ViralVideo[];    // tt + ig 混合;含 Haiku 题材标签写入 v.topic
  meta: {
    tiktok: PlatformMeta;
    instagram: PlatformMeta;
    partial: boolean;      // 任一平台失败 = true
  };
};

type PlatformMeta = {
  source: "trends-actor" | "hashtag-proxy"; // TT=真趋势, IG=hashtag 代理
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
`getIsoWeek()` 现在是 `blob-cache.ts` 的私有函数,trending 的 snapshot key 也要用。抽到 `lib/utils/iso-week.ts`,`blob-cache.ts` 与 `snapshot-store.ts` 同时 import —— 避免周计算逻辑复制两份。与本目标直接相关的顺手改进,不引入无关重构。

### 2.5 `schemaVersion`(architect M2)
`velocity.ts` 跨周比较两份快照,schema 一变就可能拿新格式对旧格式静默出垃圾。规则:
- 当前 `schemaVersion: 1`
- `velocity.ts` 读到上周快照 `schemaVersion` 与本周不一致(或缺失)→ **当作「无上周快照」处理 → 本周全部标 NEW**,不抛错、不混算

### 2.6 兼容性
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

**global 快照如何按 `canonicalTopic` 归类** —— cron 时 LLM 打标签 + retrieval 端模糊匹配:

- **cron 端**(`lib/trending/topic-classifier.ts`):`enrichSnapshot()` 富化后,Haiku 给每条 trending 视频分类题材,写入 `v.topic`,并输出 `confidence`(0-1)。分类器把本地库题材列表(`loadVideos()` 的 distinct topics)当 hint 传入,**优先归一化到已知题材**,机制与现有 `inferTopic` 一致。
- **retrieval 端**:读最新快照,用 `jaccard()`(retrieval.ts 已有)对 `canonicalTopic` 与每条快照视频的 `v.topic` 做模糊匹配,取超阈值的 top-N;全部低于阈值 → 跳过此层直接走 live。
- 命中时 `RetrievalResult.source = "snapshot"`。

**错判兜底(architect M3)**:topic-classifier 输出 `confidence` < 阈值的视频,`v.topic` 标记为低置信(留空或打 `__low_confidence__`);retrieval 端模糊匹配**只信高置信标签**,避免把跑题样本(如「做饭」误标「fitness」)静默注入 /analyze。低置信视频仍进看板(看板不依赖题材),只是不进 /analyze 的 topic 匹配。

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
- `app/api/trending/route.ts` — 给前端平台筛选用

### 4.2 数据获取
RSC 直接调 `snapshot-store.ts` 读最新 + 上周快照 → 过 `velocity.ts` 算增量 → 渲染。首屏无客户端 fetch。

**`/api/trending` 返回精简投影(architect M1)**:该端点只返回卡片展示需要的字段(id/platform/cover/title/views/velocity/topic),**不返回完整富化快照**。理由是 list 端点最佳实践 —— 实际上 100 条富化 `ViralVideo` ≈ 200-300KB,离 Vercel 4.5MB 响应上限很远,但精简投影仍是正确做法(减少传输、前端只用得到这些字段)。参见 memory `feedback_vercel_4_5mb_limit.md`。

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

IG 卡片角标附带「热门标签」小字,与 TikTok 真趋势区分(IG 是 hashtag 代理,见决策表)。

### 4.4 badge 规则
- 🆕 **NEW** — 本周首次进 top 50;第一周无上周快照、或上周快照 `schemaVersion` 不一致时全部标 NEW
- 📈 **+N%** / 📉 **-N%** — `velocity.weekOverWeek`(rising / falling)
- 🔥 **TOP** — 连续 2+ 周稳居 top 10。需读 ≥3 周快照才算得出,**v1 降级**为「本周 top 10」简单标记。**完整 TOP 规则在 velocity history 累积满 3 周后启用 —— 此项进 plan task list,避免遗忘(architect L1)**
- 排序:本周 views 降序
- `[全部 ▾]` 下拉切 TikTok / Instagram / 全部,走 `app/api/trending/route.ts`

### 4.5 `weekOverWeek: null` 渲染(architect L4)
`velocity.weekOverWeek === null`(上周无此条 / 首周 / schemaVersion 不一致)→ 卡片渲染 🆕 NEW badge,**绝不渲染百分比**。组件层显式判 `null`,杜绝 `+null%` / `NaN%`。

### 4.6 空状态
无任何快照时(首次部署、cron 尚未跑)渲染「首次数据将于下周一生成」,不报错。

---

## Section 5 — 错误处理

### 5.1 Apify actor 失败
- TT 抓失败 → 继续抓 IG;反之亦然。对应平台 `meta.<platform>.ok = false`,`meta.partial = true`
- 两个平台都失败 → **不写空快照**(避免覆盖上周好数据),只 log,留待下周 cron 重抓

### 5.2 Cron 路由认证(双路径,architect H1)
`app/api/cron/trending/route.ts` 接受两种认证,任一通过即可:
- **Cron 自动**:`Authorization: Bearer ${process.env.CRON_SECRET}`(Vercel Cron 调用时自动带)
- **Admin 手动**:`Authorization: Bearer ${process.env.ADMIN_TRIGGER_SECRET}` —— 让 pipeline 不 100% 依赖调度器存在,可手动 kick(调试、套餐不支持 cron 时的降级入口)

两者都不匹配 → 401。

### 5.3 富化 / 题材分类部分失败
- `enrichBatch` 已有 fallback(Haiku miss → 留原字段),直接复用
- 题材标签分类同理:分类失败或低置信的视频 `v.topic` 留空 / 标低置信,retrieval 端模糊匹配自然跳过该条(见 3.2)

### 5.4 Blob 写失败
- 重试 1 次;仍失败 → log + 退出。快照幂等,下周 cron 重抓

### 5.5 看板读不到快照
- `/trending` 无快照 → 渲染空状态(见 4.6),不抛错

### 5.6 IG 热门 hashtag 列表为空 / 失效
- `ig-hot-hashtags.ts` 列表为空或全部抓不到 → IG 侧等同 actor 失败(`meta.instagram.ok = false`),不阻塞 TikTok

---

## Section 6 — 测试(TDD)

按 `superpowers:test-driven-development`,每个新模块先写失败测试,再实现 minimal pass,再 refactor。

### 6.1 单测
- `lib/trending/velocity.ts` — 纯函数,**最优先**。覆盖:新视频(上周无)、排名上升 / 下降、views 涨 / 跌、第一周无上周快照(全 NEW)、**上周 `schemaVersion` 不一致 → 全 NEW**、**`weekOverWeek` 返回 null 的分支**
- `lib/utils/iso-week.ts` — 抽出的纯函数,补跨年周边界测试
- `lib/trending/snapshot-store.ts` — mock `@vercel/blob` 的 `put` / `head`,测周 key 生成 + `pruneOldSnapshots(keepWeeks=8)`
- `lib/trending/topic-classifier.ts` — mock Haiku,测题材归一化到 hint 列表 + 分类失败留空 + **低置信标记**
- `lib/apify/scrapers.ts` 新增的 `scrapeTikTokTrending` — mock Apify client

### 6.2 集成测
- `app/api/cron/trending/route.ts` — **双认证路径**(cron header / admin token / 都不匹配 401)+ 单平台失败容错 + 两平台全失败不写空快照
- `lib/review-engine/retrieval.ts` 升级路径 — mock cache miss,验证走 snapshot 兜底层 + topic 模糊匹配命中 / 未命中 / 低置信跳过三种分支
- `app/api/trending/route.ts` — 验证返回的是精简投影、不含完整富化字段

### 6.3 E2E(Playwright)
- `/trending` — mock 快照渲染,验 badge 显示 + 平台筛选下拉 + **首周全 NEW 不出 NaN%**
- `/analyze` 改后 — fixture 验证 P0 30 天 filter 生效(超 30 天样本被过滤、`publishedAt` 缺失样本保留)

---

## architect review 处置记录(v1 → v2)

| # | 等级 | 处置 |
|---|---|---|
| H1 | High | ✅ 加 admin 手动触发路径(5.2);部署套餐可用性标「待确认」(方案 A ⚠️ 段) |
| H2 | High | ✅ TikTok 确认用 `clockworks/tiktok-trends-scraper`;IG 无 Explore actor → 改用热门 hashtag 代理,UI 标注,真 Explore 进 v2 |
| M1 | Medium | ✅ `/api/trending` 改精简投影(4.2);但修正 rationale —— 实测离 4.5MB 很远,精简是 list 端点最佳实践 |
| M2 | Medium | ✅ 加 `schemaVersion: 1`,不一致 → 全 NEW(2.5) |
| M3 | Medium | ✅ topic-classifier 输出 `confidence`,retrieval 只信高置信标签(3.2) |
| M4 | Medium | ⚠️ 与用户决策冲突 —— 提交用户复议,用户选择**保留 vercel.ts** |
| L1 | Low | ✅ 「3 周后启用完整 TOP 规则」明确进 plan task list(4.4) |
| L2 | Low | ✅ `keepWeeks=8` rationale 写明(为未来 TOP 规则留 history) |
| L3 | Low | ✅ Section 1 补全(1.1-1.4) |
| L4 | Low | ✅ `weekOverWeek: null` 渲染规则显式化(4.5) |

---

## 当前 brainstorming 流程状态

按 `superpowers:brainstorming` skill:

- [x] **Step 1**: Explore project context
- [x] **Step 2**: Visual companion offer — 跳过(无 UI 视觉对比需求)
- [x] **Step 3**: Clarifying questions — 产品决策 + 开放问题答完
- [x] **Step 4**: Propose 2-3 approaches — 选定方案 A
- [x] **Step 5**: Present design sections — 6/6 done,逐节用户批准
- [x] **Step 6**: Write design doc — 当前文件(v2,已纳入 architect review)
- [x] **Step 7**: Spec self-review
- [ ] **Step 8**: User reviews spec(v2)
- [ ] **Step 9**: Invoke `superpowers:writing-plans` skill

## 相关 memory 引用

- `feedback_hot_tracking_gap.md` — 团队反馈 + P0-P3 路线
- `project_overview.md` — 双轨架构 + 当前阶段
- `feedback_enterprise_swg_cert.md` — npm install 治本(已 push to main as `f24a31b`)
- `feedback_vercel_4_5mb_limit.md` — Vercel function 响应体上限(M1 相关)
- `video-download-stack.md` — IG 对匿名访问封闭(H2 / IG hashtag 代理决策依据)

## 待 v2 backlog
- IG 真 Explore trending(需 cookies 基础设施)
- 方案 C(Postgres)升级路径
- P3 自有视频画像库

## 当前 git 状态
- worktree branch: `feat/hot-tracking-p0-p2`
- base commit: `f24a31b`(origin/main tip when worktree created)
