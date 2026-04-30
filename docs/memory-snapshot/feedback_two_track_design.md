---
name: 双轨产品设计的决策（创作者侧 + PM 侧）
description: 用户拍板把产品设计成"同一份数据双向赋能"的双轨架构，保留特效 PM ground truth 作 v2 用
type: feedback
originSessionId: 1bde1864-7990-4c58-a89b-9bd90cc5fe1e
---
把产品定位成双轨：**创作者侧（v1）+ TikTok 内部 PM 侧（v2）**，共享真实爆款数据底层，但用不同 system prompt 服务两类用户。

**Why（用户原话）**：「我想把这个内部使用的版本可以覆盖两大类情况。第一种是已经完成了脑暴需要审核，第二种是开始脑暴之前给出方向。」整套设计要让真实大盘数据双向赋能：
- 对内：帮 PM 决定做什么特效模板能让用户做出爆款
- 对外：帮创作者把视频做火

**How to apply**：
- 不要把创作者评审维度（钩子强度 / 节奏密度 等）跟 PM 立项维度（创新性 / 技术可行性 等）混用
- 当用户提到 v2 / 模板审核 / 内部 PM 工作流时，引用 effect-production-reviewer ground truth（template-pm.ts）和 VISENTCM 维度
- 当用户提到 /review 创作者侧时，引用 creator-growth.ts（钩子 / 身份认同 / 算法友好度 / 视觉 / 传播性）
- 旧的 effect-production-reviewer ground truth 当时被搬到 `lib/review-engine/knowledge/template-pm.ts`，专门给 v2 模板审核用 — 不要把它误删，也不要搬回 v1
