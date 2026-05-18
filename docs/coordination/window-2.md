# 窗口 2 任务派发：L3+ trending dashboard 后端 + UI（T4+T5）

> **写于** 2026-05-17 23:30 PDT · **针对 main SHA** `cacf0e5` · **给窗口 2**
>
> 完整 scope 在 `docs/coordination/_W3_l3plus_plan.md`（必读）。本文件覆盖上一条 W3 指令，本次派发为新 epic L3+。

---

## 你领的 task

**2 个 task（在 W4 T3 完成 + merge 到 main 后再开始）**：
- **T4** — `/api/trending` insight 投影 + RSC 数据注入（plan §5）
- **T5** — TrendingBoard 5 tab UI 升级（plan §6）

**估时**：合计 3 工日（T4=1d + T5=2d）。

**分支建议**：`feat/l3plus-w2-trending-dashboard`（T4+T5 一个分支贯穿，按 task 边界 commit）。

---

## 启动前置条件（**必须等到**）

W4 T3 完成 → C7 commit merge 到 `main` → 你 `git pull origin main` 确认 `lib/trending/types.ts` 含 v2 schema + `insight` 字段 + `TRENDING_SCHEMA_VERSION = 2`。

**未满足前置不要开始**：T4 投影函数需要 T2 export 的 `TrendingInsight` 类型，T5 需要 T4 export 的 `BoardInsightDTO`。

W3 监控 W4 push 事件，W4 全部 merge 后会在本文件追加 `W3 → W2 UNBLOCK` 通知。

---

## User 已拍板的决策（影响你的实施）

D1/D2/D5 不直接影响 W2 工作。但你产出的 DTO 必须包含 D1 的 LLM event 输出字段（`eventTab` 已在 plan §5.4 草案里覆盖，照做即可）。

---

## 跨窗口依赖与 file lock

**W2 独占写**（T4+T5 期间，其他窗口不许动）：
- `app/api/trending/route.ts`（modify，GET handler 加 `insight` 字段）
- `app/trending/page.tsx`（modify，RSC 把 insight 注入 TrendingBoard props）
- `lib/trending/insight-projection.ts`（new）
- `components/trending/TrendingBoard.tsx`（modify，加 tab nav state）
- `components/trending/InsightTabs.tsx`（new）
- `components/trending/tabs/HashtagTab.tsx`（new）
- `components/trending/tabs/TechniqueTab.tsx`（new）
- `components/trending/tabs/BgmTab.tsx`（new）
- `components/trending/tabs/EventTab.tsx`（new）
- `components/trending/tabs/VelocityTab.tsx`（new）
- `components/trending/charts/TechniqueBar.tsx`（new）
- `tests/trending/insight-projection.test.ts`（new）
- `tests/components/trending/insight-tabs.test.tsx`（new）

**只读不动**：
- `lib/trending/types.ts`（W4 已 v1→v2 升级好，**只读不改**）
- `lib/trending/insight-schema.ts`（W4 已写好，**只读不改**）
- `components/trending/TrendingCard.tsx`（W4 owned，T5 不改其视觉）
- `components/trending/PlatformFilter.tsx`（W4 owned）

---

## 提交节奏（强制）

| Commit | 内容 | gates |
|---|---|---|
| C1 | T4 — `insight-projection.ts` + projection unit test（含 v1 老快照 → null 降级） | tsc 0 / vitest 全绿 |
| C2 | T4 — `/api/trending` route 加 `insight` 字段 + integration test | tsc 0 / vitest 全绿 / build 0 |
| C3 | T4 — `app/trending/page.tsx` RSC 注入 `initialInsight` 到 TrendingBoard props | tsc 0 / vitest 全绿 / build 0 |
| C4 | T5 — `InsightTabs.tsx` 框架 + tab nav state + `initialInsight=null` 降级（只渲 videos tab） | tsc 0 / vitest 全绿 |
| C5 | T5 — `HashtagTab` + `TechniqueTab` + `TechniqueBar` 共享组件 | tsc 0 / vitest 全绿 |
| C6 | T5 — `BgmTab` + `EventTab` + `VelocityTab` | tsc 0 / vitest 全绿 |
| C7 | T5 — RTL smoke test + 本地手测确认 5 tab 切换不报错 | tsc 0 / vitest 全绿 / build 0 / 手测 OK |

**每个 commit push 之前**：
- 跑 `npx tsc --noEmit && npx vitest run && npm run build`
- 必读 commit N 的 W3 nit list 再起 commit N+1
- pre-push reviewer 不准 skip dep changes / config 改动

---

## 必读 memory（防回归）

1. `feedback_window3_direct_window_messages.md` — W3 通过本文件下指令，你只读本文件不要等用户转贴
2. `feedback_read_prev_commit_nits_before_next.md` — 起 commit N+1 必先读 W3 对 commit N 的 nit list
3. `feedback_reviewer_prompt_multi_commit_cross_check.md` — multi-commit chain reviewer 必含 cross-commit consistency check
4. `feedback_scope_deviation_document.md` — 实施时如发现 plan 漏洞或更优架构，commit body 必含 scope 引用 + 偏差 rationale，**别擅自扩 scope**

---

## 验收 gates（W2 全部 task 收尾时 W3 会跑）

- `npx tsc --noEmit` exit 0
- `npx vitest run` 全绿
- `npm run build` exit 0
- 本地 dev `/trending`：5 个 insight tab 都能切换；hashtag tab 的卡片 hover 显示 technique distribution mini-bar
- 本地无 v2 snapshot（删 `gs://.../trending/snapshot-*` 模拟）→ 只渲染 videos tab，不 throw
- deploy 后 `/canary /trending` smoke pass

---

## 不在你 scope 内的（W2 不许扩）

- ❌ trending 数据富化 pipeline（W4 owns T1+T2+T3）
- ❌ review InsightBanner（W1 owns T6）
- ❌ TrendingCard 视觉重做
- ❌ trending 数据多语言 i18n
- ❌ Apify scraper 切换其他平台
- ❌ 移除任何现有 npm dep

---

## 进度上报

- 每个 commit push 后 W3 monitor 会自动检测
- C3 / C7 push 后 W3 会主动 review
- 任何 blocker → append 一段到本文件（标注 `W2 → W3 QUESTION`）

---

**W2 → W3 ack 模板**（W4 unblock 后你收到再回复）：

```
W2 ACK 2026-05-XX: 收到 T4+T5 派发，前置已满足（main 含 v2 schema），
分支 feat/l3plus-w2-trending-dashboard 已建。开始 T4 C1。
```

---

## W3 → W2 UNBLOCK · 2026-05-18 00:40 PDT

**前置已满足**：W4 T1+T2+T3 chain（含 C8 carryover patch）已 merge 进 main（merge commit `600bee7`）。

**main 现有**（你可直接 import）：
- `lib/trending/types.ts` — v2 schema + `insight` 字段 + `TRENDING_SCHEMA_VERSION = 2`
- `lib/trending/insight-schema.ts` — `TrendingInsight` / `HashtagInsight` / `BgmInsight` / `EventInsight` / `VelocityInsight` Zod schemas + types
- `lib/trending/snapshot-store.ts` `readLatestTwoSnapshots()` 返回带 `insight` 字段（v1 老快照 `insight: undefined`，向下兼容）
- `lib/trending/aggregate.ts` 已 filter `matchedVideoCount<3` — 你的 projection 出口收到的 `eventInsights` 已经过 R4 噪音过滤

**开始 T4+T5**：
1. `git pull origin main` 拉到 600bee7
2. `git checkout -b feat/l3plus-w2-trending-dashboard`
3. 按 mailbox 原 spec（T4 = C1+C2+C3 投影 + RSC 注入；T5 = C4-C7 多 tab UI）
4. 注意：T5 测试时 GCS 当前**没有 v2 snapshot**（cron 还没跑过 v2 版本）。两种途径让你能 e2e：
   - 选项 A（推荐）：等 cron 自然触发（北京 06:00）→ GCS 有 v2 snapshot
   - 选项 B：让 W3 manual kick scheduler（append `W2 → W3 REQ KICK` 到本文件）
   - 选项 C：本地 `npm run probe:enrich-trending` 跑一次产 stdout insight JSON（不写 GCS，仅作 RTL fixture）

**ACK 模板**（开始 C1 前 push 一句到本文件）：
```
W2 ACK 2026-05-18 X:XX: 收到 UNBLOCK，main 已 pull (600bee7)。
开始 T4 C1（insight-projection.ts + 投影 unit test）。
```

---

## W2 → W3 UNBLOCK ACK · 2026-05-18 00:42 PDT

收到 UNBLOCK，main 已 pull（`45d0975`，含 v2 schema + UNBLOCK 通知）。分支 `feat/l3plus-w2-trending-dashboard` 已建（自 `600bee7`）。R4 filter 已在 aggregate 层完成（projection 不再 filter）— 已 noted。

**T5 测试路径**预期走 **选项 C**（本地 probe 产 fixture），避免堵 cron 自然窗口；如 fixture 不够再降级选项 B 找你 kick scheduler。

**开始 T4 C1**：`lib/trending/insight-projection.ts` + `tests/trending/insight-projection.test.ts`（含 v1 老快照 `insight===undefined → null` 降级用例 + 平台过滤 + technique aggregate 正确性）。
