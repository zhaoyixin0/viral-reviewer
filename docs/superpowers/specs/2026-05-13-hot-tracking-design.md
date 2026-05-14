# Hot Tracking — P0/P1/P2 Design (WIP)

**Status**: 🟡 **WIP — brainstorming Section 1/6 complete, 5 more sections pending**
**Worktree**: `.claude/worktrees/hot-tracking` (branch `feat/hot-tracking-p0-p2`)
**Started**: 2026-05-13
**Author**: Claude (Opus 4.7) + yixin

---

## 🚀 Resume Instructions (for next session / new machine)

```bash
# 新机器 / 换电脑：
git clone <repo> help_you_viral
cd help_you_viral
git fetch
git worktree add .claude/worktrees/hot-tracking feat/hot-tracking-p0-p2

# 在新 Claude Code 窗口里调:
EnterWorktree(path=".claude/worktrees/hot-tracking")

# 然后让 Claude 读这个文件继续 brainstorming.
# 提示词建议:
# "继续 brainstorming，读 docs/superpowers/specs/2026-05-13-hot-tracking-design.md
#  Section 1 已 present 完，请展开 Section 2 (数据 schema)"
```

---

## 背景

### 母诉求
团队 2026-05-12 反馈：「当前的热点的来源是什么，又是怎么样被列为热点的。这个产品的最终目的不管是对内还是对外都是热点追踪」。

参见 memory: `feedback_hot_tracking_gap.md`。

### 当前实现的真相（5/13 状态）
- 100% Apify hashtag 搜索，按 views 排序就是「热点」
- `publishedAt` 跨度 2019-06 → 2026-04（7 年），无时间窗过滤
- 169 条 enriched-cutplans 是历史样本，不是趋势数据
- 无主动发现机制

### Memory 里 P0-P3 路线
- **P0**: retrieval 加 publishedAt 时间窗过滤
- **P1**: Vercel Cron 定时抓 + velocity 字段 + 排序加权
- **P2**: 真趋势发现（TikTok Discover / IG Explore Trending）
- **P3**: 自有视频画像库（手动喂参考视频）

本 spec 解决 **P0 + P1 + P2 一并**，P3 留 v2。

---

## 已收集的产品决策

| 维度 | 答案 |
|---|---|
| 产品形态 | **两者并行**：新增独立趋势看板页面 + 同时改善现有 /analyze 输入样本质量 |
| 看板覆盖范围 | **Platform Global Trending**（抓 TikTok Discover / IG Explore 顶部，不介入题材） |
| 「新」时间窗定义 | **30 天**（月度热点，足够过滤掉历史经典爆款，又能保留样本量） |
| P0 时间窗 filter 应用范围 | **只应用在 live + trending-snapshot**，本地池 169 条作为「经典样本」保留，UI 标 badge |

### 关键论证

**P0 必须跟 P1/P2 一起做**（不能单独先上 P0）：
1. P0 是 P1 的前置依赖 — P1 velocity 公式需要 `publishedAt` 切片
2. 代码 footprint 小到不值得分阶段
3. P0 第一天上线就能消除「7 年老爆款」，给 P1/P2 数据累积期争取时间

**为什么 P0 filter 不应用到本地池**：
- 169 条富化样本 publishedAt 跨 7 年，应用 30 天 filter 后几乎全空
- 本地池作为「经典样本」UI 标 badge 保留
- live + trending-snapshot 才是「新」的数据源，对它们应用 filter

---

## 选定方案 A — 周快照

### 一句话总览
Vercel Cron 每周一次抓 TikTok/IG Global Trending → Haiku 富化 → 存 Vercel Blob → 看板渲染 + /analyze 兜底用。

### 数据流

```
┌─ Vercel Cron: 每周一 08:00 UTC ─────────────┐
│  → POST /api/cron/trending                  │
│  → fetchTrendingSnapshot()                  │
│      ├─ Apify: TT Discover top 50           │
│      └─ Apify: IG Explore top 50            │
│  → enrichSnapshot() (复用 enrichBatch)      │
│  → writeSnapshot(week)  →  Vercel Blob      │
│  → pruneOldSnapshots(keepWeeks=8)           │
└─────────────────────────────────────────────┘

           ▼                              ▼
┌─────────────────────────┐   ┌─────────────────────────────┐
│ /trending 看板 (new)    │   │ /analyze (existing)         │
│  - SSR /api/trending    │   │  retrieval.ts 升级:         │
│  - 读最新+上周快照       │   │   ① P0: ≤30d filter on      │
│  - 计算 velocity badge  │   │      live + snapshot only   │
│  - top N + 类目分组      │   │   ② miss 时多一层兜底:      │
└─────────────────────────┘   │      trending snapshot      │
                              │      按 topic 归类后采样    │
                              └─────────────────────────────┘
```

### 成本估算
- ~1-2 Apify run/周 × 4 周 = **$5-10/月**
- 跟「本周在涨」语义 1:1 对齐
- 不引新依赖（继续用 Vercel Blob）
- 8 周滚动 = 自然形成 velocity history

### 备选已 reject
- **方案 B 日快照**：7× Apify 成本（$30-50/月），但跟「本周」产品语义错配
- **方案 C Postgres**：留作 v2 升级路径，169 条富化样本的产品体量配不上

---

## 关键模块清单

| 模块 | 状态 | 路径 |
|---|---|---|
| `lib/trending/fetch.ts` | 🆕 新增 | 调 Apify trending actors |
| `lib/trending/snapshot-store.ts` | 🆕 新增 | Blob 读写 + 周 key + prune |
| `lib/trending/velocity.ts` | 🆕 新增 | 对比相邻两周快照算增量 |
| `app/api/cron/trending/route.ts` | 🆕 新增 | Vercel Cron handler |
| `app/trending/page.tsx` | 🆕 新增 | 看板 RSC |
| `app/api/trending/route.ts` | 🆕 新增 | 看板前端轮询用 |
| `lib/research/topic-research.ts` | ✏️ 修改 | 加 30d filter（P0），但只对 live 数据 |
| `lib/review-engine/retrieval.ts` | ✏️ 修改 | live-fetch 前多一道 snapshot 兜底 |
| `lib/apify/scrapers.ts` | ✏️ 修改（追加） | 新增 `scrapeTikTokTrending` / `scrapeInstagramExplore` |
| `vercel.json` 或 `vercel.ts` | 🆕 新增 | cron schedule 配置 |

### 不动的模块
- `lib/topic-cache/blob-cache.ts`（trending-snapshot 用独立 namespace）
- `lib/enrichment/batch-runner.ts` / `enrichBatch`（直接复用）
- 现有 `scrapeTikTokByHashtag` / `scrapeInstagramByHashtag`（不删，trending 是新增）

---

## ✅ Section 1 — Architecture (已 present, 用户已批准方案 A)

参见上方「数据流」与「关键模块清单」。

### Section 1 收尾时的开放问题（待用户决策）

1. **Trending snapshot 与 topic-cache 是否共享 Blob namespace？**
   - 推荐：**独立 namespace**
   - `topic-cache/<topic>-<week>.json` ← per-topic, 已有
   - `trending/snapshot-<week>.json` ← global, 新增
   - 理由：粒度不同（per-topic vs global）、读侧路径不同、prune 策略不同

2. **Vercel cron 配置文件用 `vercel.json` 还是 `vercel.ts`？**
   - 现状：项目无 vercel.json 也无 vercel.ts
   - System reminder 推荐 `vercel.ts`（GA, full TypeScript, dynamic logic）
   - 推荐：**vercel.ts**（顺手现代化、未来加更多 cron 不痛苦）
   - 需要 `npm i @vercel/config`

---

## ⏳ Section 2 — Data Schema (待写)

需要覆盖：

### 2.1 `TrendingSnapshot` 类型
```typescript
type TrendingSnapshot = {
  week: string;            // ISO week "2026-W20"
  capturedAt: string;      // ISO timestamp
  source: "tiktok" | "instagram";
  videos: ViralVideo[];    // 复用现有 ViralVideo type
  meta: {
    actorRun: string;      // Apify run ID for traceability
    rawCount: number;      // 抓回多少条
    enrichedCount: number; // Haiku 富化成功多少条
  };
};
```

### 2.2 velocity 字段
```typescript
type TrendingVideoWithVelocity = ViralVideo & {
  velocity?: {
    weekOverWeek: number;   // (thisWeek.views - lastWeek.views) / lastWeek.views
    rank: { current: number; previous: number | null };
    trend: "rising" | "stable" | "falling" | "new";
  };
};
```

### 2.3 Blob key 命名
- `trending/snapshot-2026-W20-tiktok.json`
- `trending/snapshot-2026-W20-instagram.json`
- 或合并：`trending/snapshot-2026-W20.json`（含 tt+ig）— **推荐合并**，减少 Blob 操作

### 2.4 兼容性
- 跟现有 `ViralVideo` type 完全兼容
- 现有 `TopicCacheEntry` 不动

---

## ⏳ Section 3 — /analyze 集成 (待写)

### 3.1 retrieval.ts 升级
当前顺序：
```
local → topic-cache → live-fetch → cross-topic fallback
```
改后：
```
local → topic-cache → trending-snapshot (按 topic 归类) → live-fetch (P0 filter) → cross-topic fallback
                          ↑                                          ↑
                          新增免费兜底                                P0 filter 应用点
```

### 3.2 P0 时间窗 filter
在 `topic-research.ts` 的两个 sort 之前各加：
```ts
const CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;
const filtered = raw.filter(v => {
  if (!v.publishedAt) return true; // 未知时间不丢
  const age = Date.now() - new Date(v.publishedAt).getTime();
  return age <= CUTOFF_MS;
});
```

### 3.3 UI 标注
- /analyze 返回的样本 UI 加 badge：
  - 「经典」← 来自本地池（169 条 enriched-cutplans）
  - 「近期」← 来自 live 或 snapshot
  - 「N 天前」← publishedAt 计算

---

## ⏳ Section 4 — Trending 看板 UI (待写)

### 4.1 路由
- `/trending` — SSR 页面
- 不需要登录（看板对外可见）

### 4.2 布局草图
```
┌────────────────────────────────────────────────┐
│  Header: 本周热点 (2026 W20 · 截止 5/19)        │
│  Toggle: [TikTok | Instagram | All]            │
├────────────────────────────────────────────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐               │
│  │ #1  │ │ #2  │ │ #3  │ │ #4  │ ← 视频卡片    │
│  │📈+45│ │📈+12│ │🆕   │ │📉-8 │ ← velocity   │
│  └─────┘ └─────┘ └─────┘ └─────┘               │
│  ...                                            │
└────────────────────────────────────────────────┘
```

### 4.3 关键指标 badge
- 🆕 **NEW** — 本周首次进 top 50
- 📈 **+45%** — 本周播放量比上周涨 45%
- 📉 **-8%** — 跌
- 🔥 **TOP** — 连续 N 周稳居 top 10

### 4.4 待决策
- 看板要不要按平台分两栏 vs 合并？
- 类目分组要不要做？（trending 是 global，按内容自动分组比较硬）

---

## ⏳ Section 5 — 错误处理 (待写)

### 5.1 Apify actor 失败
- TT 抓失败：继续 IG，标记 snapshot.meta.partial=true
- 两个都失败：write empty snapshot + 邮件/Slack 告警（可选）

### 5.2 Cron 路由的认证
- Vercel Cron 自动带 `Authorization: Bearer $CRON_SECRET` 头
- 路由必须验签，否则任何人可触发

### 5.3 富化部分失败
- enrichBatch 已有 fallback 机制（Haiku miss → 留原字段）
- 直接复用

### 5.4 Blob 写失败
- 重试 1 次
- 仍失败：log + 下次 cron 重抓（snapshot 是幂等的）

---

## ⏳ Section 6 — 测试 (待写)

### 6.1 单测
- `lib/trending/velocity.ts` — 纯函数，最优先测试
- `lib/trending/snapshot-store.ts` — mock Blob client
- `lib/apify/scrapers.ts` 新增函数 — mock Apify client

### 6.2 集成测
- `app/api/cron/trending/route.ts` — auth 验签 + 失败容错
- retrieval.ts 升级路径 — 模拟 cache miss 走 snapshot

### 6.3 E2E
- `/trending` 页面 — 用 mock snapshot 渲染
- /analyze 改后 — 用 fixture 验证 P0 filter

### 6.4 TDD 策略
按 superpowers:test-driven-development，每个新模块：
1. 写失败测试
2. 实现 minimal pass
3. refactor

---

## 关键开放问题（汇总）

| # | 问题 | 推荐 |
|---|---|---|
| 1 | trending snapshot 独立 namespace? | 是（独立） |
| 2 | vercel.json vs vercel.ts? | vercel.ts |
| 3 | snapshot key 合并 tt+ig 还是分开? | 合并（减少 Blob ops） |
| 4 | 看板按平台分栏 vs 合并? | 待定，倾向合并并加 platform badge |
| 5 | 类目分组要不要做? | 暂不做（global trending 没题材） |
| 6 | Cron secret 怎么管? | Vercel 自带 `CRON_SECRET` env var |
| 7 | 第一周没有上周 snapshot 时 velocity 怎么显示? | 全部标 🆕 NEW |

---

## 当前 brainstorming 流程状态

按 `superpowers:brainstorming` skill：

- [x] **Step 1**: Explore project context (5/13)
- [x] **Step 2**: Visual companion offer — 跳过（无 UI 视觉对比）
- [x] **Step 3**: Clarifying questions — 4 个问题答完
- [x] **Step 4**: Propose 2-3 approaches — 选定 A
- [ ] **Step 5**: Present design sections — 1/6 done
- [ ] **Step 6**: Write design doc — 当前文件即雏形
- [ ] **Step 7**: Spec self-review
- [ ] **Step 8**: User reviews spec
- [ ] **Step 9**: Invoke `superpowers:writing-plans` skill

## 下一次 Claude 应该做什么

1. 读这个文件了解全部上下文
2. 跟用户确认 Section 1 收尾的 2 个开放问题（namespace 独立 + vercel.ts）
3. 继续 present Section 2（数据 schema）→ 5 → 6
4. 每节征求用户批准
5. 全部章节完成后：rewrite 本文件去掉 "WIP" + 完整 design + commit
6. spec self-review → 让用户最终批准
7. 调 `superpowers:writing-plans` 生成实施计划

## 相关 memory 引用

- `feedback_hot_tracking_gap.md` — 团队反馈 + P0-P3 路线
- `project_overview.md` — 双轨架构 + 当前阶段
- `feedback_enterprise_swg_cert.md` — npm install 治本（已 push to main as `f24a31b`）

## 当前 git 状态

- worktree branch: `feat/hot-tracking-p0-p2`
- base commit: `f24a31b` (origin/main tip when worktree created)
- 主目录 main 本地领先 1 commit (`0197261 chore: gitignore .worktrees/`) — 未 push，cosmetic
