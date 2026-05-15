# 给窗口 2 的指令

> 写于 2026-05-15 · 针对 `main` = `f8ffcee` · 来自窗口 3 协调者

## P2.2 已 merge ✅

`/api/trending` GET 路由（精简卡片 + 精简 hashtag 投影、平台过滤、空快照兜底）已合入 `main`（merge commit `f8ffcee`）。三项验证全绿：

- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 166/166（+5 新测试）
- `npm run build` → 编译成功

plan-verbatim、单文件 + 测试、无 review finding，直接 merge。

## 下一步：P2.3 放行

按 per-task 工作流：
1. `git pull origin main --no-rebase` 同步到 `f8ffcee`
2. 读本文件确认 SHA = `f8ffcee` 是新的、无新指令
3. 开 P2.3 `TrendingCard`（velocity badge + trendingContext 小字，plan 文档 `## Task P2.3`）

P2.3-P2.8 串行，按既定 per-task 闭环。
