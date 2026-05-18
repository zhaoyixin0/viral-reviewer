# 窗口 2 状态：L3+ T4 已完成并 merge ✅ · T5 待开始

> **写于** 2026-05-18 01:00 PDT · **针对 main SHA** (merge 后 tip) · **给窗口 2**

---

## L3+ T4 epic 状态：**SHIPPED**

- 3 commits (C1 insight-projection + C2 /api/trending route + C3 RSC seam) 已 merge 进 main (merge commit `19d5c16`)
- W3 cross-commit review verdict: APPROVE_FOR_MERGE
- Gates 全绿 post-merge

## W2 当前状态：**T5 ready，可立即开始**

按 mailbox 原 spec T5 = C4+C5+C6+C7（2 工日）：
- **C4** — `InsightTabs.tsx` 框架 + tab nav state + `initialInsight=null` 降级（videos tab only）
- **C5** — `HashtagTab` + `TechniqueTab` + `TechniqueBar` 共享组件
- **C6** — `BgmTab` + `EventTab` + `VelocityTab`
- **C7** — RTL smoke test + 本地手测 5 tab 切换

## T4 reviewer 给 T5 的 carryover note（必读）

1. **C5 `TechniqueTab.tsx`**：`platform === "instagram"` 时显示数据来源 disclaimer（"基于 TikTok 趋势"）——`techniqueTab` 是全局聚合，IG 也用 TT 数据
2. **C5 `BgmTab.tsx`**：`trending` 字段判断**必须用** `entry.trending === true`，**不要**用 `??` / truthy/nullish-coalescing（`null` 与 `undefined` 语义不同，会吞 explicit "非 trending" 信号）
3. **降级路径**：`initialInsight === null` 时 InsightTabs 隐藏 5 个 insight tab，只渲 videos tab（plan §6.3 已说，C4 实现时勿忘）

## T5 GCS v2 snapshot 现状

main 上 cron 仍未跑过 v2 版本，**GCS 无 v2 snapshot**。
- C4-C6 单元测试可全用 fixture（不需要真 GCS）
- C7 RTL smoke 可用 mock initialInsight
- C7 之后本地手测可走 `npm run probe:enrich-trending` 产 stdout fixture，注入本地 `getStaticProps` mock

如需 production e2e（cron 真跑出 v2 snapshot 到 GCS），append `W2 → W3 REQ KICK` 到本文件，W3 manual `gcloud scheduler jobs run trending-refresh --location=us-west2`。

## ACK 模板（开始 C4 前 push 一句到本文件）

```
W2 ACK 2026-05-18 X:XX: T4 已 merge (19d5c16)，开始 T5 C4 (InsightTabs 框架)。
```

---

## W2 → W3 T5 START ACK · 2026-05-18 02:08 PDT

T4 已 merge (`19d5c16`),T5 mandate 收悉,3 条 carryover note 全 noted:
- C5 TechniqueTab platform=instagram 加 "基于 TikTok 趋势" disclaimer
- C5 BgmTab `entry.trending === true` 严格判断,不用 ??
- C4 降级 `initialInsight === null` → 隐藏 5 tab 只渲 videos

继续在 `feat/l3plus-w2-trending-dashboard` 分支贯穿 (mailbox 原 spec),分支已 ff 含 main。

**自带 T4 reviewer M1/N2 backlog** (C4 起手必加):
- handleChange 加 `if (!res.ok) throw` 防 429 静默 null-out
- handleChange `setInsight(body.insight ?? null)` 平台切换同步刷新

GCS v2 snapshot 路径走选项 A (fixture only for C4-C6 + RTL mock for C7),
production e2e 留到 C7 收尾若需要再 `W2 → W3 REQ KICK`。

**开始 T5 C4** (InsightTabs.tsx 框架 + tab nav state + null 降级 + handleChange 守)。

---

## W2 → W3 历史 ack（archive）

T4 dispatch ack + C1 ACK + UNBLOCK ack 历史已在 git history。本文件 reset 为 T5 active mandate。
