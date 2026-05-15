# 给窗口 1 的指令

> 写于 2026-05-15 · 针对 `main` = `5d98a5f` · 来自窗口 3 协调者

## Task 3 已 merge ✅

`worktree-capcut-link` tip `1c3d7db` 已合入 main（merge commit `5d98a5f`）。本次合入：

- `1c3d7db` — feat(technique-match) Task 3：前端多视频上传层

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 175/175
- `npm run build` → 编译成功（technique-match / analyze 路由都静态预渲染）

## review 笔记

多文件上传层实现干净，几处亮点：

- **all-or-nothing gate**：`Promise.allSettled` 并行上传后,任一失败就 `setStageError` 返回,**不进 `onSubmit`** —— 避免半成功素材污染后端分析。partial-failure 消息逐条列出（`${name}（${reason}）`），用户能定位具体失败素材。
- **dedupe 用 name+size**：`fileKey = ${name}|${size}`,稳健的轻量去重。文件名相同但 size 不同的（重命名后再选）会被当作不同素材 —— 与人类直觉一致。
- **MAX_FILES=6 截断在 `setVideoFiles` 内部**:即便用户一次拖入 100 个文件,`merged.slice(0, MAX_FILES)` + 截断 messages 给出明确反馈,UI 不会卡死。
- **`input.value=""` 重置**：选完同一批文件再选一次仍能触发 `onChange`,这个细节 React 多选 input 容易漏。
- **过渡 shim 透明**：`page.tsx` 用 `videoUrls?.[0] ?? null` 转给 ResultsArea,plan 注释里写明 Task 13 才 arrayify ResultsArea —— 阶段切分清晰,review 不会困惑为啥单视频字段还在用。

## 一个 follow-up（不阻塞，Task 4 / 13 自然消化）

`useAnalyzeStream.partial` 与 `AnalyzeResponseShape` 仍是单视频 shape —— 你已经在 commit message + 文件 jsdoc 都写了「Task 4 与后端发射侧同步落地」,记录无误。Task 4 的 backend 接口侧改完,记得回头把 useAnalyzeStream 的 `partial` / `setPartial` 也 arrayify,**不要遗留到 Task 13** —— Task 13 只动 ResultsArea。

## 浏览器烟测试

commit message 里你已经标注「Not verified in browser (no headless env)」。我这边窗口 3 也没有 headless 浏览器环境,不阻塞 merge。用户那边方便时按 plan validation list 跑一遍：
- 多选（select 多文件一次）
- 删除（点 X 移除单个文件,index 重新排号）
- >30MB 文件跳过（带 size 提示,不进列表）
- >6 文件截断（消息提示截断了几个）
- 并行上传（progress 状态显示）
- partial-failure 消息（其中一个失败,全部不进 onSubmit + 列出失败素材）

## 下一步：Task 4 放行

按 per-task 工作流：
1. `git pull origin main --no-rebase` 同步到 main 最新（`5d98a5f`）
2. 读本文件确认 SHA 是新的 + 消化上面的 follow-up
3. 开 Task 4「后端多视频接收 + 并行 Gemini 分析」（按 plan 的 backend 接收侧改动）

Task 4-14 串行，按既定 per-task 闭环。
