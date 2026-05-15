# 多视频素材改造 · technique-match 流程

> 窗口 1（`worktree-capcut-link`）实施计划。2026-05-14 创建，经 Plan mode 三 agent 并行设计 + 用户审批。
> 2026-05-14 经窗口 3 review（C1/C2/I6 契约级修正 + I1-I5 已吸收，见下方各 task 标注）。
> 串行 per-task 工作流，每个 task 完成 → push → 等 merge → `git pull origin main --no-rebase` → `/compact` → 下一个 task。

## 执行进度（换机器 / compact 后读这里恢复）

最后更新：**2026-05-14 收工**

- **Task 1 — 契约冻结 + 共享类型/schema** — ✅ 已完成并 merge（`b6c5e5b`，main 已到 `6c34173`）
- **Task 2 — CapCut 转场结构逆向探测 (PROBE)** — 🔧 **进行中，未 merge**
  - 已完成：核心结构全部逆向 —— `scripts/probe-capcut-transitions.ts`（探测脚本）+ `docs/CAPCUT-TRANSITION-STRUCTURE.md`（结论文档：transition 字段结构、挂载方式、`is_overlap` 时间轴语义、filter/effect 附录）。
  - **唯一卡点**：只实测到 2 种转场 effect_id（Slick Twist / Filmstrip x2），缺「叠化 / cross dissolve」—— 它是 Task 6 降级策略的落点，必须补。
  - **恢复方式（换机器）**：见 `docs/CAPCUT-TRANSITION-STRUCTURE.md` 附录 B。需在 Windows CapCut 8.5.0 建/打开带「叠化」转场的项目，跑 `npx tsx scripts/probe-capcut-transitions.ts <项目目录>` 补 effect_id → 文档去掉 WIP 标注 → Task 2 完成 → 走 per-task 工作流（push / 等 merge）。
  - ⚠️ 当前 worktree 已 push 的 Task 2 commit 是 **WIP，请窗口 3 勿 merge**，等补完叠化转场的完成态 commit。
- **Task 3-14** — ⏳ 待办（严格串行，Task 2 完成后继续）。

## Context

当前 `technique-match` 流程只允许用户上传 **1 个**视频：Gemini 分析素材潜力 → Opus 对照爆款出剪辑清单 → 编译成 CapCut 草稿 zip。所有 CapCut segment 都引用同一个 `videoMaterial`，`transitions` 始终为空。

团队/用户反馈：单视频剪辑效果不明显、体验不真实。用户实际工作方式是上传**多个原始素材**做裁剪、拼接，这样才能真正用上产品积累的转场和剪辑知识。

用户已拍板的三个方向（2026-05-14）：
1. **AI 智能编排** —— 用户只管上传一堆素材，AI 看完所有片段后决定用哪些段、按什么顺序排、在哪加转场。用户不定序。
2. **本期一起做真转场** —— CapCut draft 里实际写入 `transitions`，不是占位硬切。
3. **片段数量上限 5-6 个**。

预期产出：用户传 5-6 个素材 → AI 编排出有序时间线（选段 + 裁剪 + 转场 + 动画）→ 编译成可在 CapCut 桌面端直接打开的草稿。

**范围**：只改 `technique-match` 这条线。`review` 流程（给单个成品视频打分）排除在外 —— 多视频对它无产品意义，两个 `InputPanel` 保持独立，**不要**为"统一上传组件"做共享抽象。

**工作环境**：worktree `.claude/worktrees/capcut-link`，分支 `worktree-capcut-link`。dev server 端口 3001（`npm run dev -- -p 3001`）。

---

## 跨层契约：`assemblyTimeline`（三层共同依赖，Task 1 冻结）

分析层产出、编译层消费、前端透传展示。挂在 `TechniqueMatchingResult` 上：

```ts
// lib/technique-matching/types.ts
AssemblyClip = {
  sourceVideoIndex: number;   // 0-based，对齐 videoUrls[] / VideoMaterial[]，编译层主键
  sourceVideoId: string;      // 冗余校验/调试，编译层不依赖
  order: number;              // = clips 数组下标，显式冗余便于校验
  sourceStartSec: number;     // 该视频内源 in 点（裸秒 float，非 {sec,frame} 对象）
  sourceEndSec: number;       // 该视频内源 out 点
  animation: { type: string; scaleFrom?: number | null; scaleTo?: number | null } | null;
  incomingTransition: {       // 与「上一个 clip」之间的转场；第一个 clip = null
    type: string;             // cross_dissolve | whip_pan | match_cut | hard_cut | fade | ...
    durationSec: number;
    reason: string;
  } | null;
  reason: string;             // 为什么选这段、为什么放这位置（引用 potential 维度/参考爆款）
};
AssemblyTimeline = {
  clips: AssemblyClip[];
  estimatedDurationSec: number;
  narrativeSummary: string;
  rationale: string;
};
// TechniqueMatchingResultSchema 新增：
assemblyTimeline: AssemblyTimelineSchema.nullable().optional()  // ★ 必须 optional：旧数据/未升级编译层 parse 不崩
```

**契约决策（已对齐两个产出方）**：
- clip 用 `sourceVideoIndex`（整数）做主键，不用 `videoId`。编译层按数组顺序建 `VideoMaterial[]`，index 是天然主键。
- 转场挂在 clip 上（`incomingTransition`），不用独立 `transitions[]` 数组 —— 消除"转场下标对不齐 clip"的 bug 面。N 个 clip 有 N-1 个转场，第一个 clip 的 `incomingTransition = null`。
- 源 in/out 用裸秒 `number`，不经过 `match-engine.ts` 的 walk()，编译层 `secToMicroseconds` 零换算直吃。
- `incomingTransition.durationSec` 用秒（与 assemblyTimeline 整体的裸秒约定一致）；编译层负责秒→μs/帧换算，具体换算依据 Task 2 探测结论。
- **【窗口3 review I6】`sourceVideoIndex` / `failedVideoIndexes` 一律以「上传全集」为索引基准** —— 6 个传、5 个成功时，index 不随成功子集偏移。Opus 在 prompt 里看到的是全集 index + 哪些 index 分析失败的明确清单，禁止 `assemblyTimeline` 引用失败的 index。编译层的 `VideoMaterial[]` 也按上传全集建（失败的视频仍占位还是剔除 → 在 Task 4/Task 7 定死并写明，但 index 基准恒为上传全集）。
- **【窗口3 review I2】`assemblyTimeline` 所有字段命名必须避开 `match-engine.ts` 的 walk() 重写键**（`at` / `userVideoAt` / `sourceAt` / `fromAt` / `toAt`）—— walk() 会无差别重写这些 key。现有 `sourceStartSec` / `sourceEndSec` / `sourceVideoIndex` 安全；后续给 `assemblyTimeline` 加字段必须遵守此约束。
- **【窗口3 review I4】两个文件名命名空间严格分离**：① workspace 内部临时文件名（`input-{i}.mp4`，仅落盘下载用，Task 7）；② 用户可见文件名（`dedupeFileNames(videoFileNames)[i]`，写进 `draft_content.json` 的 path / `draft_meta_info` 的 file_Path / zip 内文件名，Task 11）。两者不可混用。

**向后兼容矩阵**：

| match 数据 | 编译层（未升级） | 编译层（已升级） |
|---|---|---|
| 旧（无 assemblyTimeline） | ✅ 走 trimRanges | ✅ 无 assemblyTimeline → fallback 单视频 trim 逻辑 |
| 新（有 assemblyTimeline） | ✅ parse 通过、忽略字段、行为退化但不崩 | ✅ 走 assemblyTimeline |

`trimRanges` / `topPriorityActions` / `globalDoNots` / `recommendedBgms` 全保留：有 `assemblyTimeline` 时编译层用它、忽略 trimRanges；无则 fallback。`reports` 保留作人类可读诊断，`reports[].recommendations[].userVideoAt` 改 `.nullable().optional()`。

---

## Task 拆分（端到端 · 串行执行顺序）

### Task 1 — 契约冻结 + 共享类型/schema
**只做加性/放宽性的类型与 schema 改动，不改运行逻辑。`npx tsc --noEmit` 必须绿 —— 这是「main 始终可 deploy」的硬证明。**
- `lib/technique-matching/types.ts`：新增 `AssemblyClipSchema` / `AssemblyTimelineSchema`；`TechniqueMatchingResultSchema` 加 `assemblyTimeline`（`.nullable().optional()`）、`userVideoIds: z.array(z.string()).optional()`；`reports[].recommendations[].userVideoAt` 改 `.nullable().optional()`。全部加性/放宽，安全。
- `app/api/technique-match/route.ts` + `app/api/compile-capcut/route.ts` 的 Zod schema：**【窗口3 review C1】不能简单改字段名**。`compile-capcut/route.ts:67-90` 现在是 `const { videoUrl } = parsed.data` + `prepareAssets(videoUrl)`，`technique-match/route.ts` 同理直接解构 `videoUrl`。交付物必须是：新增 `videoUrls: z.array(z.string().url()).min(1).max(6).optional()` + `videoFileNames` 作为新 optional 字段；**同时把 `videoUrl` / `videoFileName` 保留为 `z.preprocess` 派生的 `.optional()` 输出字段**（preprocess 规则：传 `videoUrls` 则派生 `videoUrl = videoUrls[0]`；传旧 `videoUrl` 则原样保留并归一出 `videoUrls = [videoUrl]`）。这样未改的运行逻辑（`route.ts:67-90` 解构 `videoUrl` + `prepareAssets(videoUrl)`）**仍能编译运行**，运行逻辑本 task 一行不动。
- `components/technique-match/useAnalyzeStream.ts`：**【窗口3 review C2】Task 1 完全不动 useAnalyzeStream.ts**。`SubmitArgs` / `videoUrl` state / `partial` 形状 / `AnalyzeResponseShape` 全部留到 Task 3（输入侧）与 Task 4（流事件侧）—— 只在「前端契约与后端实际运行行为同步」时才改，避免 Task 1 单方面改 `partial` 形状导致与线上仍发单数的 route 失配、生产流量错乱。
- 依赖：无。**最先做**，解锁全部。
- 验证：`npx tsc --noEmit`（**必须绿，证明 C1 兼容层成立、运行逻辑未被破坏**）+ `npx vitest run` 全绿；手写带/不带 `assemblyTimeline` 的 fixture 喂 `TechniqueMatchingResultSchema.parse` 都通过（向后兼容）；旧形态请求体（只带 `videoUrl`）喂两个 route 的 Zod schema，`parsed.data.videoUrl` 仍有值。

### Task 2 — CapCut 转场结构逆向探测（PROBE，高不确定性）
**整个方案风险最高的部分，提前做以尽早确认真转场是否可行。**
- 新增 `scripts/probe-capcut-transitions.ts`（只读，不进生产路径）：读本机 CapCut 原生项目（HANDOVER 提到的 0203/0205，或手动建一个带 2-3 片段 + 多种转场的项目）。
- dump 并记录：`materials.transitions[]` 每个 transition material 完整字段（预期含 `id`/`type`/`effect_id`/`resource_id`/`name`/`duration`/`is_overlap`/`category_id`/`path`/`platform`）；转场在 segment 上怎么引用（`extra_material_refs` 还是专门字段；挂前段还是后段）；**相邻两段 `target_timerange` 在加转场后是「重叠 D」还是「各缩短 D/2」还是「不变靠 is_overlap 标记」**（直接决定 Task 8 时间轴算法）。
- 至少 3 种转场（cross dissolve / 运动类如 whip / match cut 风格）的 `effect_id` 实测值整理成映射表。记录探测时 CapCut 版本（当前 cc 8.5.0）。
- 结论写入新建 `docs/CAPCUT-TRANSITION-STRUCTURE.md`。
- 依赖：无。**阻塞 Task 6/8/10。**
- 验证：产出明确字段结构文档 + ≥3 种转场 effect_id + 「重叠 vs 缩短」结论。
- ⚠️ 若探测结论是真转场不可行/过于脆弱 → Task 8/10 降级为硬切+叠化占位，真转场推迟为后续 task（用户已知此风险）。

### Task 3 — 前端多视频上传层
- `components/technique-match/InputPanel.tsx`：`videoFile: File|null` → `videoFiles: File[]`；`<input multiple>`；`addFiles` 追加语义（单文件 30MB 校验、`name+size` 去重、超 `MAX_FILES=6` 截断提示、`input.value=""` 复位）；已选文件列表 UI（序号 + 文件名 + 大小 + 删除按钮）；提交时 `Promise.allSettled` 并行 `upload()` N 个文件，**全有或全无**（任一失败不调 `onSubmit`、报哪些文件失败）；按输入顺序产出对齐的 `videoUrls[]` + `videoFileNames[]`。`onSubmit` props 契约数组化。
- `components/technique-match/useAnalyzeStream.ts`：**仅改输入侧** —— `SubmitArgs` 数组化（`videoUrl/videoFileName` → `videoUrls/videoFileNames`）+ `videoUrl/videoFileName` state → `videoUrls/videoFileNames`；POST body 发 `videoUrls`（Task 1 的 route 兼容层已能接）。**`partial` 形状与 `AnalyzeResponseShape` 本 task 不动** —— route 此时仍发单数 partial，留到 Task 4 与后端发射同步改（窗口3 review C2）。
- `app/technique-match/page.tsx`：装配处同步（`stream.videoUrl` → `stream.videoUrls` 等）。
- 依赖：Task 1。
- 验证：`npm run dev -- -p 3001` 浏览器实测 —— 多选、删除、超 30MB 跳过、超 6 个截断、并行上传、部分失败提示。

### Task 4 — 分析层：N 视频输入 + 并行 Gemini + 逐视频 partial 流式
- `app/api/technique-match/route.ts`：N 个视频并行下载到 `workDir/input-{i}.mp4`（内部临时名，见契约段 I4），各自 `probeVideoMeta`；**并行** `Promise.allSettled(videos.map(analyzeMaterialPotential))`；每个完成立即 `send partial`（带 `materialIndex/totalMaterials/videoId`），失败 `send stage`；`result` data 形状锁定为 `{ userVideoIds, userPotentials, userPotential(=[0] 过渡), failedVideoIndexes, referenceSource, referenceNotice, match }`。`failedVideoIndexes` 按上传全集索引（契约段 I6）。
- `components/technique-match/useAnalyzeStream.ts`：**【窗口3 review C2 — 与后端发射同步落地】** `StreamEvent.partial` payload 数组化 + 加 `materialIndex/totalMaterials`；`partial: {...}|null` → `partials: MaterialPotential[]`（按 `materialIndex` 填充）。
- `components/technique-match/ResultsArea.tsx`：**【窗口3 review I5 — 纯类型改动，保 build 绿】** `AnalyzeResponseShape.userPotential` → `userPotentials: MaterialPotential[]`（+ 过渡保留 `userPotential = userPotentials[0]`）；ResultsArea 渲染逻辑暂只读 `userPotentials[0]` 维持单卡（编译能过即可），完整 N 卡渲染留 Task 13。
- `lib/video/analyze-potential.ts`：file processing poll 上限参数化（`maxPollAttempts?`），route 传入收紧值（~120s）让卡死视频快速 fail。
- `lib/technique-index/similarity.ts`：新增 `potentialsToDesiredTags(potentials[])`（不改旧 `potentialToDesiredTags` 签名，保护现有测试）；`loadReferenceCutPlans` 的 `userFormat` 取 N 个 `detectedFormat` 众数，`desiredTechniques` 聚合 N 个 potential，`limit` 保持 5。
- 依赖：Task 1。**超时风险最大，先验证。**
- 验证：probe 脚本本地传 2-3 个短视频，确认墙钟 < 300s、N 个 `MaterialPotential` parse 成功、N 个 partial 按完成顺序到达；`npx tsc --noEmit` 绿（ResultsArea 类型同步未破 build）。
- ⚠️ 探测点：① Gemini N 路并行是否触发 429（决定是否加并发池上限 3-4）；② 并行后总墙钟能否真压进 300s（否则考虑合并 Gemini 两阶段调用 / 加总预算计时器，超 ~180s 用已完成的继续）；③ **【窗口3 review I1】Gemini Files 上传侧延迟与 generate 侧延迟分开测** —— N=6 并行可能撞 upload 侧限流，不只是 generate 的 429，两段延迟要分别观测。

### Task 5 — 分析层：Opus 编排引擎 + prompt + result 收口
- `lib/technique-matching/match-engine.ts`：`MatchEngineInput.userPotential` → `userPotentials[]`；payload 给每个 potential 注入 `index` + 保留 `durationSec`；`assemblyTimeline` 后处理校验回填（`sourceVideoIndex ∈ [0,N)` 越界 clamp/丢弃、`sourceVideoId` 用 index 反查回填、`sourceEndSec <= durationSec` clamp、`order` 回填下标）；`raw.userVideoIds` 填充。
- `lib/technique-matching/match-prompt.ts`：输入说明改为「N 份带 `index` 的 MaterialPotential」；**新增「跨视频编排时间线 assemblyTimeline」任务段** —— 要求 Opus 像剪辑师一样选段/排序/配转场/配动画，强制规则（clip 5-12 段、`sourceVideoIndex` 真实存在、`sourceEndSec > sourceStartSec` 且 `<= durationSec`、至少用到 2 个不同视频、转场服务叙事、第一个 clip `incomingTransition=null`、`estimatedDurationSec` = clip 时长和）；**【窗口3 review I6】prompt 必须明确列出哪些 `sourceVideoIndex` 分析失败（来自 `failedVideoIndexes`，按上传全集索引），并硬性禁止 `assemblyTimeline` 引用这些 index**；`reports` 段保留语义微调为「对素材池整体的可用性判断」；`trimRanges` 段标为「AI 编排模式下留空数组」；JSON 模板加 `assemblyTimeline` 完整示例。
- **【窗口3 review I2】硬约束**：本 task 若给 `assemblyTimeline` 加任何新字段，命名必须避开 `match-engine.ts` walk() 重写键（`at`/`userVideoAt`/`sourceAt`/`fromAt`/`toAt`）。现有字段已安全（见契约段）。
- 依赖：Task 1、Task 4。**迭代最久。**
- 验证：probe 脚本跑真实多视频，人工 review `assemblyTimeline` 合理性；parse 失败 dump 到 `data/probes/_debug/`，迭代 prompt 至稳定。
- ⚠️ 探测点：Opus 能否稳定输出合法 `sourceVideoIndex`（多轮 prompt 调试）；`max_tokens`（现 16384）在 N=6 + 5 爆款 + reports + assemblyTimeline 下是否够（不够则提到 32000，或更激进压缩 `compactPotential`，最坏拆两次调用）。

### Task 6 — 编译层：schema 转场类型 + 转场映射表
- `lib/capcut-compiler/schema.ts`：基于 Task 2 结论，把 `materials.transitions: unknown[]` 替换为真实 `TransitionMaterial[]` 类型；若 Task 2 确认走专门字段则给 `VideoSegment` 补字段。
- 新增 `lib/capcut-compiler/transitions.ts`：编排枚举 → CapCut `effect_id` 映射表常量（cross_dissolve / whip_pan / match_cut / ...，含未知 type 降级 cross_dissolve、match_cut 无资源降级硬切的策略）。
- 依赖：Task 2。
- 验证：`npx tsc --noEmit` 通过；类型与 Task 2 文档一致。

### Task 7 — 编译层：route + assets 多视频
- `app/api/compile-capcut/route.ts`：运行逻辑落地多视频（Task 1 已改 Zod schema）；对 `videoPaths` 每个并发 `probeVideoMeta` 得 `VideoMeta[]`。
- `lib/capcut-compiler/assets.ts`：`AssetWorkspace.videoPath` → `videoPaths: string[]`；`prepareAssets(videoUrls[], bgmUrl?)` 并发下载到 `input-{i}.mp4`（120s 超时主要缓解手段），单个失败带 index 进日志。
- 依赖：Task 1。
- 验证：旧单视频请求仍通；多视频能下齐；`tests/capcut-compiler` 加 assets 多视频用例（mock fetch）。
- ⚠️ 影响：6×30MB 下载并发后 ~5-15s；ffprobe 并发 ~2s。120s 尾部风险见 Task 11 的压缩级别缓解 + 单文件大小上限。

### Task 8 — 编译层：edit-plan 视频来源 + 多 material 编排 + 转场时间轴
- `lib/capcut-compiler/edit-plan.ts`：`EditSegmentPlan` 新增 `sourceVideoIndex: number`；新增 `planFromAssemblyTimeline(assemblyTimeline, metas: VideoMeta[])` —— 遍历 clips、校验 index/源时长边界（越界 clamp + 告警）、`targetStartSec` 累加游标、`animation` 用 clip.animation（缺省 `pickAnimation` 兜底简化为 index 交替）；**转场对时间轴的影响严格按 Task 2 结论实现**（重叠 D → `clip[i+1].targetStartSec = clip[i].targetEndSec - D` + 游标前移；或各缩短 D/2；或不变靠标记）；转场时长 clamp 不超相邻较短段一半。保留 `extractTrimRanges/computeKeepRanges/planEditSegments` 作无 assemblyTimeline 的兼容路径（plan 补 `sourceVideoIndex: 0`）。
- 依赖：Task 2、Task 5、Task 6。
- 验证：`tests/capcut-compiler/edit-plan.test.ts` 新增多视频 clips → 正确 `sourceVideoIndex` + 累加 target + 转场重叠/缩短数学；边界用例（越界 index、转场过长、空 clips）。

### Task 9 — 编译层：build.ts 多 material 主体
- `lib/capcut-compiler/build.ts`：`CompileInput` 的 `videoFileName/meta` → `videoFileNames[]/metas[]`；单条 `videoMaterial` → `videoMaterials: VideoMaterial[]`（`materials.videos = videoMaterials`）；`match.assemblyTimeline` 存在 → `planFromAssemblyTimeline`，否则 → 现有 `buildEditPlan`（兼容路径）；每个 plan → `VideoSegment` 且 **`material_id = videoMaterials[p.sourceVideoIndex].id`**；伴随 material 逻辑不变；`draft_materials` group0 放 N 个 `DraftMaterialEntry`（`id` 对齐对应 `videoMaterials[i].id`）。
- **canvas 尺寸**：主视频 = `metas[0]`，canvas 用其 width/height/ratio；尺寸不一致的 segment 算 `fitScale`（默认 cover：`max(canvasW/segW, canvasH/segH)`）写入 `clip.scale`；**push_in/pull_out keyframe 的 scale 值要乘以 `fitScale` 基线**（`makeEasedScaleKeyframes` 调用前先乘）—— 易出 bug，需单测覆盖。
- **【窗口3 review I3】兼容路径不是"优雅降级"，是必须保证不 crash**：`build.ts` 的 `videoMaterials[p.sourceVideoIndex].id`（现 build.ts:344 一带）若 `sourceVideoIndex` 为 `undefined` 会直接 crash。无 `assemblyTimeline` 的 fallback 路径必须确保每个 plan 都补了 `sourceVideoIndex: 0`（Task 8 已要求），本 task 实现时再确认一遍。
- 依赖：Task 6、Task 7、Task 8。
- 验证：`tests/capcut-compiler/build.test.ts` 扩充 —— N 视频→N material、segment `material_id` 正确分布、canvas 取主视频尺寸、尺寸不一致片段 `clip.scale`=fitScale 且 keyframe 基线相乘正确、draft_materials group0 含 N 条；**【窗口3 review I3 — blocking gate】「旧单视频 match（无 assemblyTimeline）→ 编译输出与改造前逐字段一致」必须作为阻塞性回归测试**，不只是回归保护，不过此 gate 不得 merge。

### Task 10 — 编译层：build.ts 接入真转场
- `lib/capcut-compiler/build.ts` + `lib/capcut-compiler/transitions.ts`：每个 `incomingTransition` 造一个 `TransitionMaterial`（`effect_id` 查映射表、`duration` 秒→μs、`is_overlap` 按 Task 2 结论）push 进 `materials.transitions`；按 Task 2 结论把 transition material id 挂到对应 segment（`extra_material_refs` 或专门字段、挂前段还是后段）；未知 type 降级 cross_dissolve + `console.warn`，match_cut 无资源降级硬切。
- 依赖：Task 2、Task 6、Task 8、Task 9。
- 验证：`build.test.ts` —— `materials.transitions` 长度/引用/effect_id 正确。**merge 前必须本机 CapCut 实测**（Task 12 的 probe zip 在 CapCut 打开确认转场真实出现且不报错）—— 唯一能确认逆向正确的手段。

### Task 11 — 编译层：package.ts 多视频打包 + 文件名去重 + 压缩级别
- `lib/capcut-compiler/build.ts`：新增 `dedupeFileNames(names[])`（sanitize 后重名加 `-1`/`-2` 后缀保扩展名）—— 去重必须在 build 前定稿，`draft_content.json` 的 `path`、`draft_meta_info` 的 `file_Path`、zip 内文件名三处必须完全一致。
- `lib/capcut-compiler/package.ts`：`PackageInput.videoBuffer/videoFileName` → `videos: Array<{buffer, fileName}>`；循环 `materials.file()`；压缩级别从 DEFLATE level 6 改 `STORE` 或 `level:1`（mp4 已压缩，DEFLATE 几乎不省体积却耗 CPU —— 120s 缓解措施）；README 模板更新（含 N 个素材、AI 编排顺序、已应用转场）。
- 依赖：Task 9。
- 验证：`tests/capcut-compiler/package.test.ts` —— N 视频 buffer 全进 `materials/`、同名输入产出去重文件名、`STORE` 模式 zip 可正常解压。

### Task 12 — probe 脚本 + 测试 fixture 多视频化
- `scripts/probe-capcut-zip.ts`：改用 2-3 个本机真实 mp4，构造带 `assemblyTimeline`（含 transitions）的 mock `match`，跑完整多视频 + 转场链路产出 zip。
- `tests/capcut-compiler/*.test.ts`：共享 `CompileInput`/`PackageInput` fixture 同步改成数组形态。
- 依赖：Task 9、Task 10、Task 11。
- 验证：`npx tsx scripts/probe-capcut-zip.ts` 产出 zip → 本机 CapCut 打开 → 多视频按序拼接 + 转场可见 + 不报 "Couldn't link"。

### Task 13 — 前端结果区 AssemblySummary + CapCutExport 数组化
- 新增 `components/technique-match/AssemblySummary.tsx`（轻量列表，**非时间轴可视化**）：展示「AI 把你的 N 段素材编排成了：素材3 → 素材1（叠化）→ 素材2（硬切）…」，每片段显示用了哪个素材/取了哪段/接哪种转场。理由：用户不调序，编排结果只需"可读确认"不需"可编辑"。
- `components/technique-match/ResultsArea.tsx`：渲染 N 个 `UserDiagnosis`（每素材一张，数据来自 `partials[]` / `full.userPotentials[]`）+ `AssemblySummary`；props `videoUrl/videoFileName` → 数组，透传 `CapCutExport`。
- `components/technique-match/CapCutExport.tsx`：props + POST body 数组化（BGM 仍单文件，逻辑不变）；文案微调。
- 依赖：Task 3、Task 5。
- 验证：`npm run dev -- -p 3001` 浏览器实测多素材结果区渲染 + 导出。

### Task 14 — 端到端联调 + deploy 验证 + 移除兼容层
- preview 环境跑全链路：6 素材上传 → 分析 → 编排 → 编译 → 下载 → CapCut 打开。
- 确认无误后移除 Task 1 引入的单值兼容层，两个 API 的 Zod schema 收紧为纯数组。
- 依赖：Task 1-13 全部。
- 验证：preview 环境真实素材冒烟测全绿；本机 CapCut 打开多视频草稿正确。

---

## 依赖图

```
Task 1 (契约冻结) ──┬──> Task 3 (前端上传)
                    ├──> Task 4 (分析:N视频+并行Gemini) ──> Task 5 (分析:Opus编排)
                    └──> Task 7 (编译:route+assets)
Task 2 (转场探测) ──┬──> Task 6 (编译:schema转场类型)
                    ├──> Task 8 ──> Task 10
                    └──> Task 10 (编译:接入真转场)  ★merge前本机CapCut实测
Task 5 + Task 6 ──> Task 8 (编译:edit-plan编排+转场时间轴)
Task 6 + Task 7 + Task 8 ──> Task 9 (编译:build多material)
Task 9 ──> Task 10 / Task 11 (编译:package)
Task 9 + 10 + 11 ──> Task 12 (probe脚本+fixture)
Task 3 + Task 5 ──> Task 13 (前端结果区)
全部 ──> Task 14 (端到端+移除兼容层)
```

执行顺序：**1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14**。

**MVP 兜底**：若 Task 2 探测发现真转场不可行，Task 8/10 降级为硬切+叠化占位，其余 task 不变，仍可 ship「多视频上传 + AI 编排 + 裁剪拼接」，真转场推迟。

---

## 影响分析

**用户体验**：心智从「剪我的视频」变成「用素材库拼一条」；等待时间显著变长（N 次 Gemini），需更细进度反馈（per-material partial 点亮 + 上传计数）；新增「AI 编排了什么」确认环节；失败面随 N 线性上升，需清晰的「哪个素材出问题」提示。

**成本**：Gemini 从 1 次 → N 次（5-6 倍，最大成本增量，每个视频必须独立看无法绕开）；Opus 单次但 input token 增大（N 个 potential 进 prompt），约 2-4 倍 input + output 增大；Vercel Blob 单次 export 上传 N 个视频 + 1 个 zip（约 6 倍），`addRandomSuffix` 不自动清理 —— Blob 无 TTL 的 backlog 变紧迫。建议 MVP 上线后监控成本，必要时 `MAX_FILES` 先设 5。

**Vercel 超时（最大技术风险）**：
- `/api/technique-match`（300s）：串行 N=6 必超时；并行 Gemini + poll 收紧 + `allSettled` 容忍部分失败后 ~250-300s，仍贴上限。Task 4 探测点。
- `/api/compile-capcut`（120s）：6 视频下载 + ffprobe + build + ~180MB zip + Blob 上传估算 25-70s，有尾部风险；并发下载 + zip 改 STORE + 单文件大小上限缓解。兜底若仍超时需异步 job 化（超本次范围，标 backlog）。

**zip 体积**：单 zip 从 ~30MB 涨到 ~180MB，前端需给用户体积/下载时长预期。

**向后兼容**：`assemblyTimeline`/`userVideoIds`/`videoUrls` 全 optional 或带兼容层；`trimRanges` 保留 → 旧单视频分析结果仍可导出；编译层无 `assemblyTimeline` 时退化为单视频线性编译。风险点是前后端发布不同步，靠兼容层兜一个发布周期，Task 14 才移除。

**只能 deploy 后验证的部分**：Vercel function 真实超时行为（本地 dev 无超时限制）；Blob 并发上传表现；Gemini/Opus 在 Vercel 网络下 N 次调用的真实耗时与 rate limit；大 zip 写 Blob + CDN 下载链路。**CapCut 草稿能否正确打开（多 material 路径、转场资源）连 deploy 都验不全，需人工在 CapCut 桌面端打开确认**。建议每个后端 task（4/5/7/9/10）merge 后立即在 preview 冒烟测，不要攒到 Task 14。

---

## 探测点汇总（高不确定性，需实测）

1. **Task 2**：CapCut transition material 字段结构、≥3 种转场 effect_id、「重叠 vs 缩短」时间轴语义、转场挂前段还是后段。**阻塞 Task 6/8/10，且决定真转场是否可行。**
2. **Task 4**：Gemini N 路并行是否触发 429；并行后总墙钟能否压进 300s。
3. **Task 5**：Opus 能否稳定输出合法 `sourceVideoIndex`；`max_tokens` 在 N=6 下是否够。
4. **Task 9**：尺寸不一致片段的 `fitScale` × keyframe 基线相乘易出 bug。
5. **Task 10**：转场逆向正确性 —— merge 前必须本机 CapCut 实测。
