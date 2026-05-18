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
