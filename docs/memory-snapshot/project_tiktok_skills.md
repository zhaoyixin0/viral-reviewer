---
name: TikTok 内部三件套 skill 资产位置
description: Generator v0.3 / VISENTCM v3.4 / effect-production-reviewer 三个内部 skill 的内容、位置、当前集成状态
type: project
originSessionId: 1bde1864-7990-4c58-a89b-9bd90cc5fe1e
---
## 三件套生产线

```
脑爆发散 (Generator)  →  Idea 评分 (VISENTCM)  →  立项审核 (Reviewer)
```

## skill 1 · effect-production-reviewer（已集成）

- **来源**：作者 Yixin Zhao 提供，用户在 2026-04-29 给的本地路径 `C:\Users\Admin\Downloads\effect-production-reviewer\effect-production-reviewer\`
- **集成位置**：`lib/review-engine/knowledge/template-pm.ts`（保留作为 v2 模板 PM 视角的 ground truth）
- **核心资产**：
  - 爆款 3 要素（极致底模 / 身份认同 / 预设惊喜）
  - 精品 3 要素（空间续写 / 叙事包装 / 高阶审美）
  - 6 维评审：创新性 / 传播潜力 / 交互易用性 / 技术可行性 / 性能稳定性 / 合规风险
  - 性能红线（>15s 高风险 / >30s 转化差 / >60s 极差）
  - 四段式批评结构（问题 → 影响 → 建议 → 对标）
- **当前用途**：v2 「审核脑暴」tab 的 audit-prompt 基础（额外加了一维「市场验证度」共 7 维）

## skill 2 · effect-idea-generator v0.3（待集成 Phase 1）

- **来源**：用户在 2026-04-30 提供完整 SKILL.md + PDF 说明书
- **官方入口**：https://mira.bytedance.com/app-link/customize?page=skills%2Fdetail&share_key=cs_108611618323
- **使命**：不做整理、不做评审、只做发散
- **输入四件套**：capabilities × playbook_types(A/B/C) × goal × scene
- **v0.3 新增**：user_problem 字段
- **7 种发散方法**：SCAMPER / 第一性原理 / 逆向思维 / 跨域类比 / 极限情境 / 隐喻类比 / 消除约束
- **对比模式**：传 2 个方法各出一半 idea + 气质差异总结
- **能力字典**：capabilities_dict.yaml（要建一个精简版 ~40 个 AI/特效/工具能力，含 disambiguation）
- **每条 idea 14 字段输出**：highlight / core_play / output_form / context_signals / user_intent_gap / user_motivation / interaction_flow / ai_necessity / goal_fit / playbook_mix / capabilities_used / consumption_hook / interaction_motivation / risk
- **8 条治理规则 Rule 9-16**：
  - DM 场景边界
  - 低频异步 DM 基线
  - IP 不可替代性自证
  - **AI 必要性自证**（最关键）
  - 嵌入高频动作 ROI 底线
  - 玩法类型不混淆
  - 反「任务存在即参与」假设
  - 具体机制 vs 空话
- **我们的增强**：必须接入实时大盘数据（调 retrieveSimilarVideos(scene) 注入 benchmark），原版只用通用网络搜索（producthunt/medium 等），我们用 TikTok+IG 真实爆款，**这是核心差异化**

## skill 3 · VISENTCM v3.4 + 算法 v3.3（待集成 Phase 2）

- **来源**：用户在 2026-04-30 提供完整 SKILL.md + PDF 说明书
- **官方入口**：https://mira.bytedance.com/app-link/customize?page=skills%2Fdetail&share_key=cs_108519324947
- **共享 Base**：https://bytedance.sg.larkoffice.com/base/IxU7b8W2kaUQjhsK9pdlj9Ergmh（飞书多维表格）
- **核心定位**：把脑暴产出转化为可量化、可复现、可横向对比的结构化评分
- **维度**：
  - 内容玩法 8 维：V/I/S/E/N/M（核心加权）+ T（×乘法门槛）+ C（+加法修正）
  - 产品功能 9 维：上述 + R/H/G + P（双门槛）
- **公式**：raw = (Σ维度×权重 + 短板罚 + 协同) × 门槛 + 修正 + 趋同降权 + 系列加分
- **对数压缩**：total = 5.0 × (1 - e^(-2.5 × raw / 5.0))
- **评级**：S(>=4.40，仅回测) / A(3.80-4.39，新 idea 天花板) / B(2.80-3.79) / C(1.80-2.79) / D(<1.80)
- **关键设计**：新 idea 严禁打 5 分，4 分压缩后约 4.31（A 级天花板），保证 S 级稀缺性
- **7 题材权重矩阵**：特效玩法 / 创意人像 / 视频风格 / 图片风格 / AI模板 / 素材包装 / 产品功能
- **趋同性降权**：时间衰减（0-7天不降权 / 8-30 天 -0.15 / ...）+ 状态乘数（viral×1.3 / launched×1.2）
- **我们的简化**：v2 不接飞书 Base，用 Vercel Blob 存评分历史（按周累积）实现趋同检测

## v2 与 v1 的角色定位差异（重要）

- **v1 创作者侧** 6 维：钩子强度 / 身份认同 / 节奏密度 / 算法友好度 / 视觉质感 / 传播性
- **v2 PM 侧 立项 7 维**：创新性 / 传播潜力 / 交互易用性 / 技术可行性 / 性能稳定性 / 合规风险 / 市场验证度
- **v2 PM 侧 评分（VISENTCM）** 8/9 维：V/I/S/E/N/M/T/C 或 V/I/S/E/N/M/R/H/G/T/P/C
- **不要混用**：创作者侧维度跟 PM 侧维度面向不同问题，不要把任何一套当唯一正确答案

## 用户提供的本地资产路径

- effect-production-reviewer skill 目录：`C:\Users\Admin\Downloads\effect-production-reviewer\effect-production-reviewer\`
- effect-idea-generator PDF：`C:\Users\Admin\Downloads\effect-idea-generator_v0.3_—_脑爆发散说明书.pdf`
- VISENTCM PDF：`C:\Users\Admin\Downloads\VISENTCM_v3.4_—_TikTok_特效创意评分系统说明书.pdf`
