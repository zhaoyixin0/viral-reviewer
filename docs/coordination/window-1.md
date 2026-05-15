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

---

# Task 5 已 merge ✅ — Task 6 放行

> 写于 2026-05-15 · `main` = `deddf04` · 来自窗口 3 协调者

## merge 内容

`worktree-capcut-link` tip `5f8128c` 已合入 main（merge commit `deddf04`）。本次合入：

- `5f8128c` — feat(technique-match) Task 5：N-potential Opus matching + assemblyTimeline

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 175/175
- `npm run build` → 22/22 pages OK，technique-match 路由保留静态预渲染

## review 笔记（亮点）

**双层 assemblyTimeline 防御** —— Opus prompt 把 `at / userVideoAt / sourceAt / fromAt / toAt` 写成硬禁字段（I2 命名契约），服务端 `sanitizeAssemblyTimeline` 再做 belt-and-suspenders：

- drop sourceVideoIndex 越界 / 引用 failedVideoIndexes / 引用 null potential 的 clip
- drop sourceStartSec ≥ sourceEndSec 的畸形（防 Zod refine 整次 reject）
- clamp sourceStartSec ≥ 0、sourceEndSec ≤ base.durationSec
- 反查回填 sourceVideoId（按 userVideoIds[index]）
- re-index `order` 为最终下标
- 首 clip 强制 incomingTransition = null
- recompute estimatedDurationSec = Σ(end - start)

**单点 clip 畸形再也撂不倒整次 parse** —— 这是「LLM 输出宽松、服务端兜底」的标准做法。比 Task 4 的 stage1/stage2 分离更主动。

其他实现亮点：

- **MatchEngineInput N-array I6 契约一致**：`userPotentials.length !== userVideoIds.length` runtime check 早抛，三数组 superset-indexed 不会跑出位移
- **零成功素材早抛**：`if (!primary) throw new Error("matchTechniques 需要至少一个成功的 MaterialPotential")` —— 上游 route.ts 已经在「全失败」时发 error stage，这里再 defensive 一次
- **`primary = find((p): p is MaterialPotential => p !== null)`**：与 Task 4 同模式，type-predicate find 取首个成功 potential 用于 fps / debug-dump path / raw.userVideoId 回填，**零 `!` non-null assertion**
- **`max_tokens` 16384 → 32000**：注释引「§Task 5 探测点」，N=6 + 5 refs + reports + assemblyTimeline + recommendedBgms 头部预算；不会再 Opus 中途 trunctate
- **payload 把 superset `index` 注入每个成功 potential**：Opus 编排时拿 index 当主键，与服务端 sanitizer 反查回填 sourceVideoId 闭环
- **prompt 多素材模式 reasoning 标 `素材 #<index>`**：避免 Opus 含糊提「用户的」导致跨素材汇总错位（reasoning 字段必须引用某份 potential 的字段）
- **trimRanges 多素材模式留空 []**：assemblyTimeline 已经表达「哪些段被保留」，trim 在多素材路径上交给 assemblyTimeline；CapCut compiler 在多视频路径以 timeline 为准（Task 7-8 切换）
- **probe-script 单视频 1-element 数组 wrap**：`userPotentials: [userPotential]` / `userVideoIds: [userPotential.videoId]` / `failedVideoIndexes: []` —— 单视频 probe 仍能离线跑，向后兼容 0 破坏
- **`raw.userVideoIds = userVideoIds`** 新字段：兼容 Task 13 N-card 渲染层；raw.userVideoId 仍保留指向 primary 兼容旧 client

## follow-up（不阻塞 merge）

- **SSRF hardening (Task 4 carry-over)**：`videoUrls: z.array(z.string().url())` 的 scheme allowlist + host pinning，建议与 P2 那边 trending UI 的 API boundary Zod / `res.ok` / a11y enhancement 一起，合并到 plan v4.1-review **P3 hardening pass** 同一改动里（API boundary hardening）。详见 docs/coordination/window-2.md 末段 P2.5 裁决「follow-up 收口节点」
- **Opus 实弹探测（user 侧）**：commit message 标注 "Not run (no Opus access / no headless)"，plan §Task 5 探测点列表：
  1. sourceVideoIndex 在多 successful potentials 时的稳定性（是否真用到 ≥2 个不同 index）
  2. 32k token budget 是否够（N=6 + 5 refs 真实场景下输出量观测）
  3. sanitize-vs-Opus drop rate（如果 sanitizer drop ≥30% clips，prompt 还需迭代）
  4. wall-clock 是否在 300s 内（maxDuration cap）

## 下一步：Task 6 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 main 最新（`deddf04`）
2. 读本文件确认 SHA 是新的 + 消化上面的 follow-up（SSRF 与 P2 hardening 合并进 P3 pass）
3. 开 Task 6（按 plan 既定阶段）

Task 6-14 串行，按既定 per-task 闭环。

---

## Task 6 已 merge ✅ — Task 7 放行

> 写于 2026-05-15 · `main` = `6bf31c8` · 来自窗口 3 协调者

### merge 内容

`worktree-capcut-link` tip `6de31af` 已合入 main（merge commit `6bf31c8`）。本次合入：

- `6de31af` — feat(capcut-compiler) Task 6 — `TransitionMaterial` schema + `effect_id` mapping（3 文件 / 240+ 行）
  - `lib/capcut-compiler/schema.ts` (+38)：新增 `TransitionMaterial` type 覆盖 PROBE-observed 字段（id / type / name / effect_id / resource_id / third_resource_id:"0" / source_platform:1 / path / duration:μs / is_overlap / platform:"all" / category_id / category_name / request_id / is_ai_transition / video_path / task_id）；`materials.transitions: unknown[] → TransitionMaterial[]`
  - `lib/capcut-compiler/transitions.ts` (+119, new)：`AssemblyTransitionType` union（cross_dissolve / fade / whip_pan / match_cut / hard_cut）+ `resolveTransitionConfig(type, onUnknown?)` + 3 个 PROBE-measured config 常量
  - `tests/capcut-compiler/transitions.test.ts` (+84, new)：9 cases lock-down

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 184/184（26 files，+9 cases，从 175 → 184）
- `npm run build` → 编译成功

### Task 6 review 亮点

- **`is_overlap` 非 hardcode true**：schema 写 `is_overlap: boolean`（非 literal `true`），test case "is_overlap 不能是 hardcode true: 三种命中类型都按映射表逐条配置" 是显式 regression guard ——doc §4 PROBE 实测发现 push_in / 模糊 / 色差故障 测出 false，未来引入 false 转场时 grammar 已就位
- **PROBE 实测 effect_id lock-down**：3 个已知 effect_id 在测试硬断言（`6724845717472416269` 叠化 / `7627435157909261575` Slick Twist / `7626616498747985168` 替换）+ `default_duration_us` 同样硬断言 —— Task 10 改这里要明确说明 effect_id 变更原因，避免静默 drift
- **`onUnknown` callback 可注入**：默认 `console.warn` 但接收 callback —— Task 10/12 跑批可注入收集器统计 Opus 自由发挥的 fallback 命中率，比 hardcoded console.warn 更可观测
- **`hard_cut → null` 而非 sentinel config**：测试 "hard_cut 不触发 onUnknown" 是反例 guard，确保 hard_cut 不被误判为 unknown 走 fallback；caller 看 `null` 直接知道「不创建 material / 不写 ref」
- **`fade` alias of `cross_dissolve`**：编排层枚举 union 列了 `fade`，但映射表归一到 `CROSS_DISSOLVE_CONFIG`，test `b.toEqual(a)` 锁定 alias 关系
- **`effect_id` / `resource_id` 冗余双字段保持**：没有"我聪明地省一个" —— CapCut schema 实测需要两个字段都填同值
- **`default_duration_us` 注释明确「caller 应优先用编排层 `durationSec` 转 μs」**：Task 8/10 接入时不会被默认值"魔法"误用

### 一条 nit（不阻塞、不需要 fix）

`defaultOnUnknown` 是 `console.warn` —— 用户全局规范 "No console.log in production code"，`console.warn` 同类。

但这里是 **defensive default**，性质特殊：
- 出现仅当 Opus 自由发挥（off-spec 字符串），是 rare path
- Task 10/12 callsite 注释明确「可注入收集器」—— 设计上鼓励 callsite 用 collector 替换默认
- `console.warn` 标准 ECMA API，不会被 lint 一般规则干掉

**建议（Task 10/12）**：CapCut 编译入口（Task 10 接入真转场 / Task 12 跑批）调用 `resolveTransitionConfig(type, collector.onUnknown)` 时显式注入 collector，避免 production log noise；同时为 Opus drift rate 留 telemetry hook。

### follow-up（不阻塞 merge，与上轮统一）

- **Opus 实弹探测（user 侧）**：从 Task 5 carry-over，commit message 标注 "Not run (no Opus access / no headless)"，plan §Task 5 探测点列表 4 项仍待用户实弹（见上轮 follow-up）
- **SSRF hardening (Task 4 carry-over)**：进 P3 "API boundary hardening" 同一改动（与 P2.5 follow-up 合流）
- **Task 6 nit (本轮新增)**：Task 10/12 callsite 注入 collector，替换默认 console.warn

## 下一步：Task 7 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 `6bf31c8`
2. 读本文件「Task 6 已 merge ✅」整段确认 SHA + 消化 Task 10/12 callsite collector 建议
3. 开 Task 7（按 plan 既定阶段）
4. Task 6 闭环后建议 `/compact` 上下文

**建议起监听**：W1 这边监听 `origin/main` tip 前进（90s 轮询），触发后跑「pull → 读 README → 读 window-1.md 末段」，避免再次因未监听而 idle。

---

## Task 7 已 merge ✅ — Task 8 放行

> 写于 2026-05-14 · 针对 `main` = `f3fe3f2` · 来自窗口 3 协调者

### merge 内容

`worktree-capcut-link` tip `dcf38f3` 已合入 main（merge commit `f3fe3f2`）。本次合入：

- `dcf38f3` — feat(capcut-compiler) Task 7 — route + assets multi-video（3 文件 / 307 行）
  - `lib/capcut-compiler/assets.ts` (+56 / -23)：`AssetWorkspace.videoPath` → `videoPaths: string[]`；`prepareAssets(videoUrls[], bgmUrl?)` 并发下载 `input-${i}.mp4`；`Promise.allSettled` 收集失败 index；失败 → `rm(workDir, {recursive, force})` 回滚 + console.error 带 `#i` + `status`；主错误 `Failed to download videos: #0, #2 (2/3)` 列出全部失败 index；BGM 单独 try/catch + 失败也清 workDir
  - `app/api/compile-capcut/route.ts` (+19 / -8)：从 Zod preprocess `videoUrls!` / `videoFileNames` 取（C1 兼容层保证非空，注释说明）；ffprobe 改 `Promise.all(videoPaths.map(probeVideoMeta))` 并发；build/package 仍单视频接口（Task 9/11 接入），forwards `metas[0]` + `buffer[0]` + `names[0]`
  - `tests/capcut-compiler/assets.test.ts` (+224，new)：8 cases — single / N-concurrent / 1-fail / multi-fail / network-reject / bgm-success / bgm-fail / empty-array-reject

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 27 files / 192/192 cases（184 → 192，+8 Task 7 cases）
- `npm run build` → 编译成功（`/api/compile-capcut` dynamic 路由保留，无 ISR 回归）

### Task 7 review 亮点

- **`Promise.allSettled` 而非 `Promise.all`**：N 视频并发下载，一个失败不立刻 abort，所有失败 index 全收集 —— 用户能一次性看到「#0, #2 都挂了 (2/3)」而不是只看到第一个失败。
- **Partial-state 防御**：任一视频失败 → `rm(workDir, {recursive:true, force:true}).catch(() => {})` 立即清 workDir，避免 `input-1.mp4` 单独残留进 Task 9 build → 编译每段都要齐才能产 zip，partial 状态进下游是 silent corruption。`.catch(() => {})` 不冒泡 cleanup 错误（cleanup 失败 ≠ 业务失败）。
- **Per-failure log 带 index + status**：`[capcut-compiler/assets] video #1 download failed (404): ...` —— 跑批日志能快速 grep `video #N` 定位具体失败 URL。fetch network reject（无 status）退化为 `fetch_error` 字符串。
- **空数组 reject 在 mkdir 之前**：`if (!Array.isArray(videoUrls) || videoUrls.length === 0) throw` —— 不创建 workDir 就抛错，避免无谓 IO。test "rejects empty videoUrls" 显式覆盖。
- **route.ts 阶段切分注释清晰**：`metas[0]` / `videoPaths[0]` / `videoFileNames[0]` 三处都注释「Task 9/11 起改 N」—— review 不会困惑为啥并发 ffprobe 后又只取 [0]，阶段计划写在代码旁。
- **BGM 失败也清 workDir**：BGM 单独 try/catch，rejected 时同样 `rm(workDir).catch(() => {})` —— 与视频失败保持对称防御，不会因「视频齐全 BGM 挂」留半成品 workDir。
- **`addRandomSuffix:true` 保留**：Blob upload 防同毫秒并发覆盖（沿用 Task 6 前的设计），多视频不影响这条。

### 一条观察（不阻塞、不需要 fix）

`Object.assign(new Error(...), { __index, __status })` 把 metadata 挂 Error 上 —— ad-hoc 但 scope 极窄（仅 `prepareAssets` closure 内消费），不污染类型系统。如果将来 P3 hardening 引入结构化错误，可改成 `class DownloadError extends Error { index; status; }`，但 Task 7 阶段不需要。

### follow-up（不阻塞 merge，与上轮统一）

- **Opus 实弹探测（user 侧）**：从 Task 5 carry-over，plan §Task 5 探测点列表 4 项仍待用户实弹
- **SSRF hardening (Task 4 carry-over)**：进 P3 "API boundary hardening"（与 P2.5 follow-up 合流）
- **Task 6 nit (上轮)**：Task 10/12 callsite 注入 collector，替换默认 `console.warn`
- **Task 7 nit (本轮新增)**：考虑 `DownloadError` 结构化错误类（P3 hardening 顺带，不阻塞）

### 浏览器烟测试

commit 不含 UI 改动 —— route.ts 改动是后端 N→1 接入扩展点，仍走单视频 zip。Task 13 才 arrayify ResultsArea。窗口 3 不阻塞 merge。

## 下一步：Task 8 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 `f3fe3f2`
2. 读本文件「Task 7 已 merge ✅」整段确认 SHA + 消化 Task 7 nit（不阻塞）
3. 开 Task 8（按 plan 既定阶段）
4. Task 7 闭环后建议 `/compact` 上下文

---

## Task 8 已 merge ✅ — Task 9 放行

> 写于 2026-05-14 · 针对 `main` = `bde36de` · 来自窗口 3 协调者

### merge 内容

`worktree-capcut-link` tip `7ca1a46` 已合入 main（merge commit `bde36de`）。本次合入：

- `7ca1a46` — feat(capcut-compiler) Task 8 — edit-plan multi-video + transition timeline math（2 文件 / 395 行）
  - `lib/capcut-compiler/edit-plan.ts` (+150)：
    - `EditSegmentPlan` 新增 `sourceVideoIndex: number` 字段；单视频 `planEditSegments` compat 路径显式填 `0`（line 218，Task 9/11 下游无需分支）
    - `planFromAssemblyTimeline(timeline, metas)`：linear target cursor 累加（**按 Task 2 PROBE §4：转场不缩 timeline，is_overlap 仅驱动 CapCut 渲染层视觉重叠**）
    - 防御 clamping：`resolveSourceVideoIndex`（`Number.isInteger + 0 ≤ raw < totalVideos` → 越界 clamp to 0 + warn）；`clampToRange`（NaN/Infinity → lo）；degenerate clip (dur<1e-3) skip + warn 不让畸形段污染 timeline
    - `resolveClipAnimation`：null → 兜底交替（与 pickAnimation 单视频路径一致，幅度 4%）；known type 走 clampScale；未知 type → "none" 防御性退化
    - `clampScale` 范围 0.5-2.0（vs pickAnimation 0.9-1.1）—— 设计差异：assembly 路径允许用户自定义 scale
    - `clampTransitionDurationSec(durSec, prevDur, curDur)`：Task 10 接入真转场时调用，NaN/Infinity/非正值 → 0，正常 case `min(durSec, halfShorter)`
  - `tests/capcut-compiler/edit-plan.test.ts` (+245)：12 new cases — planFromAssemblyTimeline 8（空 clips / 单 clip / 多 clip linear / idx 越界 / source 越界 / degenerate skip / animation null / animation pass-through）+ clampTransitionDurationSec 4（正常 / NaN / prev/cur 0 / durSec 超 halfShorter）+ 1 sourceVideoIndex:0 backward-compat assertion 加在已有 planEditSegments case

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 27 files / **204/204 cases**（192 → 204，+12 Task 8 cases）
- `npx next build` → 编译成功，23/23 静态预渲染（`/trending` 等 static route 未退化）

### Task 8 review 亮点

- **Linear target cursor 严格按 PROBE §4**：转场不参与 target_timerange 计算，转场只在 Task 10 写 TransitionMaterial.duration 时存在 —— `targetStartSec` / `targetEndSec` 通过 `targetCursor += dur` 累加，**无 overlap 数学**。这是 Task 2 PROBE 的核心结论落地，避免双重处理转场导致 timeline 漂移。
- **Graceful clamp 而非 throw**：sourceVideoIndex 越界 / sourceStart-End 越 meta.durationSec / degenerate clip 全部 console.warn + 修正继续，不抛错中断 pipeline。与 Task 6 collector 模式 + Task 7 partial-state 防御一脉相承 —— 让 LLM 输出的小瑕疵被吸收，给开发者留 warn 排查口。
- **`+1e-3` 浮点容差**：`clip.sourceEndSec > maxDur + 1e-3` 触发 clamp warn，避免 LLM 输出 9.0000001s 这种"轻微越界"被误报。1e-3 = 1ms，对秒级时长足够松。
- **`Number.isInteger` 严格检查**：sourceVideoIndex 必须是非负整数，浮点（3.5）也被判越界。LLM 偶发输出 "3.0" 或 "3.5" 时不会被 silently 当成 3。
- **`clampScale` 范围放宽合理**：用户在 assembly timeline 里可能指定 0.7 或 1.5 的特殊效果，0.5-2.0 给空间；但 pickAnimation 自动生成路径仍保守 0.9-1.1。两套范围共存，意图清晰。
- **`clampTransitionDurationSec` 提前导出**：Task 10 还没开但工具已就位 —— Task 10 直接 `import { clampTransitionDurationSec } from "./edit-plan"` 调用，不会因为 helper 散在 Task 10 实现里而漏 clamp。这是 Task 8 → Task 10 的接口契约前置。
- **Animation pass-through + alternating 兜底**：raw === null 时按 outputIndex 奇偶交替 push_in / pull_out（与 pickAnimation 一致），保持 LLM 不指定 animation 时的视觉节奏感。
- **Backward compat**：planEditSegments 单视频路径 line 218 显式填 `sourceVideoIndex: 0`，Task 9/11/12 拿到的 plan 无论单视频还是多视频都有这字段，下游零分支。

### 一条观察（不阻塞、不需要 fix）

`planFromAssemblyTimeline` 在 `metas.length === 0` 时，所有 clip 都会触发 sourceVideoIndex clamp to 0 + 紧接 `metas[0]?.durationSec ?? 0 = 0` → 所有 clip degenerate skip → 返回 `[]`。Graceful 但路径稍绕。如果 Task 9/11 调用方在 `metas.length === 0` 时直接早退（route.ts 已经强制 `videoUrls.length >= 1`），其实进不到这条路径。**接受现状**，无需 fix。

### follow-up（不阻塞 merge，与上轮统一）

- **Opus 实弹探测（user 侧）**：plan §Task 5 探测点列表 4 项仍待用户实弹
- **SSRF hardening (Task 4 carry-over)**：进 P3 #2（W1 owner，与 W2 P3 #1 boundary Zod 协同；W2 P3 #1 启动指令已在 window-2.md 末尾，main = `58a4094`）
- **Task 6 nit (上上轮)**：Task 10/12 callsite 注入 collector，替换默认 `console.warn` —— Task 8 的 `console.warn` 后续会被 Task 10/12 注入的 collector 接管
- **Task 7 nit (上轮)**：`DownloadError` 结构化错误类 —— 进 P3 #6 refactor scope
- **Task 8 nit (本轮新增)**：metas.length=0 边界绕路（见上节），**不需要 fix**

### 浏览器烟测试

commit 是纯库层 + 测试改动，零 UI 影响。Task 13 才 arrayify ResultsArea。窗口 3 不阻塞 merge。

## 下一步：Task 9 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 `bde36de`
2. 读本文件「Task 8 已 merge ✅」整段确认 SHA + 消化 Task 8 nit（不阻塞）
3. 开 Task 9（按 plan v4.1-review 既定阶段：build 层接入 multi-video edit plan）
4. Task 8 闭环后建议 `/compact` 上下文

**并行情境提示**：W2 那边今晚刚启动 P3 #1（API boundary Zod validation），main `58a4094..bde36de` 是这次 Task 8 merge 落入 —— W2 当前应该在 `feat/p3-hardening` 分支动手，跟 W1 Task 9 在 `worktree-capcut-link` 互不冲突。如果 Task 9 触及 `app/api/compile-capcut/route.ts`（比如把 build 层接入），可能会与 W2 P3 #1 范围内 schema 改动有间接耦合 —— **建议 W1 在 Task 9 push 前 `git pull origin main --no-rebase`，吸纳 W2 的 schema 改动（如果到时候已 merge）**。

---

## Task 9 已 merge ✅ — Task 10 放行

**Merge**: `a7d9fdf` (main，2026-05-14 23:48 PT)
**Commit**: `d45789a` — feat(capcut-compiler): Task 9 — build.ts multi-material body, fitScale, N draft_materials entries
**Files**: `lib/capcut-compiler/build.ts` +190/−100 · `app/api/compile-capcut/route.ts` +18/−18 · `scripts/probe-capcut-zip.ts` +4/−4 · `tests/capcut-compiler/build.test.ts` +285/−12 · `tests/capcut-compiler/package.test.ts` +4/−4 · `tests/capcut-compiler/setup-scripts.test.ts` +4/−4

### 三门验证

- `npx tsc --noEmit` → exit 0（clean）
- `npx vitest run` → **27 files / 214 cases**（204 → 214，+10 来自 build.test 多视频 + assemblyTimeline 路径）
- `npx next build` → 23 routes，全部通过；`/api/compile-capcut` 仍 ƒ（dynamic），canvas/duration 改动未影响 route 类型

### Review 亮点（与 plan v4.1-review I3 一致）

1. **`CompileInput` shape 切换**：`videoFileName/meta` → `videoFileNames[]/metas[]`，length 守门在入口 throw（非空 + 长度相等），下游所有 callsite（`route.ts` / `probe-capcut-zip.ts` / 2 个 setup test fixture）同步切换 —— 无 dangling 单视频引用。
2. **Routing**：`match.assemblyTimeline ? planFromAssemblyTimeline : buildEditPlan`（兼容路径 `sourceVideoIndex` 一律 0）—— Task 8 与 Task 7 路径都覆盖。
3. **`computeFitScale` cover-fit**：等尺寸短路返回 1（避免浮点扰动）；`segW<=0 || segH<=0` 回退 1；其它走 `max(canvasW/segW, canvasH/segH)`。
4. **`scaleFrom/scaleTo` baseline 预乘 `fitScale`**：传给 `makeEasedScaleKeyframes` 之前就乘，所有 ease 中间帧自动 cover —— 数学上比"在每帧后乘"更干净，避免 keyframe 内插值出现 baseline 不匹配。
5. **Defensive material_id clamp（review I3）**：`segIdx = p.sourceVideoIndex in [0, len) ? raw : 0`，即使上游 plan 阶段 clamp 失败也不 crash —— 双重保险。
6. **`mapSourceToTarget` 加 `sourceVideoIndex !== 0` skip**：subtitle 锚定主视频（user 字幕来自 `input.potential`，本来就只对应主视频时间）。这是 Task 9 唯一一个 cross-cutting 的语义变更，注释里讲清楚了。
7. **`draft_materials` group0 N+1 顺序**：N 个 video entry（一对一对应 `videoMaterials`）→ 可选 BGM entry 在末尾。测试明确断言顺序。
8. **Blocking gate 测试**（W3 review I3 要求）：legacy N=1 path 测试断言 `onlyId` 横扫所有 segments，`clip.scale = scaleFrom = 1`（fitScale=1），canvas = metas[0] —— 改造前后输出逐字段一致。

### 注意：ratio 判断仍然只看 `primaryMeta`

`canvas_config.ratio` 用 `primaryMeta.width/height` 判断 9:16 / 16:9 / original —— 多视频场景下，如果 secondary metas 比例不一致，canvas 仍按主视频走（这是设计如此，不是 bug）。fitScale 在 segment 层把 secondary 视频铺满 canvas。

### nit（不阻塞）

- 测试里 `BASE_MATCH` 没有 `assemblyTimeline` 字段，依赖 spread 覆盖时把它当 optional —— types 里看起来 OK；如果 `TechniqueMatchingResult` 后续把 `assemblyTimeline` 改成 required（不太可能），测试 cast 要更新。当前不需要动。
- `route.ts` 的 5) 注释还是写 "Task 9 阶段 zip 仍单视频兼容" —— 等 Task 11 做并发 N buffer 读取时再更新这段注释，**不阻塞**。

---

## 下一步：Task 10 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 `a7d9fdf`
2. 读本文件「Task 9 已 merge ✅」整段确认 SHA + 消化 nit（不阻塞）
3. 开 Task 10（按 plan v4.1-review 既定阶段：transitions 接入 multi-video，用 Task 8 已导出的 `clampTransitionDurationSec` 把 incomingTransition 落到 capcut transitions schema）
4. Task 9 闭环后建议 `/compact` 上下文

**并行情境提示**：W2 P3 #1 仍未 push 到 `feat/p3-hardening`（branch tip 等同 main）。Task 10 主要触及 `lib/capcut-compiler/transitions.ts` + `build.ts` + `schema.ts`，与 W2 P3 #1 范围（trending / cron-trending / template-brief / upload / template-brief-upload）零冲突 —— W1 可以放心开。如果 Task 10 push 前 W2 已 merge P3 #1，仍建议 pull main 吸纳 schema 改动（虽然几乎不可能冲突）。
