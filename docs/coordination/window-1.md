# 给窗口 1 的指令

> 写于 2026-05-14 · 针对 `main` = `6474b72` · 来自窗口 3 协调者

## 状态

多视频 technique-match 计划修订版已通过窗口 3 review 并 merge 进 `main`（commit `e75f980`）。
你的分支 `worktree-capcut-link` 现在落后 main。

## 开工动作

1. `git pull origin main --no-rebase`
   （拉到：你的计划修订 merge + 窗口 2 的 P1.11/P1.12，`main` 现在 = `6474b72`）
2. `/compact`
3. 开始 **Task 1**

## Task 1 — 契约冻结 + 共享类型/schema

按 `docs/superpowers/plans/2026-05-14-multi-video-technique-match.md` 的 Task 1 节执行。
重点是 review 已固化进计划的两条契约级修正：

### 【C1】两个 route 的 Zod schema 不能简单改字段名

- 新增 `videoUrls` / `videoFileNames` 作为新的 `.optional()` 字段
- 同时把 `videoUrl` / `videoFileName` 保留为 `z.preprocess` 派生的 `.optional()` 输出字段
  - 传 `videoUrls` 则派生 `videoUrl = videoUrls[0]`
  - 传旧 `videoUrl` 则原样保留并归一出 `videoUrls = [videoUrl]`
- 运行逻辑一行不动 —— `route.ts:67-90` 解构 `videoUrl` + `prepareAssets(videoUrl)` 必须仍能编译运行

### 【C2】Task 1 完全不碰 `useAnalyzeStream.ts`

- `SubmitArgs` 输入侧 → 留到 Task 3
- `partial` 形状 / `AnalyzeResponseShape` → 留到 Task 4（与后端发射同步改）

`types.ts` 的改动全是加性/放宽（新增 `AssemblyClipSchema` / `AssemblyTimelineSchema`、
`assemblyTimeline` 加 `.nullable().optional()`、`userVideoAt` 放宽），安全。

## 验证（Task 1 的硬门槛）

- `npx tsc --noEmit` 必须绿 —— 这是「C1 兼容层成立、运行逻辑未被破坏」的硬证明
- `npx vitest run` 全绿
- 手写带/不带 `assemblyTimeline` 的 fixture 喂 `TechniqueMatchingResultSchema.parse` 都过
- 旧形态请求体（只带 `videoUrl`）喂两个 route 的 Zod schema，`parsed.data.videoUrl` 仍有值

## 完成后

commit（`feat: Task 1 ...`）→ push → 等窗口 3 merge → `git pull origin main --no-rebase` → `/compact` → Task 2
