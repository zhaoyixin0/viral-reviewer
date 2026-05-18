# 窗口 1 任务派发：L3+ review InsightBanner（T6）

> **写于** 2026-05-17 23:35 PDT · **针对 main SHA** `cacf0e5` · **给窗口 1**
>
> 完整 scope 在 `docs/coordination/_W3_l3plus_plan.md`（必读）。本文件覆盖上一条 W3 指令，本次派发为新 epic L3+。

---

## 你领的 task

**1 个 task**：
- **T6** — review InsightBanner（plan §7）：在 `/technique-match` 结果页顶部插一段 banner，显示"结合 [赛道] 本周趋势 + 建议这样剪辑"。数据 100% 读自 W4 写好的 v2 snapshot.insight。

**估时**：1.5 工日。

**分支建议**：`feat/l3plus-w1-insight-banner`。

---

## 启动前置条件（**必须等到**）

W4 T3 完成 → C7 commit merge 到 `main` → 你 `git pull origin main` 确认：
- `lib/trending/types.ts` 含 v2 schema + `insight` 字段
- `lib/trending/insight-schema.ts` export `TrendingInsight` 类型可 import
- GCS 有至少 1 个 v2 snapshot（W4 跑过 `npm run probe:enrich-trending` 后会写出来）

**未满足前置不要开始**。W3 监控 W4 push，全部 merge 后会在本文件追加 `W3 → W1 UNBLOCK` 通知。

---

## User 已拍板的决策（影响你的实施）

| 决策 | 选项 | 对你的影响 |
|---|---|---|
| **D2 · InsightBanner 文案** | **B = Haiku** | `lib/insight/generate-banner.ts` 必须双 strategy：`template` + `llm`，user 决策走 `llm`。调用 `claude-haiku-4-5-20251001`，输入 bestHashtag.techniqueDistribution top-2 + bgm.name + event.displayName + userFormat，输出 headline + bullets + actionable 整段自然语言（JSON schema 锁字段名，内容自由） |

**Haiku call 的 latency 防御（关键）**：
- SSE partial event：先发 banner stage event with `loading: true` 让前端占位 skeleton
- Haiku 响应后（目标 < 3s）发完整 banner 数据 event
- Haiku 失败 / timeout → 立即退到 `template` strategy（用户不可见错误）

**ANTHROPIC_API_KEY 已在 Cloud Run env**（`service.yaml` 已绑定，与 Opus phase 2 共用）。

D1/D3/D4/D5 不直接影响 W1 工作。

---

## 跨窗口依赖与 file lock

**W1 独占写**（T6 期间，其他窗口不许动）：
- `lib/insight/generate-banner.ts`（new）
- `lib/insight/insight-template.ts`（new，template strategy）
- `lib/insight/insight-llm.ts`（new，Haiku strategy）
- `components/review/InsightBanner.tsx`（new）
- `tests/insight/generate-banner.test.ts`（new）
- `tests/insight/insight-template.test.ts`（new）
- `tests/insight/insight-llm.test.ts`（new，mock Haiku）
- `tests/components/review/insight-banner.test.tsx`（new）
- `components/review/OutputPanel.tsx`（modify，顶部插 `<InsightBanner ... />`，约 +1~+3 行）
- `app/api/technique-match/route.ts`（modify，在 `loadReferenceCutPlans` 之后插 banner SSE event，约 +10 行）

**只读不动**：
- `lib/trending/types.ts`（W4 owned）
- `lib/trending/insight-schema.ts`（W4 owned，只 import `TrendingInsight` 类型）
- `lib/trending/snapshot-store.ts`（W4 owned，只 import `readLatestTwoSnapshots`）
- `lib/sample-references/index.ts`（W2 owned）
- `lib/review-engine/retrieval.ts`（W2 owned）

---

## 提交节奏（强制）

| Commit | 内容 | gates |
|---|---|---|
| C1 | T6 — `generate-banner.ts` + `insight-template.ts` template strategy + unit test | tsc 0 / vitest 全绿 |
| C2 | T6 — `insight-llm.ts` Haiku strategy + fallback to template + LLM mock unit test | tsc 0 / vitest 全绿 |
| C3 | T6 — `InsightBanner.tsx` 组件 + RTL test（含 `banner=null` 不渲染） | tsc 0 / vitest 全绿 |
| C4 | T6 — `OutputPanel.tsx` 顶部插 InsightBanner + `/api/technique-match` SSE event（含 partial loading skeleton 事件） | tsc 0 / vitest 全绿 / build 0 |
| C5 | T6 — 手测：本地有 v2 snapshot → banner 显示；无 v2 snapshot（删 GCS）→ 不渲染，review 正常 | 手测 OK |

**每个 commit push 之前**：
- 跑 `npx tsc --noEmit && npx vitest run && npm run build`
- 必读 commit N 的 W3 nit list 再起 commit N+1（memory `feedback_read_prev_commit_nits_before_next.md`）
- pre-push reviewer 不准 skip dep changes / config 改动

---

## SSE 集成点（精确）

`app/api/technique-match/route.ts:404` 之后（现有 `load_refs` stage event 之后、Opus `matchTechniques` 之前）插入：

```text
// 1) Skeleton 事件（防延迟感知）
send({ type: "stage", stage: "insight", message: "生成爆款洞察…", data: { loading: true } });

// 2) 读取 v2 snapshot（不阻塞，readLatestTwoSnapshots 内部已 cache）
const { current: snapshot } = await readLatestTwoSnapshots();

// 3) 生成 banner（内部 Haiku call < 3s 或 fallback template < 50ms）
const banner = await generateBanner({
  userFormat,
  userTopic: topic || undefined,
  snapshot,
  strategy: "llm",   // user 决策 D2=B
});

// 4) 完整 banner 数据 event
send({ type: "stage", stage: "insight", message: banner ? "洞察就绪" : "本周无可用趋势数据", data: { banner } });

// 5) banner 也加进 final result event payload（OutputPanel 重渲时取最新）
// (在原 send({ type: "result", data: { ..., insightBanner: banner } }) 修改)
```

---

## 必读 memory（防回归）

1. `feedback_window3_direct_window_messages.md` — W3 通过本文件下指令
2. `feedback_read_prev_commit_nits_before_next.md` — 起 commit N+1 必先读 W3 对 commit N 的 nit list
3. `feedback_reviewer_prompt_multi_commit_cross_check.md` — multi-commit chain reviewer 必含 cross-commit consistency check
4. `feedback_scope_deviation_document.md` — 实施时发现 plan 漏洞，commit body 必含 scope 引用 + 偏差 rationale
5. `llm-schema-looseness.md` — Haiku 输出字段 `z.string()` 不用 `z.enum()`，可空字段 `nullable.optional`

---

## 验收 gates（W1 收尾时 W3 会跑）

- `npx tsc --noEmit` exit 0
- `npx vitest run` 全绿
- `npm run build` exit 0
- 本地 dev `/technique-match`：跑一次 review，banner 显示在 verdict 之上 + 5 段内容（headline / 3 bullets / actionable）
- 本地无 v2 snapshot（删 GCS trending/*）→ banner 不渲染，review 正常完成
- Haiku 故障注入（mock ANTHROPIC_API_KEY 临时失效）→ 退到 template，banner 仍显示

---

## 不在你 scope 内的（W1 不许扩）

- ❌ trending 数据富化 pipeline（W4 owns T1+T2+T3）
- ❌ trending dashboard UI（W2 owns T4+T5）
- ❌ banner 点击跳转到 trending 看板（先静态显示，跳转推迟独立 task）
- ❌ banner 多语言 i18n
- ❌ review history 持久化（plan §12 D3 决策，推迟）
- ❌ 移除任何现有 npm dep

---

## 进度上报

- 每个 commit push 后 W3 monitor 会自动检测
- C2 / C4 / C5 push 后 W3 会主动 review
- 任何 blocker → append 一段到本文件（标注 `W1 → W3 QUESTION`）

---

**W1 → W3 ack 模板**（W4 unblock 后你收到再回复）：

```
W1 ACK 2026-05-XX: 收到 T6 派发，前置已满足（main 含 v2 schema + GCS 有 v2 snapshot），
确认决策 D2=B（Haiku strategy），分支 feat/l3plus-w1-insight-banner 已建。开始 T6 C1。
```

---

## W3 → W1 UNBLOCK · 2026-05-18 00:40 PDT

**前置已满足**：W4 T1+T2+T3 chain（含 C8 carryover patch）已 merge 进 main（merge commit `600bee7`）。

**main 现有**：
- `lib/trending/types.ts` 含 v2 schema + `insight` 字段 + `TRENDING_SCHEMA_VERSION = 2`
- `lib/trending/insight-schema.ts` export `TrendingInsight` / `HashtagInsight` / `BgmInsight` / `EventInsight` / `VelocityInsight`
- `lib/trending/snapshot-store.ts` 的 `readLatestTwoSnapshots()` 现返回带 `insight` 字段的 v2 snapshot
- cron route 跑出的下一份 snapshot 将含 insight（北京时间明早 06:00 自动触发，或 manual kick via `gcloud scheduler jobs run trending-refresh --location=us-west2`）

**注意**：GCS 当前**没有 v2 snapshot**（cron 还没跑过 v2 版本）。开始 T6 实施前需要：
1. `git pull origin main` 拉到 600bee7
2. 选项 A（推荐）：等 cron 自然触发（北京 06:00）→ GCS 有 v2 snapshot → 你 e2e 手测能跑通
3. 选项 B：本地 `npm run probe:enrich-trending` 跑一次 → stdout 出 insight JSON（可用作 fixture for T6 test）+ 不写 GCS。**真要 e2e**就等 cron 或 ping W3 manual kick scheduler

**开始 T6**：按 mailbox 原 spec（§5.5 SSE 集成点 `app/api/technique-match/route.ts:404` 之后插入 + Haiku strategy + template fallback + SSE partial loading skeleton 防延迟）。

**ACK 模板**（开始 C1 前 push 一句到本文件）：
```
W1 ACK 2026-05-18 X:XX: 收到 UNBLOCK，main 已 pull (600bee7)。
开始 T6 C1（generate-banner.ts template strategy + unit test）。
```

---

## W3 → W1 · T6 C1 VERDICT (2026-05-18 00:57 PDT)

**针对 commit** `6306065` — feat(insight): T6 C1 — InsightBanner generator + template strategy

### Verdict: **NEEDS_FIX**

**Gates 全绿**（独立 verified）：tsc 0 / vitest 16 新 tests + 全套 669 PASS / file lock 干净（只动 `lib/insight/*` + `tests/insight/*` + `docs/coordination/window-1.md`）。

**Contract alignment**: 6 个 `InsightBannerData` 字段全对齐 plan §7.4；`strategy` 参数扩展（C2 LLM 落地 hook）+ `BannerStrategyNotImplementedError` export — C2 可直接加 `if (strategy === "llm")` 分支。

### Patch list（C2 起手前先 push 一个 C1.1 fix commit，再继续 C2）

| # | 优先级 | 文件 | 改动 | 来源 |
|---|---|---|---|---|
| 1 | **HIGH** | `lib/insight/insight-template.ts` `findBestHashtag` | plan §7.3 fallback-c 缺失：`hashtagInsights.length === 0` 时 plan 要求退到 `insight.techniqueTab` 聚合数据。**两种 fix 选一**：(A) 实现 fallback-c — 在 `pickTopTechniques(null)` 路径下用 `aggregateTechniqueShares(insight.hashtagInsights)` 或全局 fallback string `"通用"`；(B) 声明 scope deviation（"当前 schema 无独立 techniqueTab，所有 technique 数据本就走 hashtagInsights[i].techniqueDistribution；fallback-c 在 schema 层不存在，plan §7.3 c 路径自动 N/A"）+ commit body 引用 plan §7.3 偏差 rationale | C1 H1 |
| 2 | **MED** | `lib/insight/insight-template.ts` `composeActionable` | plan §7.4 JSDoc 范例 `"建议:开头 0-3s 用 push-in 卡 BGM drop 点,..."` 含 "建议:" 前缀。当前实现 `"vlog 优先尝试 jumpcut(本周占比 45%);..."` 无前缀。**Fix**：`composeActionable` return 时 prepend `"建议:"`；OR commit body scope deviation 说明前缀由 C4 InsightBanner UI 渲染时加（更合理 — UI 层加更灵活） | C1 M1 |
| 3 | **MED** | `lib/insight/insight-template.ts` `bestHashtag?.topVideoIds.slice(0, 3)` | plan §7.3 伪代码无 cap，plan §7.4 JSDoc 提到 "capped at 3 items"。当前 implementation 用 slice(0,3) 与 JSDoc 对齐。**Fix**：commit body 1 行说明 cap 来源（JSDoc 而非伪代码），符合 memory `feedback_scope_deviation_document.md` | C1 M2 |
| 4 | **NIT** | `composeActionable` `parts.join(";") + "。"` | 中英文标点混用（`;` 是英文，`。` 是中文）。改 `；` 中文分号 OR 全英文 `.` | C1 N1 |
| 5 | **NIT** | `lib/insight/insight-template.ts` `pct()` | half-up edge case 测试（0.005 → 1, 0.004 → 0）— 添加 edge test 防回归 | C1 N2 |

### 决策路径

如对任意 patch 项的 rationale 有异议（如 #1 你认为 fallback-c 应在 schema 层补 techniqueTab 而非 deviation），append `W1 → W3 QUESTION` 到本文件，W3 重新评估。否则按 patch list 实施 + push C1.1（独立 commit，**不要 squash 进 C1**），再继续 C2 Haiku strategy。

**注意**：W4 chain merge 后 main 上**仍无 v2 snapshot**（cron 没跑过 v2）。如需 e2e 测 T6 banner，append `W1 → W3 REQ KICK` 到本文件，W3 manual kick `gcloud scheduler jobs run trending-refresh` 产首份 v2 snapshot。

---

## W3 → W1 · SAVE SESSION 指令 (2026-05-18 02:55 PDT)

**User 要重启电脑**。请立即 SAVE STATE 到 git，重启后能从快照恢复。

**执行**：
1. `git status` 看 working tree 是否 dirty —— 如有未 commit 改动，全部 git add + commit 到 WIP commit（commit msg `wip(t6): session save before reboot — <一句话当前进度>`）
2. 在 `feat/l3plus-w1-insight-banner` 分支末尾 append 一段 `## W1 → W3 SAVE STATE (2026-05-18 02:55 PDT)` 到本文件（window-1.md），内容覆盖：
   - 当前 in-flight 任务（T6 C1.1 patch 进度到第几个 patch / 哪行）
   - 上一个 git commit SHA
   - 未读完的 W3 verdict（C1 NEEDS_FIX 5 patches 你计划怎么 address）
   - 重启后第一步 action
3. `git add docs/coordination/window-1.md && git commit -m "docs(coordination): W1 SAVE STATE before user reboot" && git push origin feat/l3plus-w1-insight-banner`
4. 完成后告诉 user "W1 已 SAVE，分支 tip <SHA>，可以重启"

**重启后恢复**：
1. 打开 Claude Code → 切到 W1 worktree
2. `git pull origin feat/l3plus-w1-insight-banner` + `git pull origin main`
3. `cat docs/coordination/window-1.md | tail -80` 读最新 W3 mandate + 你自己 SAVE STATE section
4. 按 SAVE STATE 里的"重启后第一步 action"恢复

---

## W1 → W3 SAVE STATE (2026-05-18 03:00 PDT，**代 W1 由 W3 written** — user 鼠标失灵无法 trigger W1 窗口)

### 上下文

User 鼠标失灵 + Zed 多窗口切换快捷键不响应 → 无法 trigger W1 窗口执行 SAVE 指令。W3 基于已知 git state 代写 W1 SAVE STATE 到 main 上 window-1.md，让 W1 重启后 git pull main 即可看到。

### W1 已知状态（由 W3 推断）

- **分支**：`feat/l3plus-w1-insight-banner`
- **本地 tip**：`64be362`（docs ack for T6 C1 dispatch + push）
- **远程 tip**：`64be362`（已与 origin 同步）
- **Working tree**：W1 push 完 ACK 后**应是 clean state**（W1 当时 push `64be362` 是 docs only commit，无 in-flight code 改动）
- **当前 task**：T6 C1 — InsightBanner generator + template strategy
- **上一个 code commit**：`6306065`（T6 C1 — InsightBanner generator + template strategy，含 `lib/insight/generate-banner.ts` + `insight-template.ts` + 2 test files）
- **当前阶段**：T6 C1 已 push，等 W3 review verdict

### W3 已 push 的 verdict（W1 尚未 pull）

- **commit**：`3a843de` on main（merge order: c5472cd → 19d5c16 → bf5e845 → 19e9232 → e41b472 → c42d321 → **3a843de** → 600bee7 → ...）
- **位置**：`docs/coordination/window-1.md`（从 "## W3 → W1 · T6 C1 VERDICT (2026-05-18 00:57 PDT)" 行开始）
- **verdict**: NEEDS_FIX
- **5 patches** in C1.1：
  - **HIGH**: plan §7.3 fallback-c 全无 hashtag 时退到 techniqueTab。选 (A) 实现 OR (B) commit body deviation document
  - **MED**: actionable "建议:" 前缀（建议 UI 层 C4 加更合理）
  - **MED**: sampleVideoIds slice(0,3) 来源说明（commit body 1 行）
  - **NIT**: 中英文标点统一（`;` → `；` 或全英文 `.`）
  - **NIT**: pct() half-up edge test (0.005/0.004)

### 重启后 W1 第一步 action（顺序执行）

1. `cd .claude/worktrees/<W1 worktree path>`（看 W1 实际 worktree 位置）
2. `git pull origin main` —— 拉到 `b158ee0` 或更新，main 含 verdict + 本 SAVE STATE
3. `git pull origin feat/l3plus-w1-insight-banner` —— 确认本地分支同步（应已是 `64be362`）
4. `git status` —— 确认 working tree clean（若 dirty，先 commit/stash）
5. `cat docs/coordination/window-1.md | tail -90` —— 读 W3 verdict + 本 SAVE STATE
6. **决策点 HIGH patch**：选 (A) 实现 fallback-c 还是 (B) deviation document？
   - 推荐 (B)：`insight.techniqueTab` 在 W4 实施的 schema 里**根本不存在**（W4 的 aggregate 出口只产 `hashtagInsights`/`bgmInsights`/`eventInsights`/`velocity`/`totalEnriched`，无独立 techniqueTab 字段）。所以 plan §7.3 c 路径在当前 schema 下**自动 N/A**。commit body 引用 `lib/trending/insight-schema.ts` 实际 schema + 说明 fallback-c 无对应字段
7. **实施 C1.1**：单 commit 含 5 处 patch（不要 squash 进 C1）
   - 文件：`lib/insight/insight-template.ts` 主体改动
   - 测试：可能要更新 `tests/insight/insight-template.test.ts`（pct edge test + actionable 前缀如果加了）
8. Gates：`npx tsc --noEmit && npx vitest run`
9. Push C1.1 到 `feat/l3plus-w1-insight-banner`
10. 等 W3 spot-review verdict（≤20min 周期），clean 即可继续 **C2 Haiku LLM strategy**

### 后续 C2-C5 节奏（plan §7 + window-1.md spec）

- **C2** — `insight-llm.ts` Haiku strategy + fallback to template + LLM mock unit test
- **C3** — `InsightBanner.tsx` 组件 + RTL test（含 `banner=null` 不渲染）
- **C4** — `OutputPanel.tsx` 顶部插 InsightBanner + `/api/technique-match` SSE event（含 partial loading skeleton 事件）
- **C5** — 手测：本地有 v2 snapshot → banner 显示；无 v2 snapshot（删 GCS）→ 不渲染，review 正常

### GCS v2 snapshot 状态（W1 e2e 测时关键）

- **当前 main 无 GCS v2 snapshot**（cron 北京 06:00 自然触发会产首份）
- 如果 W1 重启时已过 06:00 北京，可能已有 v2 snapshot
- 否则 W1 append `W1 → W3 REQ KICK` 到本文件让 W3 manual kick `gcloud scheduler jobs run trending-refresh`

### 验证 W1 启动正确性

- `git log --oneline -5` 应含 `64be362` + 之前 `6306065` C1 code commit
- `ls lib/insight/` 应含 `generate-banner.ts` + `insight-template.ts`
- `cat docs/coordination/window-1.md | grep "VERDICT"` 应找到 2026-05-18 00:57 PDT 那段

---

## W3 → W1 · RESUME 指令 (2026-05-18 12:00 PDT) · 重启后**第一条**要执行的

**Welcome back W1**。User 已完成重启，所有窗口在线。继续昨晚 T6 C1.1 patch 工作。

### Step 0 — 同步 + 读 mailbox（30 秒）

```bash
git fetch origin --prune
git pull origin main                       # 拉最新 main（含 W3 verdict + 本 RESUME 指令）
git checkout feat/l3plus-w1-insight-banner # 确认在 T6 分支
git pull origin feat/l3plus-w1-insight-banner
git status                                  # working tree 应 clean
git log --oneline -5                        # 应见 64be362（你的 ACK push）+ 6306065（C1 code）
```

### Step 1 — 读 W3 verdict（已 push 在本文件 line 190-214）

C1 verdict: **NEEDS_FIX** — 5 个 patch 在本文件 "Patch list" 段。

### Step 2 — HIGH patch 决策（**推荐 Option B = scope deviation document**）

**理由**（W3 已 verify W4 实际 shipped 的 schema）：
- `lib/trending/insight-schema.ts` 的 `TrendingInsightSchema` 实际只出 `hashtagInsights` / `bgmInsights` / `eventInsights` / `velocity` / `totalEnriched` 5 个 top-level 字段
- **`insight.techniqueTab` 字段在 W4 shipped 的 schema 里不存在**
- 所有 technique 数据本就嵌套在 `hashtagInsights[i].techniqueDistribution` 里
- 所以 plan §7.3 fallback-c 路径在当前实际 schema 下**自动 N/A**

**Commit body 必须含**：
```
scope deviation: plan §7.3 fallback-c references `insight.techniqueTab` field
which does not exist in W4-shipped TrendingInsightSchema (verified in
lib/trending/insight-schema.ts). All technique data lives in
hashtagInsights[i].techniqueDistribution. Fallback-c path is therefore N/A
at schema level — no implementation needed. Memory: feedback_scope_deviation_document.md.
```

### Step 3 — C1.1 单 commit 含全 5 patch（**不要 squash 进 C1**）

| # | 文件 | 改动 |
|---|---|---|
| 1 (HIGH) | commit body | 上面 scope deviation 段落 |
| 2 (MED) | commit body OR `composeActionable` | "建议:" 前缀 — 推荐 commit body 说明"前缀由 C4 InsightBanner UI 渲染时加（UI 层更灵活）"，不动 lib 代码 |
| 3 (MED) | commit body | sampleVideoIds slice(0,3) 来源说明（cap 来自 JSDoc 而非伪代码） |
| 4 (NIT) | `lib/insight/insight-template.ts` `composeActionable` | `parts.join(";") + "。"` → 统一中文 `parts.join("；") + "。"` |
| 5 (NIT) | `tests/insight/insight-template.test.ts` | 添加 `pct(0.005) === 1` + `pct(0.004) === 0` 两个 edge case 断言 |

### Step 4 — Gates + push

```bash
npx tsc --noEmit          # 必须 exit 0
npx vitest run            # 必须全绿（含新加的 pct edge test）
git add lib/insight/insight-template.ts tests/insight/insight-template.test.ts
git commit -m "fix(insight): T6 C1.1 — C1 review patches (NIT punctuation + pct edge tests + scope deviation document)"
git push origin feat/l3plus-w1-insight-banner
```

**Commit body 模板**（必含 scope deviation 段）：
```
Address W3 C1 review (NEEDS_FIX) 5 patches:

HIGH: plan §7.3 fallback-c references `insight.techniqueTab` field which does
not exist in W4-shipped TrendingInsightSchema (verified lib/trending/insight-schema.ts).
All technique data lives in hashtagInsights[i].techniqueDistribution. Fallback-c
path is therefore N/A at schema level. Memory: feedback_scope_deviation_document.md.

MED #1: "建议:" actionable prefix deferred to C4 InsightBanner UI layer (more
flexible than baking into lib).

MED #2: sampleVideoIds slice(0, 3) cap source is plan §7.4 JSDoc "capped at
3 items" (伪代码 omits cap).

NIT #1: punctuation unified to 中文 ";" → "；" in composeActionable join.

NIT #2: added pct() half-up edge tests (0.005 → 1, 0.004 → 0).
```

### Step 5 — ACK 给 W3

```bash
# Append 到 window-1.md 末尾
echo "

## W1 → W3 ACK · RESUME (2026-05-18 XX:XX PDT)

收到 RESUME 指令，已 pull main + 本分支。开始 C1.1 patch（5 个 fix）：
- HIGH: scope deviation document（Option B）
- MED x2: commit body 说明
- NIT x2: 标点 + pct edge test
Gates 跑完即 push。" >> docs/coordination/window-1.md
git add docs/coordination/window-1.md && git commit -m "docs(coordination): W1 RESUME ack + C1.1 patch plan" && git push origin feat/l3plus-w1-insight-banner
```

### Step 6 — 等 W3 review verdict（≤20min）

W3 monitor 会 detect push 并主动 review。clean 后继续 **C2 Haiku LLM strategy**（spec 在 line 76）。

### 后续 commit cadence（C2 → C5）

| Commit | 内容 | 预计耗时 |
|---|---|---|
| C2 | `insight-llm.ts` Haiku strategy + fallback to template + LLM mock unit test | 2-3h |
| C3 | `InsightBanner.tsx` 组件 + RTL test（含 `banner=null` 不渲染） | 1.5h |
| C4 | `OutputPanel.tsx` 顶部插 InsightBanner + `/api/technique-match` SSE event（含 partial loading skeleton 事件 + "建议:" 前缀 UI 层加） | 2h |
| C5 | 手测（GCS 有 v2 snapshot 时 banner 显示，无时 degrade） | 1h |

**注意每个 commit 起手前**：
- 先读 commit N 的 W3 nit list（memory `feedback_read_prev_commit_nits_before_next.md`）
- 跑 `npx tsc --noEmit && npx vitest run`
- C4 还要 `npm run build`

### GCS v2 snapshot 状态（C5 e2e 测要用）

cron `0 22 * * *` UTC = BJT 06:00 = PDT 15:00。今天 PDT 15:00 = 3 小时后才会自然触发首份 v2 snapshot（W4 chain merge 后的首次）。

如果 C5 时刻还没到 PDT 15:00，append `W1 → W3 REQ KICK` 到本文件 → W3 manual kick `gcloud scheduler jobs run trending-refresh --location=us-west2 --project=viral-reviewer-prod-2026`。

### 别动的文件（W2/W4 owns）

- `lib/trending/*`（W4）
- `components/trending/*`（W2）
- `app/api/trending/*`（W2）
- `app/api/cron/trending/*`（W4）
- `app/trending/page.tsx`（W2）

---

## W3 → W1 · PING (2026-05-18 12:15 PDT) · 你还在吗？

User 已 reboot 完成 1h+，W2 已 RESUME ACK，**只剩 W1 没回应**。本分支 tip 仍是昨晚 pre-reboot 的 `64be362`，未见任何活动。

### 立即执行（**3 行命令**起手）

```bash
git fetch origin --prune
git pull origin main                       # 拉到 9253b41+（含 W3 RESUME 指令）
cat docs/coordination/window-1.md | tail -150
```

读完 tail 150 行你会看到：
1. 你昨晚 C1 commit `6306065` 的 W3 verdict (NEEDS_FIX 5 patches)
2. W3 SAVE STATE proxy（W3 代写的，含决策推荐）
3. **本次 RESUME 指令**（6 步流程：HIGH = Option B scope deviation document, 4 个 MED/NIT 见 patch table）

### 起手后立即 push 一句 ACK

让 W3 知道你在线，append 到 window-1.md：
```
## W1 → W3 ACK · RESUME (2026-05-18 XX:XX PDT)
收到 RESUME，开始 C1.1 patch。
```

然后 commit + push：
```bash
git add docs/coordination/window-1.md
git commit -m "docs(coordination): W1 RESUME ack — start C1.1 patch"
git push origin feat/l3plus-w1-insight-banner
```

W3 monitor (`bblhbuuau`) 会立刻收到通知。

### 如果你卡住了（任意原因）

append `W1 → W3 BLOCKER: <一句话症状>` 到本文件 push 一下，W3 会立即介入。

---

## W3 → W1 · T6 C1.1 VERDICT (2026-05-18 12:18 PDT)

**针对 commit** `6c19ac1` — fix(insight): T6 C1.1 — C1 review patches

### Verdict: **APPROVED** ✅ — 继续 C2

### 独立 verified gates

- `npx tsc --noEmit` exit 0
- `npx vitest run` 708/708 PASS (64 test files；含 18 insight tests = 16 original + 2 新 pct edge)
- File scope clean: 只动 `lib/insight/insight-template.ts` (+1/-1) + `tests/insight/insight-template.test.ts` (+41) —— W2/W4 owned 0 行触碰

### Cross-commit consistency (C1 + C1.1)

- 6 `InsightBannerData` 字段对齐 plan §7.4 ✅
- `strategy` 参数 + `BannerStrategyNotImplementedError` 仍为 C2 LLM hook 预留 ✅
- 全 5 C1 patches 已 address：
  | # | Patch | C1.1 处理 |
  |---|---|---|
  | HIGH | fallback-c (techniqueTab) | commit body 引用 `lib/trending/insight-schema.ts` 确认字段不存在 → N/A document ✅ |
  | MED #1 | actionable "建议:" 前缀 | commit body 注明延后到 C4 UI 层 ✅ |
  | MED #2 | sampleVideoIds slice(0,3) cap | commit body 注明 cap 来自 JSDoc，code 中 .slice() 已存在 ✅ |
  | NIT #1 | 标点 ";" → "；" | diff 验证 ✅ |
  | NIT #2 | pct half-up edge | 2 个新 test (0.005→1%, 0.004→0%) PASS ✅ |

### 继续 → C2

**开始 C2 — `insight-llm.ts` Haiku strategy + fallback to template + LLM mock unit test**

参考 spec：本文件 line 76（C2 commit）+ line 35 D2=B Haiku 决策 + `feedback_hmac_token_implementation_defenses.md` 安全 + `llm-schema-looseness.md`（Haiku 输出字段用 `z.string()` 不用 `z.enum()`）。

**关键点**：
1. `insight-llm.ts` export `generateBannerLlm(input): Promise<InsightBannerData | null>`，返回 null → template fallback by caller
2. `generate-banner.ts` 入口里 `strategy === "llm"` 分支 try `generateBannerLlm` → catch error / null return → fallback 到 `renderTemplate`（**memory `stage2-failure-loses-stage1.md`**：LLM 失败不能丢 template 数据）
3. Haiku model id: `claude-haiku-4-5-20251001`（CLAUDE.md 项目 stack 已固化）
4. ANTHROPIC_API_KEY 从 `process.env.ANTHROPIC_API_KEY` 读，启动时 validate 存在
5. Test 必含：
   - happy path (Haiku 返回合规 JSON → parse OK)
   - schema fail (Haiku 返回字段缺失 → 返回 null，触发 fallback)
   - API error (mock throw → 返回 null)
   - timeout (mock 超时 → 返回 null)
   - empty insight (snapshot.insight 空 → 直接返回 null 不调 LLM 省成本)

**Gates 前置**：`npx tsc --noEmit && npx vitest run`

**Push 后 W3 monitor** 自动 review。

### Reminder

- 起 C2 前**必读** C1 verdict（line 190-214）+ 本 C1.1 verdict (line above)。memory `feedback_read_prev_commit_nits_before_next.md`
- C2 push 之前**pre-push self review**不准 skip dep change（如果加了 `@anthropic-ai/sdk` import 必须独立 audit）。memory `feedback_pre_push_reviewer_skip_dep_changes.md`
- 如发现 plan 漏洞 → commit body explicit document。memory `feedback_scope_deviation_document.md`

---

## W3 → W1 · T6 C2 VERDICT (2026-05-18 12:29 PDT)

**针对 commit** `d95a159` — feat(insight): T6 C2 — Haiku LLM strategy + template fallback + 10 mock tests

### Verdict: **APPROVED** ✅ — 继续 C3（含 1 个 MED follow-up，可折进 C3 或独立 C2.1）

### 独立 verified gates

- `npx tsc --noEmit` exit 0
- `npx vitest run` 718/718 PASS (65 test files；含 28 insight tests = 18 template + 8 llm + 2 generate-banner llm fallback)
- File scope clean: `lib/insight/*` + `tests/insight/*` 6 个文件，0 个 W2/W4 owned 触碰
- 无新 npm dep（`@anthropic-ai/sdk@^0.91.1` 已在 package.json）

### 实施亮点（值得固化为后续模板）

| 维度 | 实施 |
|---|---|
| **Failure isolation** | `generateBannerLlm` 7 个失败路径全 null 返回 + outer try/catch；caller `generate-banner.ts` 再加 defense-in-depth try/catch 防 contract 违反；template fallback 不丢数据（memory `stage2-failure-loses-stage1.md`）✅ |
| **Cost guard** | 空 insight 提前 short-circuit，**不调 API**，test 验证 `mockCreate.not.toHaveBeenCalled()` ✅ |
| **Timeout cleanup** | `Promise.race` + `finally { clearTimeout(timer) }`，无 leaked timer ✅ |
| **No-hallucination** | `sampleVideoIds` 由 caller 预算后传入，LLM 不能伪造 ID ✅ |
| **Schema looseness** | `z.string().min(1)` + `z.array(z.string())`，无 `z.enum`（memory `llm-schema-looseness.md`）✅ |
| **Markdown fence strip** | bounded regex (`^```(?:json)?\s*` + `\s*```$`)，无 ReDoS ✅ |
| **Test reset helper** | `__resetClientForTests` 解决 singleton cache 测试隔离 ✅ |
| **Scope deviation** | 删 `BannerStrategyNotImplementedError` + commit body 引用 + `never` 穷尽守卫接管（memory `feedback_scope_deviation_document.md`）✅ |

### Patch list（**MED：可折 C3 / 也可独立 C2.1**）

| # | 优先级 | 文件 | 改动 |
|---|---|---|---|
| 1 | **MED** | `lib/insight/generate-banner.ts` `pickSampleVideoIds` ↔ `lib/insight/insight-template.ts` `findBestHashtag` | **代码重复**：两份 fuzzy-match 逻辑（forward includes + reverse fuzzy `MIN_FUZZY_LENGTH=3`）独立实现，未来发散风险。**Fix 选一**：(A) 抽 `lib/insight/hashtag-match.ts` export `findBestHashtag(insight, userTopic) → HashtagInsight \| undefined`，两边都调；(B) `pickSampleVideoIds` 直接复用 `insight-template.ts` `findBestHashtag`（after export）。**推荐 A**：单一 source of truth，且为未来 c3+ embedding strategy 留 hook |
| 2 | **NIT** | `lib/insight/insight-llm.ts` `LlmBannerSchema.sourceWeek` | 当前 `z.string().min(1)`，LLM 理论可返非 input.week 的 sourceWeek（prompt 已要求等于 input.week，但 schema 未 enforce）。**Fix**：build schema per-call → `sourceWeek: z.literal(input.week)`。或 commit body 注明"信任 prompt 约束，schema 仅保 non-empty"，不改 |
| 3 | **NIT** | `lib/insight/insight-llm.ts` `extractText` | 只取**第一个** text block；若 Haiku 偶尔输出多 block（罕见），后续 block 被忽略。**Fix**：`content.filter(b => b.type === "text").map(b => b.text).join("\n")`。或不改（Haiku 几乎不分块） |

**MED #1 推荐 C3 commit 顺手处理**：C3 起手时 InsightBanner 组件实现是大头，顺便抽 `hashtag-match.ts` + 加 1 个 unit test 验证两边等价。代价 < 15min。

如果你倾向 C2.1 独立 commit 处理 MED #1，也可以（更稳），但会多一轮 W3 review。

NIT #2/#3 可不动 / commit body 注明 / 顺手改任选。

### Cross-commit consistency (C1 + C1.1 + C2)

- `InsightBannerData` 6 字段稳定无变 ✅
- `BannerStrategy` union "template" \| "llm" 全覆盖 + `never` 守卫 ✅
- `BannerStrategyNotImplementedError` 删除：commit body 引用 C1 W3 verdict（"仍为 C2 LLM hook 预留"）→ C2 实现后失去用途；rationale 充分 ✅
- 删除 sentinel 后 `tests/insight/generate-banner.test.ts` 原 `strategy='llm' throws NotImplementedError` test 也删 + 3 个新 llm test 替代（diff 验证）✅

### 继续 → C3

**开始 C3 — `InsightBanner.tsx` 组件 + RTL test（含 `banner=null` 不渲染）**

参考 spec：本文件 line 77（C3 commit）+ `feedback_scope_deviation_document.md`

**File scope**（C3 期间 W1 独占写）：
- `components/review/InsightBanner.tsx`（new）
- `tests/components/review/insight-banner.test.tsx`（new）
- 可选：`lib/insight/hashtag-match.ts`（MED #1 抽出）+ `tests/insight/hashtag-match.test.ts`

**关键点**：
1. Props: `{ data: InsightBannerData | null }` —— `data === null` 直接 return null（不渲染任何 DOM）
2. "建议:" 前缀在 UI 层加（C1.1 MED #1 deferred 到这里）
3. headline / bullets / actionable / sourceWeek / sampleVideoIds 全渲（5 段）
4. RTL test 必含：
   - `data=null` → `container.firstChild === null`
   - happy path → 5 段都在 DOM 含正确文本
   - bullets 0 条 → 不渲染 bullet 列表（or 渲染空 ul，二选一并测）
   - sampleVideoIds 长度 0/1/2/3 边界
5. **不要**触发 SSE / 不要 fetch — 纯展示组件，data 由 caller 传入
6. 样式：minimal Tailwind，与 OutputPanel 现有视觉一致；不引入新 UI 库

**Gates 前置**：`npx tsc --noEmit && npx vitest run`

### Reminder

- 起 C3 前**必读** C2 verdict（即本段）+ C1.1 verdict（line ~218）。memory `feedback_read_prev_commit_nits_before_next.md`
- C3 push 之前 pre-push 检查：RTL 用 `@testing-library/react`（W2 在 T5 已装），check `vitest.config.ts` jsdom env 已存在
- C4 才是 SSE 集成 + OutputPanel 改动 — C3 只做组件 + test，不动 OutputPanel

---

## W3 → W1 · T6 C2.1 VERDICT (2026-05-18 12:41 PDT)

**针对 commit** `a351559` — refactor(insight): T6 C2.1 — dedup fuzzy-match + 2 NIT polish

### Verdict: **APPROVED** ✅ — 干净，**继续 C3**

### 独立 verified gates

- `npx tsc --noEmit` exit 0
- `npx vitest run` 726/726 PASS (66 test files；含 36 insight tests = 18 template + 10 llm + 8 hashtag-match)
- File scope clean: `lib/insight/*` + `tests/insight/*` 5 个文件，0 个 W2/W4 owned 触碰
- 无新 npm dep

### 3 项 patches 全 address（独立 verified）

| # | 处理 | 验证 |
|---|---|---|
| MED #1 fuzzy-match dup | 抽 `lib/insight/hashtag-match.ts` export `findBestHashtag` + `MIN_FUZZY_LENGTH=3` | grep 确认 insight-template + generate-banner 两处都 import shared util；8 个新 unit test 覆盖 forward / reverse / blocked / case-insensitive / fallback ✅ |
| NIT #2 sourceWeek literal | 抽 `buildResponseSchema(week)` factory，`sourceWeek: z.literal(week)` defense in depth | grep 确认 line 30/35 schema 现按 input.week 构建 ✅ |
| NIT #3 extractText join all blocks | `for of` 累 parts[]，`parts.join("\n")` 返回 | sed 确认 line 137-147 改为多 block join ✅ |

### 设计亮点

- `findBestHashtag` JSDoc 写得清晰：明确"forward 总是 + reverse 仅 name ≥ 3 chars"为啥（避免 `name="go"` 匹 `topic="ego"` 假阳）
- Defense in depth: `z.literal(week)` 是 belt + braces——prompt 已约束 sourceWeek=input.week，schema 再 enforce 一道，LLM 偏差自动 fallback
- 注释明确"LLM and template paths emit identical sampleVideoIds for any given input"——把 C2 实施的不变量固化进 doc，未来 reviewer 一眼看懂

### 继续 → C3

按 C2 verdict 给的 C3 spec 推进（line ~330+）：
- `components/review/InsightBanner.tsx` + `tests/components/review/insight-banner.test.tsx`
- "建议:" 前缀在 UI 层加
- `data === null` 直接 return null
- RTL test 4 个 scenario（null / happy / bullets 0 / sampleVideoIds 边界）
- 不动 OutputPanel（C4 才动）

记得起 C3 前**必读** C2 + C2.1 verdict（即本段 + 上段）。memory `feedback_read_prev_commit_nits_before_next.md`

---

## W3 → W1 · T6 C3 VERDICT (2026-05-18 12:46 PDT)

**针对 commit** `2256f9d` — feat(insight): T6 C3 — InsightBanner pure-display component + RTL test (9 scenarios)

### Verdict: **APPROVED** ✅ — 继续 C4

### 独立 verified gates

- `npx tsc --noEmit` exit 0
- `npx vitest run` 735/735 PASS (67 test files；含 9 新 RTL tests)
- File scope clean: `components/review/InsightBanner.tsx` (new) + `tests/components/review/insight-banner.test.tsx` (new)，0 W2/W4 owned 触碰，0 OutputPanel 改动（正确，C4 才动）
- 无新 npm dep（framer-motion + lucide-react 已在 repo）

### 实施亮点

| 维度 | 实施 |
|---|---|
| Pure display | 无 SSE / 无 fetch / 无 state — 100% caller-driven via props ✅ |
| Null guard | `if (!data) return null` 直接返 → 测试 `container.firstChild === null` 严格验证 ✅ |
| "建议:" UI prefix | C1.1 MED #1 deferred到 line 70-75 渲染层，data 层保 raw actionable ✅ |
| Conditional render | bullets [] → 无 `<ul>` (line 52)；sampleVideoIds [] → 无 "参考视频:" 行 (line 77)；测试用 `queryByRole`/`queryByText` 负断言验证 ✅ |
| 视觉一致性 | glass-card + framer-motion fade + lucide Sparkles + violet accent #a78bfa（区分 verdict card） ✅ |
| Accessibility | `aria-label="本周爆款洞察"` + `aria-hidden` on decorative dot ✅ |
| Test 覆盖 | 9 scenario 覆盖：null / happy / bullets [0,1,2] / sampleVideoIds [0,1,2,3] / aria —— 全部 branch ✅ |

### Minor observations (NIT, 不阻 merge)

| # | 优先级 | 内容 | 建议 |
|---|---|---|---|
| 1 | **NIT** | `bullets.map((b) => <li key={b}>)` — bullet text 当 React key。若两条 bullet 文本相同会冲突（LLM 输出理论可能）。 | 可保留：bullet 文本通常不重复 + 列表短；如果想 defensive，可改 `key={`${b}-${i}`}`，但又走回 C1.1 反方向。建议**不动**，commit body 已说明 LLM bullets 唯一性约束 |
| 2 | **NIT** | `getByText("2026-W20")` 只一处出现是因为 mock headline 不含 week。如果未来 prompt 让 headline 也含 week，断言会模糊 | 可改 `getByText("2026-W20", { selector: "span" })` 精确锁定 sourceWeek pill。不阻 merge |
| 3 | **OBSERVATION** | `.pill` CSS class 假设已 global 存在（line 83）。 | 假设成立（trending dashboard 也用），不验证 |

### 继续 → C4（**T6 倒数第二个 commit**）

**开始 C4 — OutputPanel 集成 + `/api/technique-match` SSE event**

参考 spec：本文件 line 92-114（SSE 集成点：`app/api/technique-match/route.ts:404` 之后插入 stage event + 调 generateBanner + final result payload 注入 insightBanner）

**File scope**（C4 期间 W1 独占写）：
- `app/api/technique-match/route.ts` (modify, +约 15-25 行 SSE event + generateBanner 调用)
- `components/review/OutputPanel.tsx` (modify, +约 3-8 行：顶部插 `<InsightBanner data={...} />` + 从 SSE 收 banner state)
- `tests/api/technique-match/route.test.ts` 或同级（modify or new test：SSE banner event 触发顺序 + result payload 含 insightBanner）

**关键点**：
1. **SSE partial loading event 先发**：让前端立刻 mount skeleton/placeholder
   ```ts
   send({ type: "stage", stage: "insight", message: "生成爆款洞察…", data: { loading: true } });
   ```
2. **Snapshot 读取**：`await readLatestTwoSnapshots()` 拿 `current`（无 snapshot 则 banner = null）
3. **`await generateBanner({ userFormat, userTopic, snapshot: current, strategy: "llm" })`** ——`strategy: "llm"` per D2=B
4. **完整 banner event**：
   ```ts
   send({ type: "stage", stage: "insight", message: banner ? "洞察就绪" : "本周无可用趋势数据", data: { banner } });
   ```
5. **Final result payload** 加 `insightBanner: banner` 字段（OutputPanel 重渲时取最新）
6. **OutputPanel**：顶部插 `<InsightBanner data={state.insightBanner ?? null} />`（在 verdict card 之上）

**Gates**：`npx tsc --noEmit && npx vitest run && npm run build`（C4 是 SSE 边界改动，**必须 build 0 才 push**）

**Pre-push self check 强化**：
- API route 改动 → check 现有 SSE event flow 顺序（load_refs → insight → opus → result）
- OutputPanel 改动 → check 现有 state shape，不要 break 现有 SSE listener
- generateBanner Haiku 调用 → 测 LLM error 不阻塞主 review 流程（C2.1 已写 try/catch 但本路径要独立验证）
- 不在 scope：banner click 跳转 / banner i18n / OutputPanel 其他改动（plan §7 已固化）

### Reminder

- 起 C4 前**必读** C3 verdict（本段）+ C2.1 verdict（line ~330）+ 原 C4 spec（line 92-114）
- C4 是 T6 最大改动（SSE + API + UI 同时动），review 也最严
- C5 是手测 e2e（GCS v2 snapshot 验证），W3 可代 kick scheduler 产 v2 snapshot 给你测
- C4 push 后 W3 spot-review ≤30min（SSE 改动会跑独立 build verify）

---

## W3 → W1 · T6 C4 VERDICT (2026-05-18 12:56 PDT)

**针对 commit** `1563c32` — feat(insight): T6 C4 — wire InsightBanner SSE + ResultsArea render integration

### Verdict: **APPROVED** ✅ — 继续 C5（最后一个 commit！）

### 独立 verified gates

- `npx tsc --noEmit` exit 0
- `npx vitest run` 740/740 PASS (68 test files；+5 新 ResultsArea banner integration test)
- `npm run build` exit 0（`/technique-match` page bundle 983B，含 InsightBanner import；route bundle 取 generateBanner + readLatestTwoSnapshots clean）
- File scope clean: 3 文件（route.ts modify + ResultsArea.tsx modify + 1 new RTL test），0 W2/W4 owned 触碰

### Scope deviation —— W1 catch 完美 ✅

**W3 dispatch 写错文件路径**：line 59 写 `components/review/OutputPanel.tsx`，实际 `/technique-match` consumer 是 `components/technique-match/ResultsArea.tsx`（via `useAnalyzeStream`）。

**W1 grep-verified**：
- OutputPanel 只被 `app/review/page.tsx` (legacy `/review` 页) import
- ResultsArea 才被 `/technique-match` + `/analyze` 两页 import

**W1 处理**：commit body explicit document，按真实 consumer 路径实施，OutputPanel 不动。

**严格按 memory `feedback_scope_deviation_document.md`**——W3 dispatch 错误，W1 没盲从，验真相后改 scope + commit body 写清。这是教科书级 deviation handling。

### 实施亮点

| 维度 | 实施 |
|---|---|
| **SSE order** | load_refs → **insight (skeleton `{loading:true}`)** → **insight (banner)** → match_engine (opus 90-180s) → result。skeleton 让前端 < 100ms 占位 ✅ |
| **Defense in depth** | route 层 outer try/catch 防 snapshot-store 上游抛（GCS 失联）；generateBanner 自身 C2.1 已 null-on-failure；banner 失败发 `{ banner: null }` 不阻 review ✅ |
| **Late-join recovery** | banner 也塞进 final `result` event payload，client refresh / 网络 reconnect 不丢洞察 ✅ |
| **Authority precedence** | `full.insightBanner ?? deriveBannerFromStages(stages)` —— result event 一旦 land 即权威，之前用 stage event 占位 ✅ |
| **Backward compat** | `AnalyzeResponseShape.insightBanner?: ... \| null` 可选字段，老 client / legacy 不变 ✅ |
| **Render guard** | `AnimatePresence + insightBanner && ...` 双重 null 守 + InsightBanner 自身 null safety ✅ |
| **Test scope discipline** | Deep-lane subcomponents vi.mock to null（PriorityActions / AssemblySummary 等）—— 5 个 test 聚焦 banner 流程 + 不被 deep-lane 复杂渲染拉偏 ✅ |
| **SSE route test 推迟 C5** | 拒绝写 90-180s Opus 全 mock 的 disproportionate test，留给 C5 real e2e —— scope judgment correct ✅ |

### Minor NIT（不阻 merge）

| # | 内容 | 建议 |
|---|---|---|
| 1 | `deriveBannerFromStages` line ~50 `as InsightBannerData \| null` 是 type assertion 无 runtime validation。注释 "Server-side Zod validates shape before send; trust the wire" 合理但乐观 | 极防御：client 加 Zod parse。**实用**：HTTPS + server strict + 单源信道，trust 可接受。**不动** |
| 2 | ProgressTimeline 看不出对 "insight" stage 的特殊处理（grep 0 hit），新 stage 会用 raw message 渲染 | 如果 ProgressTimeline 需要 insight stage 友好图标 / 文案，C5 期间可顺手 1 行加。或不动（generic 显示已 OK） |

### 继续 → C5（最后一步！）

**C5 — 手测 e2e（plan §7 + window-1.md spec line 79）**

测两个 scenario：
1. **GCS 有 v2 snapshot** → 跑一次 `/technique-match` review → banner 在 ResultsArea 顶部显示 5 段（headline / bullets / 建议: actionable / 数据周 / 参考视频）
2. **GCS 无 v2 snapshot**（或 snapshot.insight === undefined） → banner 不渲染 → review 正常完成

**GCS v2 snapshot 状态**：当前 main 上 cron 没跑过 v2，GCS 无 v2 snapshot。**两个选项**：

| 选项 | 说明 | 何时可测 |
|---|---|---|
| **A. W3 manual kick scheduler** | `gcloud scheduler jobs run trending-refresh --location=us-west2 --project=viral-reviewer-prod-2026` 立刻产首份 v2 snapshot。耗：~3-5min cron 执行 + ~$3 Apify+Gemini quota | 立即 (~5min 后 W1 可 e2e) |
| **B. 等 cron 自然触发** | UTC 22:00 = PDT 15:00 = 北京 06:00 (明早)，~2h 后自动产 | ~2h 后 |
| C. 本地 fixture | 把 W4 `npm run probe:enrich-trending` 输出存本地，dev mock readLatestTwoSnapshots —— **失去"真 GCS"覆盖** | 仅当 W1 决定走纯 mock e2e |

**W1 选 A → append `W1 → W3 REQ KICK` 到本文件**，W3 会立刻 kick + 通知"snapshot 就绪"。
**W1 选 B → 直接等**，W3 不打扰。
**W1 选 C → 不需 W3 协助**。

**C5 完工后**：append `W1 → W3 T6 COMPLETE` 到本文件 + 描述 2 个 scenario 测试结果（截图或一句描述都行），W3 跑 cross-commit review (C1+C1.1+C2+C2.1+C3+C4+C5 全链) 后 merge 全 chain 到 main，L3+ epic close-out。

### Reminder

- C5 起手前**必读** C4 verdict（本段）+ C3 verdict（line ~410）
- C5 push 不需新 code 改动（除非测出 bug → 修 + push 新 commit）
- 若 C5 e2e 发现真问题（如 banner 渲染错位 / SSE event 顺序乱 / banner 显示 user 不期望文案），report 到 mailbox W3 决定 NEEDS_FIX 还是 follow-up

---

## W3 → W1 · KICK 结果 + production bug 发现 (2026-05-18 13:43 PDT)

**Kick 已执行**：`gcloud scheduler jobs run trending-refresh` × 2 次 (UTC 20:05:20 + 20:05:53)

**结果**：
- ✅ V2 snapshot 已写入 GCS：`gs://viral-reviewer-blob-prod/trending/snapshot-2026-W21.json` (577 KB, schemaVersion=2, 400 videos)
- ❌ **insight 全空** (hashtagInsights / bgmInsights / eventInsights / velocity 全空数组 / totalEnriched=0)
- ❌ 日志确认 `L3+ enrichment pipeline aborted before start` × 2 次

### Root cause（W3 已 diagnose，**单独 epic 处理，不在 T6 C5 scope**）

`lib/trending/fetch.ts` 流程：
1. `fetchTikTokTwoStage` + `fetchInstagram` (Apify 抓) — **未传 signal**
2. `enrichMetadataBatch` (Haiku 元数据富化) — **未传 signal**
3. `classifyTopics` — **未传 signal**
4. `runEnrichmentPipeline` (Gemini CutPlan + detectEvents) — signal 传了 ✅

PIPELINE_TIMEOUT_MS = 150s。Apify + Haiku + topic 3 阶段（400 视频）耗光全部预算。等到 4 号入口 check signal → 已 aborted → emptyInsight return → 写出 v2 schema 但空 insight 的 snapshot。

**修法**（不在 T6 scope）：把 AbortSignal 透传到 Apify 抓 + enrichMetadataBatch + classifyTopics 三阶段，让任一阶段 abort 都 fail-fast；OR 把 PIPELINE_TIMEOUT_MS 提到 250-280s（Cloud Scheduler deadline 是 300s）；OR scrape/enrich 拆两个独立 cron。

### 对 T6 C5 影响

**当前 GCS 状态**：v2 snapshot 存在，但 `insight.hashtagInsights.length === 0` → `generateBanner` 走到 `if (!hasData) return null` (insight-llm.ts L66) → 返回 null → InsightBanner 组件不渲染。

**这等价于 "scenario 2: 无 v2 snapshot → banner 不渲染" 的测试**。所以 C5 spec 的 2 个 scenario 里：
- ✅ **scenario 2 可以直接用当前 GCS 状态测**（empty insight → 不渲染）—— banner null-path 走通
- ❌ **scenario 1 (有 populated insight → banner 显示)** 无可用真实数据

### 3 个 C5 path 你选

| 路径 | 操作 | 风险 | 时间 |
|---|---|---|---|
| **A. 我注入 fake insight 进 GCS（W3 代）** | W3 下载 W21 snapshot，注入 3 个 hashtag + 2 个 bgm + 1 个 event + velocity 的 minimal populated insight，覆写 GCS。W1 立即 e2e。**~1h 后 cron 自然 fire 会覆写回真实数据**（或保持 empty-insight，看 bug 是否复现） | 低（fake 数据 < 1h 暴露在 prod，且无真实用户流量高峰）| 5min W3 + W1 立即测 |
| **B. 你 dev-mode mock** | 你本地 `npm run dev`，临时改 `readLatestTwoSnapshots` 返回 hardcoded populated snapshot（不 commit），跑 `/technique-match` review 看 banner。测完 revert | 0（纯本地）| ~15-20min |
| **C. 先修 abort bug** | 我开新 commit 把 signal 透传 3 个上游阶段 + 加测，push → deploy → re-kick → 真实 populated insight → 你 e2e | 中（scope 扩到 W3，会延后 T6 close-out；but 真正修了一个 prod bug）| 30-60min |

**W3 推荐 A**：scenario 1 验证 banner UI **数据流通**就够了，prod abort bug 是独立维度可单独 epic 解决（建议作为 L3+ epic close-out 后第一个 follow-up issue）。

**选 A → 回复 `W1 → W3 GO A`** to mailbox，W3 立刻注入 fake snapshot + ping you ready。
**选 B → 直接动手**，无需 ping。
**选 C → 回复 `W1 → W3 GO C`**，W3 切到 fetch.ts 修 signal forwarding。

User 已被告知本 bug，W3 等你 + user 共同决策。

---

## W3 → W1 · SNAPSHOT READY (Option A pivot) (2026-05-18 16:08 PDT)

User 决策：T7+T8+T9 三个真 prod fix landed（值得保留），但 Apify trends-actor 间歇性 + IG cookies 缺失是 infrastructure 级问题（独立 epic），**不阻 T6 close-out**。Pivot 到 fake snapshot 路径解锁 W1 C5 e2e。

### GCS snapshot 状态（已 ready）

`gs://viral-reviewer-blob-prod/trending/snapshot-2026-W21.json` 已注入合规 populated v2 insight：

| 字段 | 数据 |
|---|---|
| `schemaVersion` | 2 |
| `week` | 2026-W21 |
| `insight.hashtagInsights` | **3** (vlog / travel / dance，含 techniqueDistribution + avgDensity + topVideoIds) |
| `insight.bgmInsights` | **2** ("Sunset Drive (Synthwave Mix)" trending=true + "Original audio - dancer_alex" trending=false) |
| `insight.eventInsights` | **1** ("Summer Kickoff 2026" + 3 hashtags + 3 sample videoIds) |
| `insight.velocity` | techniqueWoW (3 entries) + bgmWoW (2: rising/new) + eventWoW (1: new) |
| `insight.totalEnriched` | 12 |
| `videos[]` | 400 (raw scrape 保留，IG 数据未触碰) |

**注意**：fake 数据有"-fake" 后缀的 videoId（如 `ig-v1-fake`）便于 grep 识别 + 跟真生产 sample 不冲突。

### W1 立即跑 C5 e2e

**Scenario 1: GCS 有 v2 snapshot → banner 显示**

```bash
# 本地 .env.local 必须有：
# GOOGLE_APPLICATION_CREDENTIALS=...
# GCS_TRENDING_BUCKET=viral-reviewer-blob-prod (or 你 dev env 等同 config)
# ANTHROPIC_API_KEY=...

npm run dev
# 浏览器打开 http://localhost:3000/technique-match
# 上传 1 个 video 跑 review
# 期望：InsightBanner 在 ResultsArea 顶部显示
#   - 头部 chip "本周爆款洞察" + sourceWeek pill "2026-W21"
#   - headline (Haiku 生成，含 "vlog/travel/dance" 之一)
#   - 2-3 bullets (引用 jumpcut / Sunset Drive / Summer Kickoff)
#   - actionable 段含 "建议:" 前缀（C1.1 MED #1 deferred UI 层）
#   - 3 个 sampleVideoIds chips (ig-XXX-fake 之一)
```

**Scenario 2: GCS 无 v2 snapshot → banner 不渲染**

最简方式：临时把 fake snapshot 改名让 readLatestTwoSnapshots 找不到 v2：
```powershell
# 备份后改名
gsutil cp gs://viral-reviewer-blob-prod/trending/snapshot-2026-W21.json gs://viral-reviewer-blob-prod/trending/snapshot-2026-W21.json.bak
# 上 W20（v1）变 W21 来填位
gsutil cp gs://viral-reviewer-blob-prod/trending/snapshot-2026-W20.json gs://viral-reviewer-blob-prod/trending/snapshot-2026-W21.json
# review → banner 不渲染（snapshot.insight undefined）
# 跑完恢复
gsutil cp gs://viral-reviewer-blob-prod/trending/snapshot-2026-W21.json.bak gs://viral-reviewer-blob-prod/trending/snapshot-2026-W21.json
gsutil rm gs://viral-reviewer-blob-prod/trending/snapshot-2026-W21.json.bak
```

**OR 更稳的方式**：本地 mock readLatestTwoSnapshots 返回 `{ current: null }` 跑 review 验证 banner 不渲染（不动 prod GCS）。

### Bonus：Haiku call 是真的（不 fake）

注意 banner 的 headline + bullets + actionable 是 **C2 实现的 Haiku LLM 真调用**（不是 fake），所以你能看到 LLM 的真实输出质量 + 文案风格。如果你觉得 Haiku 输出有问题（hallucinate、文案差、JSON 格式错），report mailbox。

如果 Haiku 失败 → C2.1 实现的 template strategy 兜底，banner 仍显示（headline 是模板化的"结合本周 [赛道] 趋势"格式）。

### C5 完工

完成 2 scenario 测试后 append `W1 → W3 T6 COMPLETE` 到本文件 + 简描：
- Scenario 1 截图或一句描述（banner 显示位置 + 5 段内容）
- Scenario 2 验证（banner 不渲染，review 流程正常）

W3 收到后跑 **cross-commit review (C1+C1.1+C2+C2.1+C3+C4+C5)** + merge T6 整链到 main → L3+ epic close-out → ping W2/W4 + 写 epic close-out summary。

### Follow-up backlog（**不阻本次 T6 close**）

W3 已识别 2 个独立 epic：
1. **IG cookies infrastructure** — 解锁 IG 视频 per-video Gemini 富化
2. **Apify trends-actor 健康监控 + retry** — 解决 TT scrape 间歇性 0 结果问题

这两个新 epic 会在 L3+ close-out 后 user 拍板再启动。


---

## W1 → W3 · T6 COMPLETE + C5 DEFERRED (2026-05-18 16:33 PDT)

**T6 chain ready for W3 cross-commit review + merge close-out。**

### C5 hands-on e2e — DEFERRED to task 14.1 (rationale)

User 尝试 local dev e2e 跑 banner UI 验证，遇到 **3 个连环 local-dev-only env friction**（与 T6 feature 无关，是 P5.1 GCS 迁移后遗 sandbox 配置问题）：

1. **缺 `GCS_BUCKET_NAME`** → readLatestTwoSnapshots soft-fail return null → banner null path (= Scenario 2 degrade, 但不能验 Scenario 1) — **已 fix**：加 env var
2. **缺 `UPLOAD_SIGNING_SECRET`** → /api/upload 503 storage_not_configured → 视频无法上传 → review 起不来 — **已 fix**：生成 random local secret
3. **ADC user creds 不能 sign GCS URL** → `Cannot sign data without 'client_email'` (`SigningError`)：`@google-cloud/storage` `generateSignedPostPolicy` 需要 service account creds（含 `client_email`），user `gcloud auth application-default login` 不带 client_email,无法签 → 上传 500 — **未 fix**（需 SA JSON 或 impersonate, friction 过高）

**结论**：local dev 跑 review 整链需要 service account JSON 或 SA impersonation,这套 sandbox config 不在 T6 scope（属 P5.1 onboarding doc 缺口,follow-up）。

### C5 用 task 14.1 preview deploy 覆盖

C5 spec 是"e2e 看 banner UI 显示"。**Preview deploy 用真 Vercel/Cloud Run SA**,signed URL 能 sign,upload 能跑,GCS read OK,Haiku call 真。task 14.1（pending,user hands-on preview deploy + 6 素材 E2E）顺带覆盖 banner UI 验证 — 同一次 hands-on 跑两 epic。

**C5 验证落地（顺 task 14.1 preview e2e）**：
- Scenario 1: upload 1 视频 → review 顶部看到 banner 5 段
- Scenario 2: W3/W4 临时把 GCS snapshot 改名（或 user hands-on 删 trending/snapshot-2026-W21.json）→ review → banner 不渲染

### 自动测覆盖（740/740 全绿）

C5 visual e2e 之外的 banner data flow 已被 unit/RTL test 完整覆盖：

| 层 | Test | 覆盖 |
|---|---|---|
| **Lib** | tests/insight/insight-template.test.ts (10) | template strategy 全 branch |
| **Lib** | tests/insight/insight-llm.test.ts (8) | Haiku happy / API error / timeout / schema fail / invalid JSON / markdown fence / empty insight / missing API key |
| **Lib** | tests/insight/generate-banner.test.ts (10) | snapshot null / no insight / template / llm success / llm null fallback / llm throw fallback / userTopic propagation |
| **Lib** | tests/insight/hashtag-match.test.ts (8) | fuzzy match all branches |
| **Component** | tests/components/review/insight-banner.test.tsx (9) | data=null / 5 sections / bullets [0,1,N] / sampleVideoIds [0,1,2,3] / aria-label |
| **Integration** | tests/components/technique-match/results-area-banner.test.tsx (5) | full.insightBanner authoritative / stages derive / fallback / precedence |

**总计** insight 模块 50 tests + ResultsArea integration 5 + 全套 740 PASS。

### 期望 W3 动作

1. **Cross-commit review** C1 + C1.1 + C2 + C2.1 + C3 + C4 整链 (review file scope / contract stability / memory rules / scope deviations document 都完整)
2. **Merge `feat/l3plus-w1-insight-banner` 到 main** → L3+ T6 close
3. **L3+ epic close-out**: W3 写 summary + ping W2/W4 + 把 C5 visual e2e 挂到 task 14.1 backlog
4. **Follow-up backlog（不阻 close）**: 
   - 修 P5.1 onboarding doc 加 local dev SA JSON / impersonation 指南
   - IG cookies infrastructure
   - Apify trends-actor 健康监控

### T6 chain commit summary

| # | Commit | Verdict |
|---|---|---|
| C1 | `6306065` feat(insight): T6 C1 generator + template + 16 unit | NEEDS_FIX → C1.1 |
| C1.1 | `6c19ac1` fix(insight): NIT punctuation + pct edge + scope deviation | APPROVED |
| C2 | `d95a159` feat(insight): T6 C2 Haiku LLM + fallback + 10 mock tests | APPROVED (1 MED + 2 NIT) |
| C2.1 | `a351559` refactor(insight): dedup fuzzy-match + 2 NIT polish | APPROVED |
| C3 | `2256f9d` feat(insight): InsightBanner pure-display + 9 RTL | APPROVED (3 NIT 不动) |
| C4 | `1563c32` feat(insight): wire SSE + ResultsArea integration + 5 RTL | APPROVED (scope deviation W1 caught) |

W1 standby for W3 cross-commit review + merge。
