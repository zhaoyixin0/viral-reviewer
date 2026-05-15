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

---

# Task 4 已 merge ✅ — Task 5 放行

> 写于 2026-05-15 · `main` = `8c00597` · 来自窗口 3 协调者

## merge 内容

`worktree-capcut-link` tip `14f78de` 已合入 main（merge commit `8c00597`）。本次合入：

- `14f78de` — feat(technique-match) Task 4：N-video parallel analysis + per-video partial stream

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 175/175
- `npm run build` → 编译成功（technique-match / analyze 路由静态预渲染保留）

## review 笔记（亮点）

**Task 3 follow-up 完整落实，没拖到 Task 13** —— useAnalyzeStream + AnalyzeResponseShape 一起 arrayify 落地，Task 13 留给纯 N-card 渲染。这是上次 review 期望的边界，干得漂亮。

其他实现亮点：

- **schema preprocess 双向归一**：`videoUrl` 旧字段保留，`videoUrls` 新数组双向补全，旧客户端零迁移 ship 即生效；C1 兼容层注释 + JSDoc 清晰。
- **per-promise catch 内嵌 `.then(onFulfilled, onRejected)`**：`Promise.all` 永不 reject，per-video 失败发 `analyze_error` stage，分析成功立即发 `partial`。`AnalyzeOutcome` 联合类型 + `flatMap` 提取 successful 用得很 idiomatic。
- **failedVideoIndexes 索引语义清晰**：按上传全集 0-based，I6 契约严格遵守；`userPotentials` 同样按 superset index 留 null 占位 —— Task 13 渲染时遍历更简单。
- **`maxPollAttempts` 默认 60 keeps legacy / 多视频路由 24**：default 参数保留旧 caller 行为，test-safe；卡死视频 120s 内 fail 而不是 300s 拖整批。
- **`potentialsToDesiredTags` 新增不动单 potential 签名**：兼容 existing tests，N 视频 Set-union 去重逻辑 4 行干净。
- **modeOf 用 Map 保插入顺序**：`bestCount = -1` 初始保证首元素即使全 1 票也能正确返回（JS Map iteration order is insertion order，行为确定）。
- **useAnalyzeStream race 处理**：第一个 partial 到达时按 totalMaterials 预填 null，后续 spread 写入 —— 多个 partial 同 React batch 也安全。
- **ResultsArea 砍掉 `!` non-null assertion**：改用 type-predicate `find` + conditional render `{primaryPotential && <UserDiagnosis />}`，type-safe，CapCutExport 同步加 guard。
- **finally 块 `rm workDir recursive force`**：N 视频 input-{i}.mp4 都在 workDir 下，cleanup 一次到底。

## 一个 follow-up（不阻塞 merge，潜在 hardening）

`POST` 的 `videoUrls: z.array(z.string().url())` —— `z.string().url()` 接受任何合法 URL 协议（含 `http://localhost:XXXX/...`、`file://`、`gopher://`），server 端 `fetch(url)` 是 SSRF 攻击面。**这不是 Task 4 引入的**，Task 3 之前已存在，Task 4 只是 N 倍化了攻击面。

记一个 follow-up：

- 校验侧加 scheme allowlist：`videoUrl.startsWith("https://")` 或 `new URL(url).protocol === "https:"`
- 限定 host 为已知 blob storage / CDN domain（如果你的 `/api/upload` 始终生成同 origin blob URL）

不阻塞 Task 5/Task 4 闭环，但**进入 P3 review 前必须收口**（plan 的 P3 hardening pass 自然消化点）。

## 浏览器烟测试

commit message 标注「Not verified in browser (no headless env)」。窗口 3 也无 headless 浏览器。用户那边方便时跑一下 plan 探测点：

- N=6 Gemini 并行是否 429
- 总耗时 < 300s
- Gemini upload-side / generate-side 延迟分别观察
- 一个素材失败时前端 partials 渲染（null 占位） + analyze_error stage 消息显示
- 全失败时显示 "全部素材分析失败" error event

## 下一步：Task 5 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 main 最新（`8c00597`）
2. 读本文件确认 SHA 是新的 + 消化上面的 follow-up（SSRF hardening 留 P3）
3. 开 Task 5「N potential 编排进 matchTechniques 输入」

Task 5-14 串行，按既定 per-task 闭环。
