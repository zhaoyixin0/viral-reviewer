# Hot Tracking — P0/P1/P2 Design

**Status**: 🔧 **v4 —— P1.7 probe 实测发现 TikTok actor 选型错误,本版修正为两阶段方案 + 视频带 hashtag 趋势上下文**
**Worktree**: `.claude/worktrees/hot-tracking`(branch `feat/hot-tracking-p0-p2`)
**Started**: 2026-05-13
**Author**: Claude (Opus 4.7) + yixin

> **v4 修订摘要(2026-05-14):** 实施到 P1.7 时,probe 实测发现 `clockworks/tiktok-trends-scraper` 返回的是**热门 hashtag 排行榜**(rank/聚合 viewCount/videoCount/趋势直方图),**不是单条热门视频** —— 戳破了 v1-v3 H2 的核心假设。重调研结论:唯一直出「国家级 trending 视频」的 actor(`lexis-solutions/...`)是 $39/月订阅,超预算。用户决策:**两阶段方案**(趋势 hashtag → 该 hashtag 下的视频),且**视频与 hashtag 信息都保留** —— 每条视频带上它所属趋势 hashtag 的 rank 等上下文,「为什么火」有趋势背书。本版据此改写 H2 决策、数据流、Section 2 schema、Section 4 看板。详见末尾「v3 → v4 处置」。

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
| TikTok trending 数据源 | **两阶段**(v4 修正,见 H2):Stage 1 `clockworks/tiktok-trends-scraper` 抓趋势 hashtag 榜 → Stage 2 取 top-N 趋势 hashtag 喂现有 `scrapeTikTokByHashtag` 抓其下高播放视频。hashtag 榜与视频**都保留落盘**;每条视频带 `trendingContext`(来源趋势 hashtag + 其 rank) |
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

**为什么 TikTok 用两阶段方案(v4 修正,P1.7 probe 实测驱动):**
- v1-v3 的 H2 假设 `clockworks/tiktok-trends-scraper` 直出 trending 视频 —— 这是从 actor 文档摘要里**误推**的。
- P1.7 probe 实测:该 actor 抓的是 TikTok Creative Center「热门 hashtag」榜,输出是 **hashtag 趋势记录**(`name` / `rank` / 聚合 `viewCount` / `videoCount` / `trendingHistogram` / `rankDiff` / `markedAsNew`),**无任何 per-video 字段**(没有单条视频的 views/likes/duration/author/cover)。
- 重调研全部候选:
  - `clockworks/tiktok-discover-scraper` —— 出视频带完整互动数据,但输入是 **hashtag**,非全局 trending,且便宜($0.03/run + $0.003/item)
  - `lexis-solutions/tiktok-trending-videos-scraper` —— **唯一**直出「国家级 trending 视频」的 actor,但 **$39/月订阅**,且互动数据要开 `includeDetailedVideoData`(更贵),超 spec「$5-10/月」预算
  - 便宜的 clockworks 系全是 hashtag 路线
- **结论:两阶段是成本合理的正解。** Stage 1 `tiktok-trends-scraper` 拿趋势 hashtag 榜(便宜,且本身就是权威趋势信号);Stage 2 取榜上 top-N hashtag 喂现有 `scrapeTikTokByHashtag` 抓其下高播放视频。
- **hashtag 与视频都要(用户决策):** 不把 Stage 1 的 hashtag 榜当一次性中间产物丢掉 —— 它和 Stage 2 的视频**一起落盘**。每条视频带 `trendingContext`(它来自哪个趋势 hashtag、该 hashtag 的 rank),让「这条视频为什么算趋势」有 hashtag 榜背书,看板也能同时展示趋势 hashtag 榜 + 趋势视频。

**为什么 IG 用 hashtag 代理而非真 Explore**(architect H2 + memory `video-download-stack.md`):
- Apify Store 无干净的 IG Explore/trending actor —— 评估过的候选 `apify/instagram-reel-scraper` 只支持 profile/hashtag/username 输入,无 explore feed 模式
- IG Explore feed 高度个性化、对匿名访问封闭,无 cookies 大概率拿不到
- 折中:cron 复用现有 `scrapeInstagramByHashtag`(包 `apify/instagram-hashtag-scraper`)抓一组人工维护的「当前热门 hashtag」,作为 IG 趋势的**代理信号**,UI 上与 TikTok 真趋势区分标注
- 注:IG 侧本就是「hashtag → 视频」,与 v4 后的 TikTok 两阶段思路天然一致;差别仅在 IG 的 hashtag 来源是人工维护列表,TikTok 是 Stage 1 actor 实时抓的趋势榜

---

## 选定方案 A — 周快照

### 一句话总览
Vercel Cron 每周一次:TikTok 走两阶段(趋势 hashtag 榜 → 其下视频),IG 走热门 hashtag 代理 → Haiku 富化 + 题材标签 → hashtag 榜 + 视频一起存 Vercel Blob → 看板渲染 + /analyze 兜底用。

### 数据流

```
┌─ Vercel Cron: 每周一 08:00 UTC ───────────────────────────────┐
│  → POST /api/cron/trending                                    │
│      认证: Cron header(CRON_SECRET)/ admin token(见 H1)     │
│  → fetchTrendingSnapshot()                                    │
│    ┌─ TikTok 两阶段 ───────────────────────────────────────┐  │
│    │ Stage 1: clockworks/tiktok-trends-scraper             │  │
│    │   → trendingHashtags[](rank/viewCount/videoCount…)   │  │
│    │ Stage 2: 取 top-N hashtag → scrapeTikTokByHashtag     │  │
│    │   → 视频,每条打 trendingContext{hashtag, hashtagRank}│  │
│    └────────────────────────────────────────────────────────┘ │
│    └─ IG: scrapeInstagramByHashtag(人工维护热门 hashtag 列表) │
│  → enrichSnapshot()                                           │
│      ├─ enrichBatch(playStyle/visual/hook)                    │
│      └─ Haiku 题材标签 + confidence(本地库题材 hint)         │
│  → writeSnapshot(week)  →  Vercel Blob                        │
│      key: trending/snapshot-<week>.json                       │
│      含: trendingHashtags[](TT 榜) + videos[](TT+IG)        │
│  → pruneOldSnapshots(keepWeeks=8)                             │
└────────────────────────────────────────────────────────────────┘

           ▼                              ▼
┌─────────────────────────┐   ┌─────────────────────────────┐
│ /trending 看板(new)    │   │ /analyze(existing)         │
│  - SSR RSC 直读快照      │   │  retrieval.ts 升级:         │
│  - 趋势 hashtag 榜 +     │   │   ① P0: ≤30d filter on      │
│    趋势视频两个视图      │   │      live + snapshot only   │
│  - velocity.ts 算 badge │   │   ② cache miss 多一层兜底:  │
│  - /api/trending 精简投影│   │      trending snapshot      │
│    (平台筛选用)         │   │      按 topic 模糊匹配采样  │
└─────────────────────────┘   └─────────────────────────────┘
```

### 成本估算
- **TikTok Stage 1**:`clockworks/tiktok-trends-scraper` —— 抓趋势 hashtag 榜,1 run/周,≈ **$0.05-0.10/周**
- **TikTok Stage 2**:`scrapeTikTokByHashtag` 跑 top-N 趋势 hashtag(N≈5-8),复用现有 scraper;视频量与现有 /analyze 实时抓同量级,≈ **$0.10-0.20/周**
- **Instagram**:`apify/instagram-hashtag-scraper`,~50 条/周 ≈ **$0.13/周**
- cron 时多一笔 Haiku 富化 + 题材分类(~100 条/周,成本可忽略)
- 合计 **≤ $5/月**(含 Apify 平台 run 开销冗余)—— 仍在预算内,远低于 `lexis-solutions` 的 $39/月订阅方案
- 8 周滚动 = 自然形成 velocity history

### 备选已 reject
- **方案 B 日快照**:7× Apify 成本,且跟「本周」产品语义错配
- **方案 C Postgres**:留作 v2 升级路径,169 条富化样本的产品体量配不上

### ⚠️ 部署前置(architect H1)
**Vercel Cron 在当前部署套餐下的可用性尚未验证**(本机无 Vercel CLI 无法查)。实施前必须确认 / 配置:
- 部署套餐是否支持 cron(Hobby 套餐 cron 有频率限制)
- 周度 schedule `0 8 * * 1` 是否被套餐允许
- **环境变量 `ADMIN_TRIGGER_SECRET` 必须手动配置** —— `CRON_SECRET` 是 Vercel Cron 自带,`ADMIN_TRIGGER_SECRET` 不是;漏配则 H1 的手动触发降级入口失效
若套餐不支持,降级方案:外部调度器(GitHub Actions cron)POST 到带 admin token 的 `/api/cron/trending`。

---

## 关键模块清单

| 模块 | 状态 | 职责 |
|---|---|---|
| `lib/utils/iso-week.ts` | ✅ 已完成 (P1.2) | 从 `blob-cache.ts` 抽出的 `getIsoWeek()` 纯函数,两处共用 |
| `lib/trending/types.ts` | ✅ 已完成 (P1.3) /🔧 v4 追加 | 已有 `TrendingSnapshot` / `PlatformMeta` / `TrendingVideoWithVelocity`;**v4 追加** `TrendingHashtag` 类型 + `TrendingSnapshot.trendingHashtags[]` 字段 + loose Zod schema 同步加 `trendingHashtags` |
| `lib/trending/ig-hot-hashtags.ts` | 🆕 新增 | 人工维护的 IG 热门 hashtag 列表 + 维护说明注释 |
| `lib/trending/fetch.ts` | 🆕 新增 | TikTok 两阶段(Stage 1 趋势 hashtag → Stage 2 该 hashtag 下视频 + 打 `trendingContext`)+ IG hashtag 代理 + `enrichSnapshot()` |
| `lib/trending/snapshot-store.ts` | ✅ 已完成 (P1.6) | Blob 读写 + 周 key + `pruneOldSnapshots()`(v4 schema 变化由 types.ts 的 loose Zod 吸收,本文件逻辑不变) |
| `lib/trending/velocity.ts` | ✅ 已完成 (P1.5) | 纯函数:对比相邻两周快照算 velocity / rank / trend(只比 `videos[]` 的 id/views,v4 不受影响) |
| `lib/trending/topic-classifier.ts` | 🆕 新增 | Haiku 给 trending 视频打题材标签 + confidence(本地库题材当 hint) |
| `app/api/cron/trending/route.ts` | 🆕 新增 | Cron handler(双认证:cron header / admin token + 失败容错) |
| `app/trending/page.tsx` | 🆕 新增 | 看板 RSC,直读快照,展示趋势 hashtag 榜 + 趋势视频两个视图 |
| `app/api/trending/route.ts` | 🆕 新增 | 看板平台筛选用,返回**精简卡片投影**(非完整快照) |
| `vercel.ts` | 🆕 新增 | cron schedule 配置(需 `npm i @vercel/config`) |
| `lib/apify/scrapers.ts` | ✏️ 修改(追加) | 新增 `scrapeTikTokTrendingHashtags`(包装 `clockworks/tiktok-trends-scraper`,**返回 `TrendingHashtag[]`**,Stage 1);Stage 2 直接复用现有 `scrapeTikTokByHashtag` |
| `lib/apify/normalize.ts` | ✏️ 修改(追加) | 新增 `normalizeTikTokTrendingHashtag`(把 trends-scraper 的 hashtag 记录归一化为 `TrendingHashtag`);Stage 2 视频复用现有 `normalizeTikTokItem` |
| `lib/review-engine/types.ts` | ✅ 已完成 (P1.4) /🔧 v4 追加 | 已有 `topicConfidence?: number`;**v4 追加** `ViralVideo` 可选字段 `trendingContext?: { hashtag: string; hashtagRank: number }` |
| `lib/topic-cache/blob-cache.ts` | ✅ 已完成 (P1.2) | 改为 import `lib/utils/iso-week.ts`(去重) |
| `lib/research/topic-research.ts` | ✅ 已完成 (P0.1) | TT/IG sort 前各加 30d filter(P0) |
| `lib/review-engine/retrieval.ts` | 🆕 待做 (P2.1) | cache 与 live 之间插入 snapshot 兜底层 |
| `scripts/probe-tiktok-trends.ts` | ✅ 已完成 (P1.7) | probe 脚本,实测发现 actor 返回 hashtag 榜 —— 驱动了本次 v4 修订 |

### 不动的模块
- `lib/topic-cache/blob-cache.ts` 的缓存逻辑(trending 用独立 `trending/` namespace)
- `lib/enrichment/batch-runner.ts` / `lib/research/enrich-one.ts` 的 `enrichBatch`(直接复用)
- 现有 `scrapeTikTokByHashtag`(不删,v4 后 Stage 2 **直接复用**它);`scrapeInstagramByHashtag` **复用**给 IG 代理,不改
- 现有 `normalizeTikTokItem`(Stage 2 视频复用它)

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

### 2.1 `TrendingSnapshot`(v4 修订)

`ViralVideo` 已自带 `platform: "tiktok" | "instagram"` 字段;合并 tt+ig 单文件,无顶层 `source` 字段,靠 `v.platform` 区分。**v4 追加** `trendingHashtags[]` —— TikTok Stage 1 抓回的趋势 hashtag 榜,与 `videos[]` 一起落盘。

```typescript
type TrendingSnapshot = {
  schemaVersion: 1;        // 见 2.5。注:v4 改了 schema 形状但 feature 未上线、无存量 v1 数据,
                           // 故不 bump 版本号 —— "v1" 的定义直接更新为含 trendingHashtags
  week: string;            // ISO week "2026-W20"
  capturedAt: string;      // ISO timestamp
  trendingHashtags: TrendingHashtag[]; // v4 新增:TikTok Stage 1 趋势 hashtag 榜(IG 无此项,IG 用人工列表)
  videos: ViralVideo[];    // tt + ig 混合;TT 视频带 trendingContext;含 Haiku 题材标签写入 v.topic
  meta: {
    tiktok: PlatformMeta;
    instagram: PlatformMeta;
    partial: boolean;      // 任一平台失败 = true
  };
};

// v4 新增:TikTok Stage 1 趋势 hashtag 记录(来自 clockworks/tiktok-trends-scraper)
type TrendingHashtag = {
  name: string;            // hashtag 名,如 "morningroutine"
  rank: number;            // 趋势榜排名,1 = #1
  viewCount: number;       // 该 hashtag 下视频的聚合播放量
  videoCount: number;      // 使用该 hashtag 的视频数
  rankDiff: number;        // 相对上期的排名变化(actor 提供;>0 上升)
  isNew: boolean;          // actor 标记的新晋趋势
  industryName?: string;   // actor 的行业/类目标签
};

type PlatformMeta = {
  source: "trends-actor" | "hashtag-proxy"; // TT=两阶段(Stage 1 trends-actor), IG=hashtag 代理
  actorRun: string;        // Apify run ID,用于追溯(TikTok 记 Stage 1 的 run id)
  rawCount: number;        // 抓回多少条(TikTok 记 Stage 2 视频数)
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

### 2.6 `ViralVideo` 扩展与兼容性
- `ViralVideo` 加可选字段 `topicConfidence?: number`(0-1,trending 题材标签置信度),与现有 Phase-1+ 可选字段(`videoFormat` / `density` 等)风格一致,向后兼容现有 enriched JSON ✅ 已实现 (P1.4)
- **v4 追加** `ViralVideo` 可选字段 `trendingContext?: { hashtag: string; hashtagRank: number }` —— TikTok Stage 2 视频记录它来自哪个趋势 hashtag、该 hashtag 在 Stage 1 榜上的 rank。让「这条视频为什么算趋势」可追溯到趋势 hashtag 榜。IG 视频与非 trending 来源的 `ViralVideo` 不带此字段。
  - 一条视频若在多个趋势 hashtag 下都被抓到:取**首个命中(rank 最高)**的 hashtag,不存数组(v1 从简)。
- 非 trending 来源的 `ViralVideo` 不带 `topicConfidence` / `trendingContext`,不受影响
- 现有 `TopicCacheEntry` 不动

### 2.7 loose Zod schema(v4 同步)
- P1 实施时为「Blob 系统边界校验」加了 `TrendingSnapshotSchema`(loose Zod)。v4 schema 变化后,该 schema 需同步:`trendingHashtags` 加为 `z.array(...).optional()` 或 `z.array(...)`(passthrough 内层),保持 loose 风格 —— 旧快照(无 trendingHashtags)不应 parse 失败,故 **optional**。
- 校验锚点不变:`schemaVersion` / `week` / `videos[].{id,views}`;`trendingHashtags` 作为 optional 结构补充。

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

- **cron 端**(`lib/trending/topic-classifier.ts`):`enrichSnapshot()` 富化后,Haiku 给每条 trending 视频分类题材,题材字符串写入 `v.topic`,置信度写入**独立字段** `v.topicConfidence`(0-1)。`v.topic` 始终是干净的题材字符串,不掺哨兵值。分类器把本地库题材列表(`loadVideos()` 的 distinct topics)当 hint 传入,**优先归一化到已知题材**,机制与现有 `inferTopic` 一致。
- **retrieval 端**:读最新快照,先按 `v.topicConfidence >= 阈值` 过滤掉低置信视频,再用 `jaccard()`(retrieval.ts 已有)对 `canonicalTopic` 与每条快照视频的 `v.topic` 做模糊匹配,取超阈值的 top-N;全部不命中 → 跳过此层直接走 live。
- 命中时 `RetrievalResult.source = "snapshot"`。

**错判兜底(architect M3)**:`v.topicConfidence` 是独立数值字段,不污染语义为「题材」的 `v.topic`,避免「留空 or 哨兵」两种写法让判空逻辑分叉。分类失败 → 不写 `topicConfidence`(retrieval 端视为 0);低于阈值的视频 retrieval 端直接跳过,避免把跑题样本(如「做饭」误标「fitness」)静默注入 /analyze。低置信视频仍进看板(看板不依赖题材),只是不进 /analyze 的 topic 匹配。

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
RSC 直接调 `snapshot-store.ts` 读最新 + 上周快照 → 过 `velocity.ts` 算增量 → 渲染。首屏无客户端 fetch。看板渲染**两个视图**(v4):趋势视频卡片网格(4.3)+ 趋势 hashtag 榜(4.7)。

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

### 4.7 趋势 hashtag 榜视图(v4 新增)
用户决策「hashtag 和视频都要」。看板除视频卡片网格外,再展示一个**趋势 hashtag 榜**(数据源:`snapshot.trendingHashtags`,仅 TikTok 有):
- 列表/榜单形式,每行:`#hashtag` · rank · 聚合 viewCount · videoCount · rankDiff 升降箭头 · 🆕(`isNew`)
- 排序:按 `rank` 升序
- 点击某个 hashtag:可滚动/筛选到视频网格里 `trendingContext.hashtag` 命中该 hashtag 的视频(v1 可简化为纯展示,点击交互留 backlog)
- 视频卡片(4.3)上,TikTok 视频额外显示一行小字「来自趋势 #hashtag(榜 #rank)」—— 即 `trendingContext`,让视频与 hashtag 榜呼应
- IG 无 `trendingHashtags`,该视图只显示 TikTok 部分;IG 视频卡仍按既有「热门标签代理」小字标注

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
- 题材标签分类同理:分类失败的视频不写 `v.topicConfidence`(retrieval 端视为 0),低置信视频 `topicConfidence` 低于阈值,retrieval 端按阈值过滤自然跳过(见 3.2)

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
- `lib/trending/topic-classifier.ts` — mock Haiku,测题材归一化到 hint 列表 + 分类失败不写 `topicConfidence` + 低置信视频 `topicConfidence` 数值正确
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

### v2 review 二轮处置(v2 → v3)

architect 二轮确认 v1 的 6 条已修到位,v2 新引入 3 个小问题:

| # | 问题 | 处置 |
|---|---|---|
| v2-1 | `ADMIN_TRIGGER_SECRET` 未登记进部署清单 | ✅ 「⚠️ 部署前置」段显式加一项,标明它不是 Vercel 自带、漏配则降级入口失效 |
| v2-2 | `apify/instagram-reel-scraper` 在「关键论证」是悬空引用 | ✅ 改为明确标「评估过的候选」,并补上实际选用的 `scrapeInstagramByHashtag` / `apify/instagram-hashtag-scraper` |
| v2-3 | `__low_confidence__` 哨兵设计含糊、污染 `v.topic` | ✅ 改用独立字段 `topicConfidence?: number`(加进 `ViralVideo`),`v.topic` 保持纯净;分类失败=不写该字段,retrieval 端视为 0 |

(L322 TOP 规则降级措辞 architect 标非阻塞,未改。)

### v3 → v4 处置(2026-05-14,P1.7 probe 实测驱动)

实施进行到 P1.7(probe `clockworks/tiktok-trends-scraper`)时,实测发现 v1-v3 H2 的核心假设错误,触发本次 spec 修订:

| # | 问题 | 处置 |
|---|---|---|
| v4-1 | `clockworks/tiktok-trends-scraper` 实际返回热门 **hashtag 榜**,非 trending 视频 —— v1-v3 H2 从文档摘要误推 | ✅ 重调研全部候选;TikTok 改为**两阶段**(Stage 1 趋势 hashtag 榜 → Stage 2 该 hashtag 下视频)。决策表 + 关键论证 + 数据流全部改写 |
| v4-2 | 唯一直出 trending 视频的 `lexis-solutions/...` 是 $39/月订阅,超预算 | ✅ 否决;两阶段方案成本 ≤ $5/月,留在预算内。成本估算段重写 |
| v4-3 | 用户要 hashtag 榜与视频都保留,视频要能追溯到趋势 hashtag | ✅ `TrendingSnapshot` 加 `trendingHashtags[]`;新增 `TrendingHashtag` 类型;`ViralVideo` 加 `trendingContext?`;看板加趋势 hashtag 榜视图(4.7) |
| v4-4 | schema 变化波及已实现的 P1.3/P1.4 + P1 review 加的 loose Zod schema | ✅ `types.ts` 追加 `TrendingHashtag` + `trendingHashtags` 字段;`ViralVideo` 追加 `trendingContext`;loose Zod schema 把 `trendingHashtags` 加为 optional(旧快照不 parse 失败);schemaVersion 不 bump(feature 未上线无存量数据,见 2.1 注) |

**对 plan 的影响:** P1.7 已完成(probe 脚本是发现问题的工具,保留)。需改写的 plan 任务:
- **P1.8**:从「`normalizeTikTokTrendItem`(视频 normalizer)」改为「`normalizeTikTokTrendingHashtag`(hashtag 记录 normalizer)」+ `TrendingHashtag` 类型加进 types.ts + loose Zod 同步
- **P1.9**:从「`scrapeTikTokTrending` 包装 actor 返回视频」改为「`scrapeTikTokTrendingHashtags` 返回 `TrendingHashtag[]`(Stage 1)」
- **P1.12**(`fetch.ts`):改为 TikTok 两阶段编排 —— Stage 1 拿 hashtag 榜 → 取 top-N → Stage 2 复用 `scrapeTikTokByHashtag` 抓视频 + 打 `trendingContext` → 合并;`TrendingSnapshot` 落盘含 `trendingHashtags`
- **P1.4 增量**:`ViralVideo` 加 `trendingContext?`(P1.4 已合入 `topicConfidence`,这是追加项,需新 task 或并入 P1.8)
- **P2.x 看板**:P2.5/P2.6 加趋势 hashtag 榜视图;P2.3 卡片加 `trendingContext` 小字
- 不受影响:P0.1 / P1.1 / P1.2 / P1.3(基础部分)/ P1.5 velocity / P1.6 snapshot-store / P1.10 ig-hot-hashtags / P1.11 topic-classifier / P1.13 cron route / P1.14 vercel.ts / P2.1 retrieval / P2.2 api / P2.4 / P2.7 / P2.8

---

## 当前 brainstorming 流程状态

按 `superpowers:brainstorming` skill:

- [x] **Step 1**: Explore project context
- [x] **Step 2**: Visual companion offer — 跳过(无 UI 视觉对比需求)
- [x] **Step 3**: Clarifying questions — 产品决策 + 开放问题答完
- [x] **Step 4**: Propose 2-3 approaches — 选定方案 A
- [x] **Step 5**: Present design sections — 6/6 done,逐节用户批准
- [x] **Step 6**: Write design doc — 当前文件(v3,已纳入两轮 architect review)
- [x] **Step 7**: Spec self-review
- [ ] **Step 8**: User reviews spec(v3)
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
