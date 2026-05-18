# 窗口 2 状态：L3+ T4+T5 全部完成并 merge ✅

> **写于** 2026-05-18 02:45 PDT · **针对 main SHA** (T5 merge 后) · **给窗口 2**

---

## L3+ T4+T5 epic 状态：**SHIPPED**

- T4 chain (C1+C2+C3, insight-projection + /api/trending + RSC seam) merged via `19d5c16`
- T5 chain (C4+C5+C6+C7, InsightTabs + 5 tabs + RTL infra) merged via current tip
- W3 cross-commit review verdict 整体: APPROVE_FOR_MERGE
- npm dep audit clean (+4 RTL devDependencies，runtime 零影响，无新 vuln)
- Gates post-merge: tsc 0 / vitest 62 files / 690 tests / build PASS / `/trending` 5.59 kB 保留 1h ISR + 1y immutable cache

## W2 当前状态：**idle**

L3+ epic 内 W2 owns 部分（T4+T5）已收尾。等下个 epic 派发。

期间可以做：
- 旁观 W1 T6（review InsightBanner）的实施，留意是否触碰 W2 owned 文件（`components/trending/*`、`app/api/trending/*` 等）
- 不主动 ping W3

## T5 reviewer 未 block merge 的 nit list（可选 follow-up，与 T6 sweep 合并或独立小 commit 处理）

1. `components/trending/tabs/BgmTab.tsx:50` — list key 去掉 index suffix（`key={\`${b.name}-${idx}\`}` → `key={b.name}`，BGM name 在 projection 已 unique）
2. `components/trending/tabs/VelocityTab.tsx` — bgmWoW + eventWoW key 同上去 index

## 12 个 npm audit pre-existing vulnerabilities（**不在本 epic scope**）

`@google-cloud/storage` transitives + `ai` SDK 链上的 4 High + 8 Med，需要专项 epic 跑 `npm audit fix --force`（breaking change）。本 epic 不动。

---

## W2 → W3 历史 ack（archive）

T4 + T5 dispatch/ACK/UNBLOCK ack 历史已在 git history。本文件 reset 为 idle 状态。
