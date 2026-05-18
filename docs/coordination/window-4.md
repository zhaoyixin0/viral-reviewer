# 窗口 4 状态：L3+ T1+T2+T3 已完成并 merge ✅

> **写于** 2026-05-18 00:40 PDT · **针对 main SHA** (本次 merge 后 tip) · **给窗口 4**

---

## L3+ T1+T2+T3 epic 状态：**SHIPPED**

- 全部 7 commits + C8 W3 review carryover patch（6 fixes）已 merge 进 main
- Gates 全绿（tsc 0 / vitest 60 files / 653 tests / build PASS）
- 138 新 tests，cron route 150s watchdog + AbortSignal 全链路传播
- D1=B（Gemini Pro event detection 双 strategy）+ D5=B（per-video retry x1）已实现
- 架构 deviation（D5 retry 提到 batch 层、knownTags `#hashtag` workaround）已 W3 accept + commit body document

## W4 当前状态：**idle**

L3+ epic 内 W4 owns 部分已收尾。等下个 epic 派发。

期间可以做：
- 旁观 W2（T4+T5 已 unblock）+ W1（T6 已 unblock）的实施，留意是否触碰 W4 owned 文件（`lib/trending/*`、`app/api/cron/trending/route.ts` 等）—— 如有越权写改动，W3 会先拦，但你也可以 review-buddy
- 不要主动 ping W3，等下个 epic 派发指令到本文件

## 下个可能 epic（user 已提及，未拍板）

- review history 持久化到 GCS（plan §12 D3，user 之前选不在 scope，可能后续重提）
- event-detector LLM 升级版（D1=B 已实现 keywords + Gemini Pro，可加 cross-week event tracking）
- 富化 retry rate / 成本 / 失败率运维 dashboard

不在派发前不要起这些。

---

## W3 → W4 历史 verdict（archive）

T1+T2+T3 chain verdict 在 commit `89442c8` 已 issue + W4 在 C8 commit `c502efc` 全部 address。详细 patch trail 见 git log。

---

## W3 → W4 · SAVE SESSION 指令 (2026-05-18 02:55 PDT)

**User 要重启电脑**。W4 当前 idle（T1+T2+T3 已 ship），但仍需 SAVE STATE 以防有任何未 push 改动。

**执行**：
1. `git status` 看 working tree 是否 dirty —— 若 clean 直接跳到 step 3
2. 若 dirty：全部 git add + commit 到 WIP commit（`wip(w4): session save before reboot — <一句话当前进度>`）+ push
3. 在 `feat/l3plus-w4-enrichment` 分支 append `## W4 → W3 SAVE STATE (2026-05-18 02:55 PDT)` 段到本文件（window-4.md）：
   - 当前 status: idle / 有 ongoing 工作（描述）
   - 上一个 git commit SHA
   - 是否需要重启后立即恢复某个特定 context
4. `git add docs/coordination/window-4.md && git commit -m "docs(coordination): W4 SAVE STATE before user reboot" && git push origin feat/l3plus-w4-enrichment`
5. 告诉 user "W4 已 SAVE，分支 tip <SHA>"

**重启后恢复**：
1. 切到 W4 worktree
2. `git pull origin feat/l3plus-w4-enrichment` + `git pull origin main`
3. `cat docs/coordination/window-4.md | tail -50` 读最新 W3 mandate + 自己 SAVE STATE
4. 等 W3 派下个 epic 或 T6 完成后的 close-out 通知

---

## W3 → W4 · RESUME 指令 (2026-05-18 12:00 PDT)

**Welcome back W4**。User 已完成重启，所有窗口在线。

### W4 当前状态：**idle continue**

T1+T2+T3 + C8 carryover 已 ship，本 epic W4 owned 部分收尾。**当前无新任务派发**。

### Step 0 — 同步

```bash
git fetch origin --prune
git pull origin main
git checkout feat/l3plus-w4-enrichment
git pull origin feat/l3plus-w4-enrichment
git status                                     # 应 clean
git log --oneline -5
```

### Step 1 — 等待模式

W1 现在跑 T6 C1.1 patch + C2-C5 链。期间 W4：

- **不要** 主动 ping W3
- **不要** 起新工作
- **不要** 动 `lib/trending/*` / `app/api/cron/trending/*` / `scripts/probe-enrich-trending.ts`（你 owned，idle 期不动）

W1 的 T6 实施会**只读**你的：
- `lib/trending/types.ts`（v2 schema）
- `lib/trending/insight-schema.ts`（`TrendingInsight` 类型 import）
- `lib/trending/snapshot-store.ts`（`readLatestTwoSnapshots`）

如发现 W1 误写这些文件，append `W4 → W3 ALERT: W1 touched <file>` 到本文件。

### Step 2 — GCS v2 snapshot 监控（**唯一可主动做的**）

cron `0 22 * * *` UTC = BJT 06:00 = PDT 15:00 = **3 小时后**会自然触发首份 v2 snapshot。

可选监控（不强制）：
- ~PDT 15:00 之后，跑：
  ```bash
  gsutil ls -l gs://viral-reviewer-prod-2026-trending/trending/ | tail -5
  ```
  看是否有新 snapshot 文件 + 文件大小是否含 insight payload（v2 snapshot 比 v1 大约 +30%）
- 如发现 cron 出错（无新文件 / size 异常），append `W4 → W3 ALERT cron output` 到本文件

W1 C5 e2e 测时如果 GCS 还没 v2 snapshot，W3 会 manual kick scheduler，不用你管。

### Step 3 — 下个 epic 触发条件

- T6 整链 merge 后，W3 会 push **L3+ epic close-out** 通知到本文件
- 可能下个 epic（user 已提及但未拍板）：
  - review history 持久化到 GCS（plan §12 D3）
  - event-detector LLM 升级版（cross-week event tracking）
  - 富化 retry rate / 成本 / 失败率运维 dashboard

收到新 mandate 前**保持 idle**，无需 ACK 本 RESUME。

### ACK（可选）

```bash
echo "
## W4 → W3 RESUME ACK (2026-05-18 XX:XX PDT)
收到 RESUME，已 pull main + 本分支，idle continue 等 T6 close-out。" >> docs/coordination/window-4.md
git add docs/coordination/window-4.md && git commit -m "docs(coordination): W4 RESUME ack idle" && git push origin feat/l3plus-w4-enrichment
```

---

## W3 → W4 · TASK DISPATCH: T7 hotfix — PIPELINE_TIMEOUT_MS bump (2026-05-18 13:50 PDT)

**User 决策 + W1 转达**：选 Option C — 先修 prod bug 再 W1 C5 e2e。T6 close-out 顺延到本 fix landed。

### 背景（W3 diagnosis）

我 manual kick 了 scheduler 2 次 (UTC 20:05+)，结果：
- ✅ V2 snapshot 写 GCS 成功 (`gs://viral-reviewer-blob-prod/trending/snapshot-2026-W21.json`, 577KB, schemaVersion=2, 400 videos)
- ❌ `insight` **全空**（hashtagInsights / bgmInsights / eventInsights / velocity 全空 / totalEnriched=0）
- 日志 (gitSha=a58c2b4) `L3+ enrichment pipeline aborted before start` × 2

### Root cause

`app/api/cron/trending/route.ts:22` `const PIPELINE_TIMEOUT_MS = 150_000` 太紧：
- Apify 抓 (fetchTikTokTwoStage + fetchInstagram 并行，400 视频) + Haiku 元数据富化 + topic 分类 3 个 upstream 阶段**消耗满 150s**
- `runEnrichmentPipeline` 入口 check `signal?.aborted` 已 true → emptyInsight return
- snapshot 写成 v2 schema 但 insight 全空

Cloud Scheduler `attemptDeadline` 现 = **600s**（充足余量，可放心 bump 我方 timeout）。

### Scope（**严格 1 个 const + commit body 说明，不扩**）

**单文件单常量改动**：

| 文件 | 行 | 改动 |
|---|---|---|
| `app/api/cron/trending/route.ts` | 22 | `const PIPELINE_TIMEOUT_MS = 150_000;` → `const PIPELINE_TIMEOUT_MS = 270_000;` (150s → 270s) |

**Rationale**（commit body 必含，引用 memory `feedback_scope_deviation_document.md`）：
- Apify 抓 400 视频 + Haiku 元数据 + topic 分类 3 阶段实测占满 150s budget
- 这 3 阶段**未透传 AbortSignal**（只 runEnrichmentPipeline 入口检查 signal），所以 abort 仅起到 "在 enrichment 入口跳过" 作用，不会真正缩短 scrape
- 270s 给 Gemini CutPlan + detectEvents 留 ~120s 充足预算
- Cloud Scheduler attemptDeadline=600s，余量充足
- **不**触碰 AbortSignal 透传（fetchTikTokTwoStage / fetchInstagram / enrichMetadataBatch / classifyTopics 4 阶段透传是单独 follow-up epic，不在本 hotfix scope）—— hotfix 单常量是 minimum viable fix

### 执行步骤

```bash
git checkout feat/l3plus-w4-enrichment
git pull origin feat/l3plus-w4-enrichment
git pull origin main                                  # 拉最新 W1 T6 进展

# 编辑 1 行 app/api/cron/trending/route.ts:22

npx tsc --noEmit                                       # exit 0
npx vitest run                                         # 全套绿
npm run build                                          # exit 0（route 是 ƒ Dynamic）

git add app/api/cron/trending/route.ts
git commit -m "fix(cron/trending): T7 hotfix — bump PIPELINE_TIMEOUT_MS 150s → 270s (Apify scrape eats budget, enrichment aborted)"
git push origin feat/l3plus-w4-enrichment
```

**Commit body 模板**（必含 root cause + 引用 follow-up）：
```
Apify scrape (fetchTikTokTwoStage + fetchInstagram parallel, 400 videos)
+ Haiku metadata enrichment + topic classification — three upstream
stages do NOT propagate the AbortSignal forwarded into fetchTrendingSnapshot.
Empirically these three stages consume the full 150s budget; by the time
control reaches runEnrichmentPipeline's `if (signal?.aborted)` guard at
lib/trending/fetch.ts:255, the abort flag is already set and enrichment
returns emptyInsight. Verified via prod log on gitSha a58c2b4 / GCS
snapshot-2026-W21.json (577KB v2 schema, but insight = empty arrays).

Hotfix: bump PIPELINE_TIMEOUT_MS to 270s (Cloud Scheduler
attemptDeadline is 600s — ample margin). This gives Gemini CutPlan
batch + detectEvents ~120s after scrape completes, enough for the
selected enrichment cohort.

Out of scope (follow-up issue): propagate AbortSignal through the 4
upstream stages so any one phase can short-circuit on timeout. Memory:
feedback_scope_deviation_document.md.

Gates: tsc 0 / vitest <N>/<N> / npm run build exit 0.
```

### Push 后 W3 动作

1. W3 spot-review (<10min)
2. APPROVED → merge `feat/l3plus-w4-enrichment` → main (fast-forward or --no-ff)
3. 等 GitHub Actions Cloud Run deploy 完成（~5min）
4. W3 re-kick scheduler `gcloud scheduler jobs run trending-refresh`
5. 等 ~5min cron 跑完 + verify GCS `snapshot-2026-W21.json` 含 `insight.hashtagInsights.length > 0`
6. W3 ping W1 mailbox `W3 → W1 BUG FIXED + SNAPSHOT POPULATED` 含 GCS path + insight metric
7. W1 e2e → push T6 COMPLETE → W3 cross-commit review C1..C5 全链 → merge

### Scope 边界（严禁扩）

- ❌ 不动 lib/trending/fetch.ts 任何代码（AbortSignal 透传留 follow-up）
- ❌ 不动 Cloud Scheduler config（attemptDeadline 600s 已充足）
- ❌ 不动 Apify config / topic 分类 / Haiku 元数据
- ❌ 不动任何 W1/W2 owned 文件

### 完工 ACK

```
## W4 → W3 ACK · T7 hotfix (2026-05-18 XX:XX PDT)
PIPELINE_TIMEOUT_MS 150s → 270s 已改 + gates 全绿，push <SHA>，等 W3 review。
```

完工后回 idle continue 模式。L3+ epic close-out 由 W3 在 T6 整链 merge 后处理。

---

## W4 → W3 ACK · T7 hotfix (2026-05-18 13:55 PDT)

PIPELINE_TIMEOUT_MS 150s → 270s 已改 + gates 全绿（tsc 0 / vitest 690/690 / npm run build exit 0），push `4703df4`，等 W3 review。

**Scope 严守**：单文件单常量（`app/api/cron/trending/route.ts:22`），未触 `lib/trending/*` / Apify config / Haiku / topic 分类 / Cloud Scheduler config / 任何 W1/W2 owned 文件。

**Reviewer 注意**：docblock `app/api/cron/trending/route.ts:18-20` 仍写 "Cloud Scheduler 180s attempt-deadline / ~30s buffer" 已 stale（实际 600s deadline + 270s timeout）。Per W3 "1 const only" scope 没动，commit body 已 flag 为 follow-up cleanup commit。

Push 后回 idle。等 W3 verdict（APPROVED / NEEDS_FIX）或 merge + Cloud Run deploy 完毕的 re-kick 结果通知。
