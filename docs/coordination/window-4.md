# 窗口 4 任务派发：L3+ 富化 pipeline（T1+T2+T3）

> **写于** 2026-05-17 23:30 PDT · **针对 main SHA** `cacf0e5` · **给窗口 4**
>
> 完整 scope 在 `docs/coordination/_W3_l3plus_plan.md`（必读）。本文件是 W3 派发的实施指令 + 决策固化。

---

## 你领的 task

**3 个连续 task（W4 一次性领，按顺序做）**：
- **T1** — 单视频富化 helper `enrichTrendingVideo` + `enrichBatch`（plan §2）
- **T2** — 聚合层 + `TrendingInsight` schema + v1→v2 兼容（plan §3）
- **T3** — cron route 编排 + v2 snapshot 持久化（plan §4）

**估时**：合计 4 工日（T1=1.5d + T2=1.5d + T3=1d）。

**分支建议**：`feat/l3plus-w4-enrichment`（一个分支贯穿 T1→T2→T3，按 task 边界 commit）。

---

## User 已拍板的决策（影响你的实施）

| 决策 | 选项 | 对你的影响 |
|---|---|---|
| **D1 · Event detection** | **B = LLM** | T2 `event-detector.ts` 必须双 strategy：keywords + Gemini Pro。先 keywords 兜底，富化阶段后追加 1 次 Gemini Pro call 输出 active events（loose Zod schema） |
| **D5 · 富化失败处理** | **B = retry 1 次** | T1 `enrichTrendingVideo` 内部对 transient error（timeout/5xx/network）retry 1 次，exponential backoff 5s；non-retryable 立即失败 |

D2/D3/D4 不影响 W4 工作。

---

## 跨窗口依赖与 file lock

**W4 独占写**（T1+T2+T3 期间，其他窗口不许动）：
- `lib/trending/enrich-trending-video.ts`（new）
- `lib/trending/enrich-batch.ts`（new）
- `lib/trending/insight-schema.ts`（new）
- `lib/trending/aggregate.ts`（new）
- `lib/trending/event-detector.ts`（new）
- `lib/trending/event-keywords.ts`（new）
- `lib/trending/select-for-enrichment.ts`（new）
- `lib/trending/types.ts`（modify，v1→v2 schema bump）
- `lib/trending/velocity.ts`（modify，schemaVersion 比较窗口）
- `lib/trending/fetch.ts`（modify，T3 末追加 insight pipeline）
- `app/api/cron/trending/route.ts`（modify，T3 加 AbortController 150s timeout）
- `scripts/probe-enrich-trending.ts`（new）
- `package.json`（modify，scripts 加一行 `probe:enrich-trending`）
- `tests/trending/enrich-*.test.ts`, `tests/trending/aggregate.test.ts`, `tests/trending/event-detector.test.ts`, `tests/trending/insight-schema.test.ts`（new）
- `tests/trending/fetch.test.ts`（modify）

**只读不动**：
- `lib/video/gemini-understand.ts`（W2 owned）
- `lib/video/ffprobe-meta.ts`（shared）
- `lib/cut-plan/schema.ts`（shared）
- `lib/review-engine/types.ts`（shared）

---

## 提交节奏（强制）

| Commit | 内容 | gates |
|---|---|---|
| C1 | T1 — `enrichTrendingVideo` + unit test | tsc 0 / vitest 全绿 |
| C2 | T1 — `enrichBatch` + retry 逻辑 + batch unit test | tsc 0 / vitest 全绿 |
| C3 | T2 — `insight-schema.ts` + v1→v2 兼容 + schema unit test | tsc 0 / vitest 全绿 |
| C4 | T2 — `aggregate.ts` + unit test | tsc 0 / vitest 全绿 |
| C5 | T2 — `event-detector.ts` keywords + LLM strategy + unit test | tsc 0 / vitest 全绿 |
| C6 | T3 — `fetch.ts` 串富化 + aggregate + persist + `select-for-enrichment.ts` | tsc 0 / vitest 全绿 / build 0 |
| C7 | T3 — cron route AbortController 150s timeout + probe script + package.json scripts entry | tsc 0 / vitest 全绿 / build 0 / probe 手测 |

**每个 commit push 之前**：
- 跑 `npx tsc --noEmit && npx vitest run && npm run build`
- 必读 commit N 的 W3 nit list 再起 commit N+1（memory `feedback_read_prev_commit_nits_before_next.md`）
- pre-push reviewer **不准 skip** dep changes / module deletion / config files（memory `feedback_pre_push_reviewer_skip_dep_changes.md`）

---

## 必读 memory（防回归）

1. `llm-schema-looseness.md` — Gemini / Haiku 任何自由输出字段用 `z.string()` 不用 `z.enum()`，可空字段 `nullable.optional`
2. `stage2-failure-loses-stage1.md` — `enrichBatch` 必须把 stage 1（Apify 抓的）数据持久化，富化失败不能丢
3. `feedback_dep_removal_transitive_check.md` — 任何 npm dep 变动都要 fresh install audit
4. `feedback_hmac_token_implementation_defenses.md` — Zod schema `passthrough()` 做 forward-compat（v2 加新字段时老快照 parse 仍过）
5. `feedback_pre_push_reviewer_skip_dep_changes.md` — pre-push reviewer 必须看 config / dep 改动

---

## 验收 gates（W4 全部 task 收尾时 W3 会跑）

- `npx tsc --noEmit` exit 0
- `npx vitest run` 全绿
- `npm run build` exit 0
- `npm run probe:enrich-trending` 真跑一次（W4 自测，输出 JSON 含 insight 字段）
- curl POST `/api/cron/trending`（带 `Authorization: Bearer $ADMIN_TRIGGER_SECRET`）响应 200 + body 含 `week / videoCount / insight`
- 老 v1 snapshot read 不崩（`tests/trending/insight-schema.test.ts` 锁定）

---

## 不在你 scope 内的（W4 不许扩）

- ❌ `/trending` 看板页 UI 升级（W2 owns T5）
- ❌ `/api/trending` GET handler insight 投影（W2 owns T4）
- ❌ review InsightBanner（W1 owns T6）
- ❌ `loadReferenceCutPlans` 加 trending 池（plan §13 明确不在 scope）
- ❌ 移除任何现有 npm dep
- ❌ Apify scraper 切换其他平台

---

## 进度上报

- 每个 commit push 后 W3 monitor 会自动检测（pattern watch `refs/heads/feat/l3plus-*`）
- C3 / C5 / C7 push 后 W3 会主动 review，有 nit 通过本文件追加 nit list
- 任何 blocker / 需要 W3 决策 → append 一段到本文件（标注 `W4 → W3 QUESTION`）

---

**W4 → W3 ack 模板**（你领完 task 后回复一句话到本文件）：

```
W4 ACK 2026-05-XX: 收到 T1+T2+T3 派发，确认决策 D1=B/D5=B，分支 feat/l3plus-w4-enrichment 已建。
预计 D4 末完成 C7 push。开始 T1 C1。
```
