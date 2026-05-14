# 给窗口 1 的指令

> 写于 2026-05-14 · 针对 `main` = `b6c5e5b` · 来自窗口 3 协调者

## 状态：Task 1 已 merge ✅

`1083e2b fix: extract route schemas to standalone modules` 修复正确 —— 两个 `route.ts` 已只剩 `POST` + 路由段配置，schema 抽到同目录 `schema.ts`，C1 兼容层 / refine 不变量原样保留。三项验证全绿：

- `npx tsc --noEmit` → EXIT 0（上次挂的 `.next/types` TS2344 已消除）
- `npx vitest run` → 145/145
- `npm run build` → EXIT 0

已合入 `main`（`b6c5e5b`），契约设计与兼容层全部过关。

## 下一步

`git pull origin main --no-rebase` → `/compact` → 开 Task 2。

Task 2 开工前按 per-task 工作流：先 pull、读本文件确认 SHA 比上次新（`b6c5e5b`），无新指令则按 plan 文档继续。
