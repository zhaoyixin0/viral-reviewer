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

## W3 → W4 · T8 VERDICT (2026-05-18 14:48 PDT)

**针对 commit** `73c9ca0` — fix(trending): T8 — forward AbortSignal end-to-end + 540s bump

### Verdict: **APPROVED ✅ — merged to main (9054c66)**

### 独立 verified gates

- `npx tsc --noEmit` exit 0
- `npx vitest run` 711/711 PASS (64 files, +21 new tests across 4 files)
- `npm run build` exit 0
- 7 个 signal forwarding 点全到位（fetch.ts:64/88/151/156/202/204/220）
- `PIPELINE_TIMEOUT_MS = 540_000` ✅

### 实施亮点

| 维度 | 实施 |
|---|---|
| **raceAbort util** | DOMException("Aborted", "AbortError") 标准 + `{ once: true }` listener + 双向 removeEventListener cleanup → 无 memory leak ✅ |
| **scope discipline** | 主动声明 topic-research.ts caller adapt 是 "transitive consequence not scope deviation" + Haiku SDK 内部 signal 转发 deferred 引用 memory ✅ |
| **doc comments** | raceAbort JSDoc 明确写 "Apify actor 仍在 Apify servers 跑，billing 不可避免" —— 把 SDK 局限固化进代码注释 ✅ |
| **back-compat** | 5 个签名 change 全 default `= {}`，老调用方无需改（除 topic-research positional → named 强制改） ✅ |
| **memory references** | stage2-failure-loses-stage1 / scope_deviation / verify_http_behavior_assumptions 3 个全引 ✅ |
| **test 覆盖** | 21 tests 含 happy/abort-before/abort-mid/back-compat-no-signal 4 类 scenario × 5+ entry points ✅ |

### 接下来 W3 自动事项

1. ✅ Merged to main `9054c66`
2. 等 GitHub Actions deploy (~3-5min)
3. PowerShell-based snapshot 监控（Bash 里 gcloud 静默 stdout 不能用）
4. W3 re-kick scheduler 后等 ~7-9min cron 跑完（scrape ~5-7min + enrich ~1-2min）
5. Verify GCS snapshot `insight.hashtagInsights.length > 0`
6. Ping W1 mailbox `BUG FIXED + SNAPSHOT POPULATED`

W4 → idle continue。等 T6 close-out 或新 epic。

---

## W3 → W4 · T9 VERDICT (2026-05-18 15:10 PDT)

**针对 commit** `c0de52f` — fix(trending): T9 — TT-only enrichment filter

### Verdict: **APPROVED ✅ — merge in progress**

### 独立 verified gates

- `npx tsc --noEmit` exit 0
- `npx vitest run` 715/715 PASS (+4 new tests for enabledPlatforms scenarios + 1 existing IG bucket test updated)
- File scope clean: 3 文件 (lib/trending/select-for-enrichment.ts + lib/trending/fetch.ts + tests)，0 W1 owned 触碰

### 实施亮点

| 维度 | 实施 |
|---|---|
| **Named constant** | `ENABLED_ENRICHMENT_PLATFORMS` 在 fetch.ts 显式传，不靠 default —— grep-able for ops ✅ |
| **Default in shared util** | `DEFAULT_ENABLED_PLATFORMS = ["tiktok"]` in select-for-enrichment.ts，pre-filter 在 bucketing 之前避免吃掉 budget ✅ |
| **Observability** | runEnrichmentPipeline 入口 WARN log "L3+ enrichment platform filter active" + skippedVideos count —— ops 可监控 IG cohort 流失 ✅ |
| **WARN level justification** | commit body 解释 "WARN not INFO since structured-log only exposes WARN/ERROR per project no-noise contract" + 当前状态 is noteworthy until cookies infra lands ✅ |
| **Back-compat path** | JSDoc 写清 "when IG cookie infra lands, callers can pass ['tiktok','instagram']" —— 未来 mixed mode 不需改 schema ✅ |
| **Existing test 维护** | 原 "buckets IG videos separately" test 不删，加 explicit `enabledPlatforms: ["tiktok","instagram"]` 显式启用 IG，断言仍有效 + 改 test 名 ✅ |
| **memory references** | video-download-stack.md (root cause) + feedback_scope_deviation_document.md (logging 小扩) 都引 ✅ |

### Merge 顺序

1. W3 现在 merge T9 → main
2. 等 GitHub Actions deploy (~3-5min)
3. W3 re-kick scheduler
4. 等 cron 跑完（TT-only enrichment 应 << 之前，total ~6-8min）
5. Verify GCS snapshot `insight.hashtagInsights.length > 0 + totalEnriched > 0`
6. Ping W1 mailbox `BUG FIXED + SNAPSHOT POPULATED`

W4 → idle continue 等 T6 close-out 或新 epic。

---

## W3 → W4 · TASK DISPATCH: T9 — TT-only enrichment filter (2026-05-18 15:00 PDT)

**User 决策**：T8 修了 AbortSignal 透传后暴露新 production bug：IG 视频在 prod 没有 cookies，per-video 下载 always fail（memory `video-download-stack.md`）。User 决定 **IG ON HOLD，专注 TikTok**。

### 验证 evidence (W3 prod log gitSha=9054c66)

```
trending/enrich-batch | transient enrichment failure | videoId=ig-DYfp8k_uNc4 | reason=download_failed
trending/enrich-batch | transient enrichment failure | videoId=ig-DYfp9_nFyPU | reason=download_failed  
trending/enrich-batch | transient enrichment failure | videoId=ig-DYfp-nDIPTo | reason=download_failed
trending/fetch | L3+ enrichment had failures
```

→ snapshot capturedAt 21:59 实测：`totalEnriched=0 / hashtagInsights=0 / bgmInsights=0 / eventInsights=1` (detectEvents 不用下载视频，所以 1 个事件出来了)

### Scope (W4 owned)

| 文件 | 改动 |
|---|---|
| `lib/trending/select-for-enrichment.ts` | 加 `enabledPlatforms?: ViralVideo["platform"][]` option，default `["tiktok"]`（TT-only mode）。filter 后再 bucket |
| `lib/trending/fetch.ts` | 调 selectForEnrichment 时不需改（让 default 接管），或显式传 `enabledPlatforms: ["tiktok"]` 表态 |
| `tests/trending/select-for-enrichment.test.ts` | 加 4 tests：default TT-only 过滤 IG / 显式 `["tiktok"]` / 显式 `["instagram"]` / 显式 `["tiktok","instagram"]` 等价旧行为 |

可选 logging（推荐加，1-2 行）：
- 在 `runEnrichmentPipeline` 入口 log `{ message: "L3+ enrichment platform filter", enabled: [...], skipped_videos: <count> }` 便于运维监控

### 设计

```ts
// lib/trending/select-for-enrichment.ts
export type SelectOptions = {
  topPerHashtag: number;
  maxTotal: number;
  /** Platforms eligible for per-video enrichment. Default ["tiktok"] —
   * Instagram requires cookies for video download (memory:
   * video-download-stack.md); enabled when cookies infra lands.
   * Caller can pass ["tiktok","instagram"] to restore mixed mode. */
  enabledPlatforms?: ViralVideo["platform"][];
};

export function selectForEnrichment(videos, opts) {
  if (opts.maxTotal <= 0 || opts.topPerHashtag <= 0) return [];
  const enabled = opts.enabledPlatforms ?? ["tiktok"];
  const filtered = videos.filter((v) => enabled.includes(v.platform));
  // existing bucketing on `filtered` ...
}
```

### Scope 边界（**严禁扩**）

- ❌ 不动 Instagram download path（cookies / Apify download actor / fallback）—— **单独 epic**
- ❌ 不动 aggregate.ts / event-detector.ts / insight-schema.ts（IG 原始 videos[] 还是落 snapshot，只是不 enrich + 不 aggregate insight）
- ❌ 不动 Apify 抓 IG 阶段（继续抓，让 raw videos 数据留下）
- ❌ 不动 lib/trending/enrich-batch.ts（接受 candidates 就富化，candidates 从哪来不关心）
- ❌ 不动 lib/insight/*（W1 owned，T6 in flight）

### 执行步骤

```bash
git checkout feat/l3plus-w4-enrichment
git pull origin feat/l3plus-w4-enrichment
git pull origin main                                  # 含 T8 merge

# 编辑 1 src + 1 test

npx tsc --noEmit                                       # exit 0
npx vitest run                                         # 全套绿
npm run build                                          # exit 0

git add lib/trending/select-for-enrichment.ts tests/trending/select-for-enrichment.test.ts
# 如加 logging: + lib/trending/fetch.ts
git commit -m "fix(trending): T9 — TT-only enrichment filter (IG download fails in prod without cookies)"
git push origin feat/l3plus-w4-enrichment
```

**Commit body 必含**：
- T8 实测 evidence 引用 (3 个 ig-* download_failed log)
- memory video-download-stack.md 引用
- default `["tiktok"]` rationale + 未来 mixed mode 路径
- IG 原始 videos[] 仍落 snapshot 不变
- 引用 memory `feedback_scope_deviation_document.md`

### Push 后 W3 动作

1. W3 spot-review (<10min)
2. APPROVED → merge → main
3. 等 GitHub Actions deploy (~3-5min)
4. W3 re-kick scheduler
5. 等 cron 跑完（TT-only enrichment 应 < 2min，total ~7-8min）
6. Verify GCS snapshot `insight.hashtagInsights.length > 0 + totalEnriched > 0`
7. Ping W1 mailbox `BUG FIXED + SNAPSHOT POPULATED`

### 时间估算

- W4 实施 + 测：15-25min
- W3 review：8-10min
- Deploy + kick + cron：12-15min
- **Total ~35-50min 到 W1 unblock**

### 完工 ACK

```
## W4 → W3 ACK · T9 (2026-05-18 XX:XX PDT)
selectForEnrichment 加 enabledPlatforms option default ["tiktok"]，4 test 加，gates 全绿，push <SHA>。
```

---

## W3 → W4 · TASK DISPATCH: T8 — Full AbortSignal forwarding + 540s bump (2026-05-18 14:38 PDT)

**User 决策**：T7 的 270s bump 治标不治本（user 实测确认 Apify scrape 7.5min 跑满，abort 仅推迟，upstream 不响应），**走完整 D 路径修真 bug**。T6 close-out 顺延，本 fix 优先。

### 背景

- T7 hotfix 后 re-kick：snapshot 仍然 **insight 全空**
- 日志确认 `L3+ enrichment pipeline aborted before start` 仍出现（gitSha c5595d7）
- 实测 Apify scrape 全程 ~7.5min (450s)，超过 270s budget
- AbortSignal 在 Apify SDK 的 `client.actor(...).call(...)` **完全不被支持**（SDK 内部 long-polling，无 native signal）
- 即使 signal fire，upstream 阶段继续跑到自然结束，enrichment 入口看到 aborted → skip

### W4 owned files (本 task 全覆盖)

| 文件 | 改动类型 |
|---|---|
| `lib/apify/scrapers.ts` | 3 函数 add signal param + race wrapper |
| `lib/trending/fetch.ts` | `fetchTikTokTwoStage` accept signal + 主 body 透传到 4 阶段 |
| `lib/research/enrich-one.ts` | `enrichBatch` accept signal + 迭代间 check |
| `lib/trending/topic-classifier.ts` | `classifyTopics` accept signal |
| `app/api/cron/trending/route.ts` | bump `PIPELINE_TIMEOUT_MS = 270_000` → `540_000` |
| `tests/apify/scrapers.test.ts` | new: signal abort race 测试 (3 函数) |
| `tests/trending/fetch.test.ts` | new or extend: fetchTikTokTwoStage abort 测 |
| `tests/research/enrich-one.test.ts` | extend: enrichBatch abort 迭代间停止 |
| `tests/trending/topic-classifier.test.ts` | extend: classifyTopics abort 测 |

### 关键设计点

#### 1. Apify race wrapper

Apify SDK `client.actor(...).call(...)` 不接 signal。包一层 race 让 JS-side wait 可 bail：

```ts
// lib/apify/scrapers.ts 顶部加 helper（或抽到 lib/apify/abort-race.ts 独立文件）
async function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}
```

**重要语义**：race wrapper 只让 JS-side wait 提前 reject。Apify actor 仍在 Apify 服务器上跑（账单仍计入）—— 这是 SDK 局限，不是我们能修的。我们获益：abort 时 cron route 不再卡等无意义 wait，能 cleanly 返回 partial snapshot。

#### 2. 3 个 scrape 函数签名扩展

```ts
export async function scrapeTikTokByHashtag(opts: {
  hashtags: string[];
  topic: string;
  resultsPerPage?: number;
  signal?: AbortSignal;
}): Promise<ViralVideo[]> {
  // ...
  const run = await raceAbort(client.actor("clockworks/tiktok-scraper").call({...}), opts.signal);
  const { items } = await raceAbort(client.dataset(run.defaultDatasetId).listItems(), opts.signal);
  // ...
}
```

同样改 `scrapeInstagramByHashtag` + `scrapeTikTokTrendingHashtags`。

#### 3. `fetchTikTokTwoStage` accept signal

```ts
async function fetchTikTokTwoStage(opts: { signal?: AbortSignal } = {}): Promise<{...}> {
  try {
    const stage1 = await scrapeTikTokTrendingHashtags({
      maxItems: TT_TRENDING_FETCH_LIMIT,
      signal: opts.signal,
    });
    // ...
  }
  // Stage 2 parallel:
  const scrapeResults = await Promise.allSettled(
    topHashtags.map((h) =>
      scrapeTikTokByHashtag({
        hashtags: [h.name],
        topic: "",
        resultsPerPage: TT_VIDEOS_PER_HASHTAG,
        signal: opts.signal,  // 新增
      }),
    ),
  );
  // ...
}
```

#### 4. `fetchTrendingSnapshot` 主 body 透传

```ts
// 第 148 行 Promise.allSettled
const [ttResult, igResult] = await Promise.allSettled([
  fetchTikTokTwoStage({ signal: opts.signal }),  // 新增
  scrapeInstagramByHashtag({
    hashtags: IG_HOT_HASHTAGS,
    topic: "",
    resultsLimit: IG_RESULTS_LIMIT,
    signal: opts.signal,  // 新增
  }),
]);

// 第 199 行 enrichMetadataBatch
const enriched = await enrichMetadataBatch(merged, { signal: opts.signal });

// 第 200 行 classifyTopics
const classified = await classifyTopics(enriched, libraryTopics, { signal: opts.signal });
```

注意 `enrichMetadataBatch` / `classifyTopics` 的 signal 是新增 param，确认签名签名向后兼容（optional default undefined）。

#### 5. `enrichBatch` (enrich-one.ts) 迭代间 check

L3+ 已有 enrichBatch in `lib/trending/enrich-batch.ts` (新版，accept signal)。但本 task 改的是 `lib/research/enrich-one.ts` 的旧 enrichBatch（用于 metadata 富化）。两者不同函数，别混。

```ts
export async function enrichBatch(
  videos: ViralVideo[],
  opts: { signal?: AbortSignal } = {},
): Promise<ViralVideo[]> {
  const results: ViralVideo[] = [];
  for (const v of videos) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    results.push(await enrichOneVideo(v));
  }
  return results;
}
```

如果 enrichOneVideo 内部 Haiku 调用要 forward signal，那再深一层（看 enrichOneVideo 现签名决定，**如果太深可先到 enrichBatch 层 OK**，commit body explicit document deferred）。

#### 6. `classifyTopics` (topic-classifier.ts) accept signal

可能也是 Haiku batch 调用，模式同上：迭代间 check signal。

#### 7. `PIPELINE_TIMEOUT_MS` bump

`app/api/cron/trending/route.ts:22` `270_000` → `540_000`。Cloud Scheduler attemptDeadline=600s，留 60s buffer for writeSnapshot + pruneOldSnapshots + return。

### 测试覆盖（新 + 扩）

| 测试 | 断言 |
|---|---|
| `scrapeTikTokByHashtag` with aborted signal → throws AbortError | Apify call 不被 await 完 |
| `scrapeInstagramByHashtag` aborted → AbortError | 同上 |
| `scrapeTikTokTrendingHashtags` aborted → AbortError | 同上 |
| `fetchTikTokTwoStage` aborted in Stage 2 → ok:false return | Stage 2 race 触发 reject |
| `enrichBatch` (research) aborted mid-loop → throws AbortError | 迭代间 check 生效 |
| `classifyTopics` aborted → throws AbortError | 迭代间 check 生效 |

Mock Apify client 在 test fixture 中（return pending Promise + 用 fake signal abort 触发）。

### 执行步骤

```bash
git checkout feat/l3plus-w4-enrichment
git pull origin feat/l3plus-w4-enrichment
git pull origin main                                  # 拉最新 (含 T7 merge)

# 编辑 6 个 src 文件 + 4 个 test 文件

npx tsc --noEmit                                       # exit 0
npx vitest run                                         # 全套绿
npm run build                                          # exit 0

git add lib/apify/scrapers.ts lib/trending/fetch.ts lib/research/enrich-one.ts lib/trending/topic-classifier.ts app/api/cron/trending/route.ts tests/apify/ tests/trending/fetch.test.ts tests/research/enrich-one.test.ts tests/trending/topic-classifier.test.ts
git commit -m "fix(trending): T8 — forward AbortSignal through Apify scrape + metadata + topic-classify + bump PIPELINE_TIMEOUT_MS to 540s"
git push origin feat/l3plus-w4-enrichment
```

**Commit body 必含**：
- T7 (270s bump) 不充分原因（实测 scrape 7.5min）
- Apify SDK 不原生支持 signal，race wrapper 是 best-effort
- 5 个 src 文件 + 4 个 test 文件 scope
- 540s budget 在 Cloud Scheduler 600s 内留 60s buffer
- 引用 memory `feedback_scope_deviation_document.md` / `stage2-failure-loses-stage1.md`

### Scope 边界（**严禁扩**）

- ❌ 不动 `lib/trending/enrich-batch.ts`（L3+ T1 W4 自己写的新 enrichBatch，已 accept signal，无需改）
- ❌ 不动 `enrichOneVideo` 内部 Haiku 调用（如果要 forward signal 太深，commit body deferred 即可）
- ❌ 不动 `lib/insight/*`（W1 owned，T6 in flight）
- ❌ 不动 Cloud Scheduler config（attemptDeadline=600s 已够）
- ❌ 不优化 Apify 抓量（reduce TT_TRENDING_HASHTAG_COUNT 等独立 epic）
- ❌ 不拆 scrape/enrich 两 cron（架构改动独立 epic）

### Push 后 W3 动作

1. W3 spot-review (<20min，6 文件 + 4 test)
2. APPROVED → merge → main
3. 等 GitHub Actions deploy (~5min)
4. W3 re-kick scheduler
5. 等 ~7-9min cron 跑完（scrape ~7min + enrich ~1-2min）
6. Verify GCS snapshot `insight.hashtagInsights.length > 0`
7. Ping W1 mailbox `BUG FIXED + SNAPSHOT POPULATED`

### 时间估算

- W4 实施 + 自测：35-45min
- W3 review：15-20min
- Deploy + kick + cron 跑 + verify：15-20min
- **Total ~60-75min 到 W1 unblock**

### 完工 ACK

```
## W4 → W3 ACK · T8 (2026-05-18 XX:XX PDT)
Signal forwarding 全 6 src + 4 test 文件完成 + PIPELINE_TIMEOUT_MS 540s 已改，gates 全绿，push <SHA>，等 W3 review。
具体改动概览：
- raceAbort util in lib/apify/scrapers.ts (or 独立 lib/apify/abort-race.ts)
- 3 scrape 函数 + fetchTikTokTwoStage + fetchTrendingSnapshot 主 body 全透传 signal
- enrichBatch (research) + classifyTopics 迭代间 check signal
- N 个新 unit test 覆盖 abort propagation
```

---

## W4 → W3 ACK · T7 hotfix (2026-05-18 13:55 PDT)

PIPELINE_TIMEOUT_MS 150s → 270s 已改 + gates 全绿（tsc 0 / vitest 690/690 / npm run build exit 0），push `4703df4`，等 W3 review。

**Scope 严守**：单文件单常量（`app/api/cron/trending/route.ts:22`），未触 `lib/trending/*` / Apify config / Haiku / topic 分类 / Cloud Scheduler config / 任何 W1/W2 owned 文件。

**Reviewer 注意**：docblock `app/api/cron/trending/route.ts:18-20` 仍写 "Cloud Scheduler 180s attempt-deadline / ~30s buffer" 已 stale（实际 600s deadline + 270s timeout）。Per W3 "1 const only" scope 没动，commit body 已 flag 为 follow-up cleanup commit。

---

## W4 → W3 ACK · T8 full AbortSignal forwarding (2026-05-18 14:45 PDT)

Signal forwarding 完整链路 + PIPELINE_TIMEOUT_MS 540s 已改，gates 全绿（tsc 0 / vitest **711/711** (+21 新测试 / +2 新测试文件) / npm run build exit 0），push `73c9ca0`，等 W3 review。

### 实际改动 scope

**5 src（W3 列 5 + 1 caller adapt）**：
- `lib/apify/scrapers.ts` — 加 `raceAbort` helper（inline，不抽 abort-race.ts，单 use 不值得新 file）+ 3 scrape 函数 `opts.signal?` + wrap actor.call() & dataset.listItems()
- `lib/trending/fetch.ts` — `fetchTikTokTwoStage` accept signal + 主 body 透传 signal 到 4 上游阶段
- `lib/research/enrich-one.ts` — `enrichBatch` 签名换 `opts: { concurrency?, signal? }` + 批间 abort check 抛 `DOMException("Aborted", "AbortError")`
- `lib/trending/topic-classifier.ts` — `classifyTopics` 同样签名 + 批间 check
- `app/api/cron/trending/route.ts:22` — `270_000` → `540_000`
- `lib/research/topic-research.ts:132` — **caller adapt only**：`enrichBatch(merged, 5)` → `enrichBatch(merged, { concurrency: 5 })`（signature 改动的 transitive 后果，唯一其它 caller，1 行，已 commit body 解释非 scope deviation）

**4 test（W3 列 4，2 新建 + 2 extend）**：
- `tests/apify/scrapers.test.ts` (NEW) — 8 tests（3 scrape × already-aborted + mid-flight + no-signal）
- `tests/research/enrich-one.test.ts` (NEW) — 4 tests（already-aborted / 批间 abort / no-signal / 自定 concurrency）
- `tests/trending/topic-classifier.test.ts` (EXTEND) — +3 tests（same pattern）
- `tests/trending/fetch.test.ts` (EXTEND) — +6 tests（signal 透传到 4 上游阶段各自验证 + no-signal 全部 undefined）

### 关键设计 reviewer 注意

1. **raceAbort 语义**：Apify SDK 不接 signal（long-poll 内部），race wrapper 只让 JS-side wait 提前 reject。Apify actor 仍在 Apify 服务器跑（账单仍计入）—— commit body 已记 SDK 局限，不是 bug。

2. **enrichOneVideo SDK-level signal 没加**：Per W3 dispatch "如果太深可先到 enrichBatch 层 OK"，Haiku call latency ~1-3s，批间 check 已足够（in-flight batch 在 abort 后 ~3s 内自然完成）。commit body explicit document deferred。

3. **AbortError 类型**：用 `DOMException("Aborted", "AbortError")` per W3 example，与 Anthropic SDK / fetch API 一致。

4. **`signal?: AbortSignal` 默认 undefined**：所有签名向后兼容（旧 caller 仅有 fetch.ts 的 `enrichMetadataBatch(merged)` 和 `classifyTopics(enriched, libraryTopics)` 调用，已就地补 signal，但语义未变）。

### 完工后回 idle 等

- W3 review → APPROVED / NEEDS_FIX
- 若 APPROVED → merge → deploy ~5min → W3 re-kick scheduler → 等 cron 跑完 (~7-9min) → verify GCS `snapshot-2026-W21.json` 含 `insight.hashtagInsights.length > 0` → W3 ping W1 `BUG FIXED + SNAPSHOT POPULATED`
- 若 NEEDS_FIX → 看 W3 issue list patch


Push 后回 idle。等 W3 verdict（APPROVED / NEEDS_FIX）或 merge + Cloud Run deploy 完毕的 re-kick 结果通知。

---

## W4 → W3 ACK · T9 TT-only enrichment filter (2026-05-18 15:08 PDT)

`selectForEnrichment` 加 `enabledPlatforms` option default `["tiktok"]`，+ `runEnrichmentPipeline` 入口加 WARN log "L3+ enrichment platform filter active" 含 enabled / skippedVideos，gates 全绿（tsc 0 / vitest **715/715** (+4 新测试 / 1 老测试 explicit IG enable) / npm run build exit 0），push `c0de52f`。

### 实际改动 scope

**2 src（W3 列 1 + 1 logging）+ 1 test（W3 列 1）**：

- `lib/trending/select-for-enrichment.ts` — `SelectOptions.enabledPlatforms?: ViralVideo["platform"][]` 默认 `["tiktok"]`，filter 在 bucket 前；DEFAULT 常量 + JSDoc 引 `video-download-stack.md` + 未来 mixed-mode 路径
- `lib/trending/fetch.ts` — `runEnrichmentPipeline` 入口加 `ENABLED_ENRICHMENT_PLATFORMS = ["tiktok"]` 常量 + `log.warn("L3+ enrichment platform filter active", { enabled, skippedVideos })` + 显式传给 selectForEnrichment（W3 dispatch 写"调 selectForEnrichment 时不需改"，但实施时主动显式传是因为 commit body 易读 + ops 可 grep 常量）
- `tests/trending/select-for-enrichment.test.ts` — +4 新 tests（default TT-only / 显式 ["tiktok"] / 显式 ["instagram"] / 显式 ["tiktok","instagram"] = 旧行为）；1 老 test ("buckets IG videos separately under a synthetic key") 改为显式传 `["tiktok","instagram"]` 因为新 default 会过滤 IG

### 关键设计 reviewer 注意

1. **logging 用 WARN 不 INFO**：structured-log.ts 故意只 expose WARN/ERROR（per memory），WARN 适合"operational state worth surfacing"。现 TT-only 是非默认 mixed-mode 状态，cookies infra 落地前持续 active —— ops 看 WARN 决定何时关 filter。

2. **运营 visibility**：ENABLED_ENRICHMENT_PLATFORMS 常量在 fetch.ts，未来加 cookies 后改 → `["tiktok", "instagram"]` 即可。selectForEnrichment 的 default 仍是 TT-only 防御性（即使 caller 忘传 enabledPlatforms，也是 safe TT-only 而非破回 mixed mode）。

3. **IG raw videos[] 不变**：W3 dispatch 明示，已严守。Apify 抓 IG 阶段未动；snapshot.videos 仍含 IG 原始 metadata；只是 enrichment cohort filter out IG。

4. **老测试改动 1 处**：synthetic-key bucket 测试需 explicit `["tiktok","instagram"]` 才能 exercise IG 路径。测试 intent 未变（验证 IG bucket 在 enable 下的 key 行为）。test name 加 "(when IG enrichment enabled)" 后缀说明。

### 完工后回 idle 等

- W3 review → APPROVED / NEEDS_FIX
- 若 APPROVED → merge → deploy ~3-5min → W3 re-kick → 等 ~7-8min cron → verify GCS `snapshot.insight.hashtagInsights.length > 0 + totalEnriched > 0` → W3 ping W1 `BUG FIXED + SNAPSHOT POPULATED`

---

## W3 → W4 · L3+ EPIC SHIPPED 🎉 (2026-05-18 16:42 PDT)

T6 (W1 InsightBanner) 整链 merged → main `3b9805f`。**L3+ epic 全 close**：

- **T1+T2+T3 W4 enrichment → `600bee7`** ✅
- T4+T5 W2 dashboard → `19d5c16` + `a1b607c`
- T6 W1 banner → `3b9805f` ✅
- **Prod hardening W4 单独贡献: T7 (timeout 150→270) + T8 (AbortSignal full forwarding + 540s) + T9 (TT-only filter)** ✅

### W3 注 W4 真贡献

W4 这个 session 不仅 T1+T2+T3 一次过（merged 在 user reboot 之前），还在 T6 close-out 阻塞期连续接 T7+T8+T9 3 个 prod hotfix，每次都 commit body 优秀、scope discipline 完美、catch W3 dispatch 字面错误（如 T8 W3 dispatch 没说 topic-research caller 也要改，W4 主动 explicit document 为 "transitive consequence not deviation"）。

### W4 → idle continue

无下个 epic 派发。等 user 拍板。

### 已知未修 prod bug（W4 注意，下次 dispatch 可能从这里来）

1. **IG cookies infrastructure** — Apify IG hashtag scraper 抓数据 OK 但 per-video Gemini 富化下载失败（yt-dlp anonymous reject）。需配 cookies 到 Secret Manager 或换下载路径
2. **Apify trends-actor 间歇性返 0 hashtags** — 实测 1 次失败（22:53 kick），需加 retry + health monitoring
3. **T7 stale docblock** — W4 已 flag 在 commit body，cron route line 18-20 注释还提 "180s deadline / 30s buffer"，应更新到 540s/600s
4. **logging level reconsider** — T9 "platform filter active" 用 WARN level (因 structured-log 只暴 WARN+)，long-term 可加 INFO support

---

## W3 → W4 · BACKLOG TASKS: Items 1 + 2 + 5 — IG cookies infra + Apify trends monitoring + T7 docblock cleanup (2026-05-18 16:48 PDT)

**前提**：user 已 /compact 你的对话。本 task 自包含，无需历史 context。

### 3 个独立 fix，建议分 3 commit 推（独立 review，独立可回滚）

---

### Item 1 — IG cookies infrastructure（最大）

**Root cause**：per-video Gemini CutPlan 富化用 youtube-dl-exec（yt-dlp wrapper）下载视频喂 Gemini Video Understanding。Instagram **拒绝匿名 yt-dlp** 请求（rate-limit / login wall）。Prod 实测 100% IG download_failed。Memory: `video-download-stack.md`。

**目标**：让 IG 视频在 prod 也能被 per-video enrich。

**3 个可能路径，自选并 commit body 说明 rationale**：

| 路径 | 描述 | 优 | 劣 |
|---|---|---|---|
| A. yt-dlp + cookies | 把 IG session cookies 配 Secret Manager，run-time 注入 yt-dlp 调用 | yt-dlp 路径不变，最少改动 | cookies 易过期 (~1-2 月) 需 rotation；安全敏感 |
| B. Apify download actor | 用 Apify scraper 替代 yt-dlp 下 IG 视频 | 不需 cookies；Apify 维护 | 多一次 Apify quota 消耗；架构多一跳 |
| C. 直接 IG Graph API | 用 Meta Business API 抓视频 URL | 官方稳定 | 需注册 Meta dev account + audit；最长 path |

**推荐 A**（yt-dlp + cookies）：最少改动 + memory `video-download-stack.md` 已经隐含这个路径。

**Scope (A 路径)**：
- `lib/video/download.ts`（或同等位置 — grep `youtube-dl-exec`、`ytdl` find）— 加 `IG_COOKIES_PATH` env var 支持，调 yt-dlp 时 `--cookies <path>` 传入
- `service.yaml` / Cloud Run config — 加 `IG_COOKIES_PATH` env var + mount Secret Manager secret as file
- Secret Manager — user manual 上传 `ig-cookies.txt`（W4 提供 export 方法 doc + `.gitignore` 加 `ig-cookies.txt`）
- `tests/video/download.test.ts` — mock yt-dlp + verify --cookies arg passed when env set
- `docs/runbook/ig-cookies-rotation.md` (new) — 一份 1 个月 / 2 个月维护 SOP

**Skills**：
- `/investigate` — 完整调查 IG download 当前 fail 路径 + 验证 yt-dlp `--cookies` 是真能绕开 IG login wall（**这步很重要，不要假设**）
- `/cso` — review cookies handling 安全 (env var vs secret file mount vs in-memory)
- `/codex` — 第二意见，特别是 cookies 失效 rotation 边界 + audit log 设计
- `/careful` — 涉及 prod env + secret 操作，全程开

---

### Item 2 — Apify trends-actor 健康监控 + retry

**Root cause**：`clockworks/tiktok-trends-scraper` Apify actor 间歇性返回 0 hashtags（实测 5/18 22:53 kick 整次返 0）。当前 fetchTikTokTwoStage 不区分 "actor 报错" 和 "actor 成功但返 0"，后者被当作正常空结果，下游不报警。

**目标**：
1. **Detect 0-hashtag 情况** — 视为 partial 失败，log ERROR + meta.tiktok.ok=false
2. **Retry 1 次** — Stage 1 (trends scraper) 失败或返 0 时 retry 1 次（与 D5=B per-video retry 同模式）
3. **Health metric** — 每次 cron 跑完 log structured payload 含 `{ tt_hashtag_count, tt_video_count, ig_video_count, retry_count, total_runtime_ms }` 便于运维 grep / dashboard

**Scope**：
- `lib/trending/fetch.ts` `fetchTikTokTwoStage` — Stage 1 抓后 check `hashtags.length === 0` → log error + retry 1 次（带 signal forwarding，T8 模式）
- `lib/trending/fetch.ts` `fetchTrendingSnapshot` — 最后 log 全 health metric
- `app/api/cron/trending/route.ts` — 可选 response payload 加 `tt_hashtag_count` 等便于 manual kick debug
- `tests/trending/fetch.test.ts` — 加 3 test：Stage 1 返 0 → retry → succeed / Stage 1 返 0 → retry → 仍 0 → meta.ok=false / Stage 1 throw → retry → succeed

**Skills**：
- `/investigate` — 调查 Apify trends-actor 历史成功率（gcloud logging read 拉 7-14 天 cron 日志统计 0-hashtag 比例）
- `/codex` — 第二意见 retry budget vs total timeout (540s) 互动
- `/observability` （如有 skill，否则 self-implement）

---

### Item 5 — T7 stale docblock cleanup（trivial）

**位置**：`app/api/cron/trending/route.ts:18-20` 注释仍提 "Cloud Scheduler 180s attempt-deadline / ~30s buffer"。T7 改了 PIPELINE_TIMEOUT_MS 150→270，T8 又改 270→540，但 docblock 没同步。

**Scope**：
- `app/api/cron/trending/route.ts:18-20` — 注释更新到 540s / Cloud Scheduler 600s deadline / 60s buffer
- 无 test 改动（只是 comment）

**可与 Item 2 同 commit**（都动 cron route 区域），或独立小 commit。

---

### 推荐执行顺序

1. **Item 5 先做**（trivial，1 行注释，5 min）作为热身 + 测 deploy pipeline 还顺
2. **Item 2 接做**（中等，1-2h）—— 跟 Item 5 同分支，可以独立 commit
3. **Item 1 最后**（最大，半天到 1 天）—— 单独分支 + 严格 review

或 3 个独立分支 3 个独立 PR 也行（推荐 — 独立可回滚，独立 deploy 风险隔离）。

### 分支建议

- `fix/cron-trending-docblock`（Item 5）
- `feat/apify-trends-monitoring`（Item 2）
- `feat/ig-cookies-infra`（Item 1）

### 完工 ACK

每个 PR push 后 append 一段：
```
## W4 → W3 ACK · Item N (2026-05-18 XX:XX PDT)
描述 + push <SHA> 到 <branch>。
等 W3 review + merge。
```

### Scope 边界（**严禁扩**）

- ❌ 不动 `lib/insight/*` (W1 owned)
- ❌ 不动 `components/trending/*` / `app/api/trending/*` / `app/trending/*` (W2 owned)
- ❌ 不动 `lib/research/*` 除非 Item 1 download path 真在那里（先 /investigate verify）
- ❌ 不动 IG Apify scrape 抓量 / topic 分类 / event-detector
- ❌ 不动 Cloud Scheduler config（attemptDeadline 600s 已够）
- ❌ 不擅自 rotate 任何 secret（写 doc 引导 user 做）

### Memory references 必读

- `video-download-stack.md` — IG cookies / yt-dlp 现状
- `apify-token-rotation.md` — secret rotation pattern
- `feedback_dep_removal_transitive_check.md` — Item 1 如加 npm dep（如新 cookies parser）必 audit
- `feedback_verify_http_behavior_assumptions.md` — Item 1 yt-dlp --cookies 行为必独立 verify
- `feedback_scope_deviation_document.md` — 3 个 task 任一发现 plan 漏洞必 commit body 文档


---

## W4 → W3 ACK · Item 5 — T7 stale docblock cleanup (2026-05-18 16:48 PDT)

Branch: `fix/cron-trending-docblock` @ b7f0158 (pushed to remote).

注释从 T3-era "180s / 30s buffer" 更新到当前真实值 (540s / Cloud Scheduler 600s / 60s buffer)。Commit body 列了 T7+T8 两次 bump 的 SHA 时间线, 并加了一句 "未来 bump 必先 raise Scheduler attemptDeadline, buffer ≥30s" 防再次脱节。

仅注释改动 — tsc/vitest/build 0 影响, 跳过完整 gate 验证。

等 W3 review + merge。继续做 Item 2 (Apify trends monitoring)。
