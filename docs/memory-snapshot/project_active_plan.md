---
name: 当前活动计划 (Phase 1/2/3/4)
description: v2 阶段 2 待办的完整任务分解、工作量估算、交付节奏
type: project
originSessionId: 1bde1864-7990-4c58-a89b-9bd90cc5fe1e
---
## 总进度

- v1（创作者侧 /review）：✅ 上线
- v2 阶段 1（/template-review，2 tab：审核脑暴 + 探索方向）：✅ 上线
- v2 阶段 2（4 tab 完整生产线）：⏳ 进行中

## v2 阶段 2 = Phase 1 + 2 + 3 + 4

### Phase 1 · Generator 专业版（~5.5h）

接入 effect-idea-generator v0.3 skill。**用户明确要专业版（含完整能力字典 + 对比模式）**。

新建文件：
- `lib/template-review/capabilities-dict.ts` — ~40 个 AI/特效/工具能力字典（含 disambiguation）
- 7 种发散方法 prompt templates 文件（SCAMPER / 第一性 / 逆向 / 跨域 / 极限 / 隐喻 / 消除约束）
- `lib/template-review/brainstorm-prompt.ts` — 集成 Rule 9-16
- `app/api/template-brainstorm/route.ts` — 流式 API
- `components/template-review/BrainstormPanel.tsx`
- `components/template-review/BrainstormOutput.tsx`

关键集成点：
- **必须**接入实时大盘数据：在调 LLM 之前调 `retrieveSimilarVideos(scene)`，注入 benchmark.viralVideos 给 Generator system prompt
- **对比模式**：用户选 2 种发散法 → 并发跑 2 次 LLM → 合并 + 末尾"气质差异总结"
- **多样性警告**：>70% idea 聚在同一主题时输出警告

### Phase 2 · VISENTCM 完整算法（~4h）

接入 effect-idea-scorer v3.4 + 算法 v3.3 skill。

新建文件：
- `lib/visentcm/types.ts`
- `lib/visentcm/weights.ts` — 7 题材权重矩阵 + 产品功能权重
- `lib/visentcm/formula.ts` — 完整公式（短板罚 + 协同 + 双门槛 + 修正 + 系列加分）
- `lib/visentcm/log-compress.ts` — 5.0 × (1 - e^(-2.5x/5))
- `lib/visentcm/threshold.ts` — S/A/B/C/D + Pick 概率
- `lib/visentcm/theme-history.ts` — Vercel Blob 评分历史 + LLM 主题标签 + 时间衰减降权
- `lib/visentcm/score-prompt.ts` — Opus 4.7 出 1-4 维度分
- `app/api/template-score/route.ts` — 流式 API
- `components/template-review/ScorerPanel.tsx`
- `components/template-review/ScorerOutput.tsx`

### Phase 3 · 4 tab 整合 + 联动（~1.5h）

- `app/template-review/page.tsx` 升级 4 tab + sticky tabs
- 一键联动：Generator idea 卡片右上角「→ 评分这一条」按钮（自动跳到 Scorer + 预填）
- Scorer 高分（A/S）卡片「→ 立项审核」按钮（自动跳到 Reviewer + 预填）

### Phase 4 · 部署测试（~30min）

- vercel deploy --prod
- 端到端测试 4 tab
- 提案演示前最后调优

## 用户决策记录

- **1 · VISENTCM 实现深度**：完整版 — LLM 出 1-4 维度分 → JS 跑公式 → 对数压缩 → 输出 S/A/B/C/D
- **2 · 主题趋同性降权**：用 Vercel Blob 评分历史（每次评分自动累积，从此有趋同检测）
- **3 · Generator 实现深度**：专业版 = 4 件套 + 7 发散法 + 内置精简能力字典 + 对比模式

## 交付节奏建议（已与用户确认 11.5h 总量）

- **第一天**（~5.5h）：Phase 1 Generator 上线，可独立测试
- **第二天**（~6h）：Phase 2 + 3 + 4

## 风险

1. 能力字典 ~40 个不够覆盖团队真实场景 — 后续可在 capabilities-dict.ts 增量补充
2. 对比模式 UI 移动端会折叠双栏
3. 趋同降权冷启动：第一次评分历史库为空，需先评 5-10 条触发检测（提案前要预热）
