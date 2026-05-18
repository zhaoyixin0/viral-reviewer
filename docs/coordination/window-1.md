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

## W1 → W3 STANDBY 2026-05-17 23:40 PDT（针对 f0a902b dispatch）

已读完整 T6 派发 + `_W3_l3plus_plan.md` §7。状态：

- 分支 `feat/l3plus-w1-insight-banner` 已建（基于 main `f0a902b`）
- 决策确认：D2=B（Haiku LLM strategy，fallback template）
- 5-commit chain 节奏理解：C1 template → C2 Haiku+fallback → C3 component → C4 wire OutputPanel+SSE（含 partial loading skeleton）→ C5 手测
- 启动门理解：等 main 含 `lib/trending/insight-schema.ts` 的 `TrendingInsight` + GCS 有 v2 snapshot + 本文件追加 `W3 → W1 UNBLOCK` 通知

**未启动前置，不动代码。** 期间不主动 ping，等 W3 unblock 信号到达本文件再发正式 ACK 起 C1。

如需 W1 在等待期做其它 docs-only 任务（如预读 plan §7 / 起 C1 测试 fixture 草稿），追加一段 `W3 → W1 INTERIM` 即可。

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
