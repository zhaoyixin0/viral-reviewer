# 给窗口 1 的指令

> 写于 2026-05-14 · 针对 `main` = `8337fe6` · 来自窗口 3 协调者

## 状态：Task 1 被打回 —— 有一处 tsc 阻塞缺陷，未 merge

你的 `725a96e feat: Task 1 ...` 已 review。契约设计（`AssemblyClip`/`AssemblyTimeline`、C1 兼容层、refine 不变量）全部过关，**但有一处硬错误导致 `npx tsc --noEmit` 失败、`npm run build` 也会挂**，所以窗口 3 没有 merge。main 现在只含窗口 2 的 P1.13（`8337fe6`），你的分支需要先修这一处再重推。

## 缺陷：route.ts 不能导出 Zod schema

为了让测试 import，你在两个 route 文件里 `export const RequestSchema` / `export const Schema`。
Next.js App Router 的 `app/api/*/route.ts` **只允许导出路由处理器（`POST` 等）和路由段配置（`runtime`/`maxDuration` 等）**。任何其它具名导出都会让生成的 `.next/types/app/api/.../route.ts` 报 `TS2344 ... does not satisfy the constraint '{ [x: string]: never; }'`。

实测 main 合并你的提交后：

```
.next/types/app/api/compile-capcut/route.ts(12,13): error TS2344 ... Property 'RequestSchema' is incompatible
.next/types/app/api/technique-match/route.ts(12,13): error TS2344 ... Property 'Schema' is incompatible
```

vitest 能过（145 绿）是因为 vitest 不走 `.next/types` 那层校验 —— 但 `tsc` 和 `build` 会。

## 修法：把 schema 抽到独立模块

1. 新建 `app/api/technique-match/schema.ts`，把 `InputSchema` + `Schema`（含 C1 `z.preprocess` 兼容层）整段挪进去，`export const Schema = ...`
2. 新建 `app/api/compile-capcut/schema.ts`，同样把 `InputSchema` + `videoFileNameField` + `RequestSchema` 整段挪进去
3. 两个 `route.ts` 改成 `import { Schema } from "./schema"` / `import { RequestSchema } from "./schema"`，**route.ts 里不再有这两个具名导出**
4. 测试 `tests/technique-matching/types-schema.test.ts` 的 import 改成：
   - `import { Schema as TechniqueMatchRequestSchema } from "@/app/api/technique-match/schema";`
   - `import { RequestSchema as CompileCapcutRequestSchema } from "@/app/api/compile-capcut/schema";`

schema 跟 route 同目录，co-location 不破坏；运行逻辑、C1 兼容层、refine 全部原样搬，不改逻辑。

## 验证（重推前的硬门槛）

- `npx tsc --noEmit` **必须绿** —— 这正是「route 不再有非法导出」的硬证明，上次就是这里挂的
- `npx vitest run` 全绿（145+）
- `npm run build` 绿

## 完成后

`git pull origin main --no-rebase`（拉窗口 2 的 P1.13）→ 修复 → 三项验证全绿 → commit（`fix: extract route schemas to standalone modules` 之类，可与 Task 1 提交分开或 amend 由你定）→ push → 等窗口 3 merge → `/compact` → Task 2
