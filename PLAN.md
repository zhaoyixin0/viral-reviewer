# Viral Reviewer · 完整产品计划

> 基于 TikTok / Instagram Reels 真实爆款数据的 AI 评审系统。双轨产品：创作者侧 + 内部 PM 侧。

## 产品定位

完整还原 **TikTok 内部三件套生产线**，并接入实时大盘数据：

```
脑爆发散 (Generator)  →  Idea 评分 (VISENTCM)  →  立项审核 (Reviewer)
       ↓                      ↓                      ↓
   v0.3 skill              v3.4 skill          已集成 (effect-production-reviewer)
```

加上一条**对外（创作者侧）**的子产品线，用于内容创作者优化单条视频。

---

## 双轨架构

### 轨道 A · 创作者侧（v1，已上线）
入口：`/review`
用户：内容创作者（TikTok / IG）
价值：把任意视频想法或草稿，基于真实同题材爆款数据，给出 6 维评分 + 按秒优化时间轴 + 四段式建议。

| 6 维 | 含义 |
|---|---|
| 钩子强度 | 前 0-3 秒视觉冲击 / 数字断言 / POV |
| 身份认同 | 用户发这条是为了证明什么 |
| 节奏密度 | 剪辑卡点 / 字幕节拍 / BGM 卡点 |
| 算法友好度 | 标签 / 文案 / BGM / 时长 |
| 视觉质感 | 统一性 / 审美门槛 |
| 传播性 | 彩蛋 / 反差 / 可模仿性 |

输入支持：
- A. 文字描述（题材 + 受众 + 场景 + 草稿）
- C. 视频上传 → FFmpeg 抽 6 帧 + Whisper 转录 + Claude Haiku Vision 分析

### 轨道 B · 内部 PM 侧（v2，进行中）
入口：`/template-review`
用户：TikTok 特效产品团队
价值：完整还原内部脑暴 → 评分 → 立项生产线 + 大盘趋势探索。

**4 个子模式**（4 tab）：

```
├── 脑爆生成 (Generator v0.3)       — 输入「能力 × 玩法 × 目标 × 场景」→ 6-12 条结构化 idea
├── Idea 评分 (VISENTCM v3.4)       — 输入单/批 idea → 8/9 维评分 + S/A/B/C/D + Pick 概率
├── 审核脑暴 (Reviewer)              — 完整脑暴文档 → 7 维立项评审（含市场验证度）
└── 探索方向 (Explore)               — 大盘扫描 → 5-8 条赛道推荐
```

**联动**：脑暴生成产出 → 一键转评分 → 高分进入审核 → 通过立项。

---

## 技术架构

### 数据底层

| 层 | 实现 |
|---|---|
| 真实爆款库 | TikTok 180 + Instagram 119 = 299 条已富化（playStyle / visualStyle / hook 全标注） |
| 实时抓取 | Apify TikTok / Instagram scraper（按 hashtag）|
| Vercel Blob 周缓存 | 题材 → hashtags → 抓取 → 富化 → 缓存（ISO 周键） |
| 数据来源策略 | 本地 enriched → Blob 周缓存 → 实时抓取 → 全量爆款 fallback |

### LLM 分层

| 任务 | 模型 | 理由 |
|---|---|---|
| 评审引擎（v1 + v2 审核 + v2 评分 + v2 探索 + v2 生成） | Claude Opus 4.7 | reasoning 深度 + 高质量输出 |
| 数据富化（playStyle/visualStyle/hook） | Claude Haiku 4.5 | 单字段分类，性价比 |
| Hashtag 生成 | Claude Haiku 4.5 | 简单分类任务 |
| Vision 视频分析 | Claude Haiku 4.5 | 多帧分析，速度优先 |
| Whisper 音频转录 | OpenAI whisper-1 | Anthropic 还没做转录 |

### 流式进度

所有评审 API 用 NDJSON streaming：
- 后端：ReadableStream，每个阶段 emit `{type: "stage", stage, message, data}`
- 前端：fetch + reader 解析，更新 ProgressTimeline

阶段示例：
```
📚 在本地爆款库中检索同题材…
🗂️ 本周缓存中查找「美食探店」爆款样本…
🔍 缓存未命中，实时搜索 TikTok / Instagram「美食探店」爆款…
🏷️ 已选 hashtag: foodie, foodtok, hiddengem, ...
🎵 在 TikTok 搜索同题材爆款…
📸 在 Instagram Reels 搜索同题材爆款…
🤖 分析 10 条视频的玩法/视觉/hook…
🧠 anthropic/claude-opus-4-7 评审中…
```

---

## 知识资产（v0.3 / v3.4 skills）

### lib/review-engine/knowledge/

- `creator-growth.ts` — 创作者增长视角（v1 用，包含算法逻辑、节奏、身份认同、彩蛋等）
- `template-pm.ts` — TikTok 特效产品 PM 视角（v2 审核脑暴用）

### lib/template-review/

- `audit-prompt.ts` — 7 维立项评审 prompt（含市场验证度）
- `explore-prompt.ts` — 趋势分析师 prompt（推荐赛道 + 推荐特效模板）
- `brainstorm-prompt.ts` — Generator v0.3 prompt（含 Rule 9-16）【Phase 1 待建】
- `score-prompt.ts` — VISENTCM v3.4 维度打分 prompt【Phase 2 待建】

### lib/visentcm/【Phase 2 待建】

- `weights.ts` — 7 题材权重矩阵 + 产品功能权重
- `formula.ts` — raw 计算（加权和 + 短板罚 + VS/EH 协同 + T·P 双门槛 + C 修正 + 系列加分）
- `log-compress.ts` — `5.0 × (1 - e^(-2.5 × raw / 5.0))` 对数压缩
- `threshold.ts` — S/A/B/C/D 阈值
- `theme-history.ts` — Vercel Blob 评分历史 + LLM 主题标签提取 + 时间衰减降权

---

## v2 待建 Phase 1 — Generator 专业版（~7.5h，含 PDF 输入管线）

按"独立可测"原则拆 5 个 Stage。每个 Stage 完成后都能单独验证。

### Stage 0 — PDF 抽取管线（2h，独立可测）

PDF 上传作为 4 件套填表的替代输入。将来飞书文档接入复用同一管线。

| 子任务 | 文件 | 时长 |
|---|---|---|
| 装 `pdf-parse` (纯 JS / serverless 友好 / 1MB) | `package.json` | 15min |
| PDF 解析 + Haiku 抽取 4 件套 + briefSummary 1500 字 | `lib/template-review/brief-extract.ts` | 45min |
| `POST /api/template-brief` multipart 上传 → 返回 ExtractedBrief | `app/api/template-brief/route.ts` | 45min |
| curl 冒烟测试 | — | 15min |

`ExtractedBrief` schema：
- capabilities: string[] — 抽取出的能力
- playbookTypes: ("A" \| "B" \| "C")[]
- goals: { name; weight? }[]
- scene / userProblem
- briefSummary — 1500 字以内 PDF 原文片段（保留给 LLM 引用）
- confidence: 0-1

### Stage 1 — Generator 核心知识（3h）

| 子任务 | 文件 | 时长 |
|---|---|---|
| ~40 个能力字典（AI / VFX / Tool 三类，含 disambiguation） | `lib/template-review/capabilities-dict.ts` | 1h |
| 7 种发散法 prompt 片段 | `lib/template-review/divergence-methods.ts` | 1h |
| 主 system prompt（Rule 9-16 + 14 字段 schema + briefSummary/benchmark 引用规则） | `lib/template-review/brainstorm-prompt.ts` | 45min |
| 复用 `retrieveSimilarVideos`（不需新建） | — | 15min |

### Stage 2 — Generator API + 对比模式（2h）

| 子任务 | 文件 | 时长 |
|---|---|---|
| 流式 NDJSON：retrieval → benchmark 注入 → LLM | `app/api/template-brainstorm/route.ts` | 1h |
| 对比模式：并发 2 次 LLM + compareSummary 强制推荐一方向 | 同上 | 45min |
| 多样性警告（关键词 jaccard，>70% 同主题报警） | 同上 | 15min |

### Stage 3 — UI（2.5h）

| 子任务 | 文件 | 时长 |
|---|---|---|
| 拖拽上传 + 解析预览 + 错误处理 | `components/template-review/BriefUploader.tsx` | 45min |
| 表单（4 件套 + 7 法 dropdown + 对比开关 + 顶部 BriefUploader） | `components/template-review/BrainstormPanel.tsx` | 1h |
| 14 字段卡片 + market_reference + 对比双栏 + 警告 banner | `components/template-review/BrainstormOutput.tsx` | 45min |

### Stage 4 — 接入 4 tab + 部署（30min）

升级 `app/template-review/page.tsx` 加第 3 tab "脑爆生成" → vercel deploy → 端到端测。

### Generator v0.3 输入 schema（4 件套 + 增强）

- capabilities[] — 多选能力字典
- playbook_types[] — A 内容 / B 功能链路 / C 机制
- goal[] — 多选目标 + 权重（传播 / 留存 / 付费 / 人设沉淀 / 功能拉新）
- scene — 场景描述（DM / 直播 / feed / profile / 社交聊天等）
- user_problem — 用户痛点（v0.3 新增）
- divergence_method — 7 选 1，或 2 选 2（对比模式）
- **briefSummary** — 来自 PDF/飞书文档的原文片段（系统注入，用户不直接编辑）

### 输出每条 idea 完整 14 字段（v0.3）

- highlight / core_play / output_form
- context_signals / user_intent_gap / user_motivation / interaction_flow
- ai_necessity / goal_fit
- playbook_mix / capabilities_used
- consumption_hook / interaction_motivation
- risk（分类：频次骚扰 / 隐私边界 / 转化摩擦 / 合规红线）
- **market_reference** — 我们的增强：自动附 1-2 条真实 TikTok / IG 爆款引用 + 差异化判断

### 强制治理规则（Rule 9-16）

- DM 场景边界
- 低频异步 DM 基线
- IP 不可替代性自证
- AI 必要性自证（最关键）
- 嵌入高频动作 ROI 底线
- 玩法类型不混淆
- 反「任务存在即参与」假设
- 具体机制 vs 空话

### 关键决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | PDF 库选 `pdf-parse` | 纯 JS / serverless 友好 / 1MB；pdfjs-dist 太重且需 worker |
| D2 | 抽取用 Haiku 4.5 | 轻量结构化抽取，比 Opus 便宜 30x |
| D3 | briefSummary 上限 1500 字 | 不挤压 main prompt 的 token 预算 |
| D4 | PDF 走 multipart 直传 | 10MB / 30 页内，不需要 Vercel Blob |
| D5 | 对比模式并发 2 次 LLM | 一次 prompt 写 2 方法会偏向其一 |
| D6 | 多样性警告后处理（不让 LLM 自判） | LLM 自评容易撒谎，用 jaccard 客观 |

### 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 扫描版 PDF（图片）pdf-parse 解析为空 | 检测到空文本即报错"请上传文字版 PDF"，不做 OCR |
| R2 | scene 不一定能映射到数据库 topic | 让 Haiku 从 scene 抽 topic 关键词后再 retrieval |
| R3 | 对比模式 12 条 idea 重叠 | 合并 prompt 强制要求双方法各自独有的角度 |
| R4 | briefSummary 简单 substring 会断段 | 取含数字 / 引号 / 标题词的整段优先，按段落边界切 |

---

## v2 待建 Phase 2 — VISENTCM 完整算法（~4h）

### 维度

**内容玩法 8 维**：
- V Viral 病毒传播力（核心加权）
- I Interaction 交互体验（核心加权）
- S Surprise 惊喜感（核心加权）
- E Emotion 情感共鸣（核心加权）
- N Narrative 叙事完整性（核心加权）
- M Market 趋势契合度（核心加权）
- T Technical 技术可行性（**乘法门槛**：T=1→×0.50, T=2→×0.75, T≥3→×1.00）
- C Creator 生态开放性（**加法修正**：C=1→-0.15, C=2→-0.08, C=3→0, C=4→+0.05, C=5→+0.10）

**产品功能 9 维（追加 R/H/G + P 门槛）**：
- R Reciprocity 双向性（核心加权）
- H Habit 留存习惯（核心加权）
- G Growth 变现潜力（核心加权）
- P Privacy 隐私合规（**乘法门槛**：P=1→×0.30, P=2→×0.65, P≥3→×1.00）

### 公式

```
内容玩法:
raw = (Σ(6核心维度 × 题材权重) + 短板罚 + VS协同) × T门槛 + C修正 + 趋同降权 + 系列加分
total = 5.0 × (1 - e^(-2.5 × raw / 5.0))

产品功能:
raw = (Σ(9核心维度 × 产品权重) + 短板罚 + EH协同) × T门槛 × P门槛 + C修正 + 趋同降权
total = 5.0 × (1 - e^(-2.5 × raw / 5.0))
```

### 7 题材权重矩阵

| 维度 | 特效玩法 | 创意人像 | 视频风格 | 图片风格 | AI模板 | 素材包装 |
|---|---|---|---|---|---|---|
| V | 25% | 28% | 18% | 18% | 28% | 18% |
| I | 20% | 10% | 10% | 10% | 10% | 10% |
| S | 18% | 15% | 12% | 12% | 17% | 12% |
| E | 12% | 22% | 17% | 17% | 17% | 22% |
| N | 10% | 7% | 22% | 7% | 17% | 12% |
| M | 15% | 18% | 21% | 36% | 11% | 26% |

### 评级阈值

| 评级 | 压缩后总分 | Pick 概率 |
|---|---|---|
| S | ≥ 4.40（仅回测） | > 80% |
| A | 3.80 – 4.39（新 idea 天花板）| 50–80% |
| B | 2.80 – 3.79 | 20–50% |
| C | 1.80 – 2.79 | 5–20% |
| D | < 1.80 | < 5% |

### 趋同性降权（时间衰减）

| 时间窗口 | 降权幅度 | 状态乘数 |
|---|---|---|
| 0-7 天 | 不降权 | viral×1.3, launched×1.2, picked×1.0 |
| 8-30 天 | -0.15 | |
| 31-90 天 | -0.25 | |
| 91-180 天 | -0.15 | |
| > 180 天 | -0.05 | |

降权上限：-0.80。

### 实施

| 子任务 | 工作量 |
|---|---|
| Types + 7 题材权重 + 产品权重 | 30min |
| 完整公式（含对数压缩 + 短板罚 + 协同 + 双门槛 + 修正）| 1.5h |
| Scorer system prompt（让 Opus 4.7 输出 1-4 整数维度分） | 30min |
| `/api/template-score` 流式 API | 30min |
| 趋同降权（Vercel Blob 评分历史 + LLM 主题标签 + 时间衰减） | 1h |
| ScorerPanel + ScorerOutput | 1h |

---

## v2 待建 Phase 3 — 4 tab 整合 + 联动（~1.5h）

- `/template-review` 升级 4 tab + sticky tabs
- 一键联动：Generator idea 卡片「→ 评分这一条」/ Scorer 高分「→ 立项审核」
- Header nav 调整 + 整体 UX 打磨

---

## v2 待建 Phase 4 — 部署 + 测试（~30min）

---

## 总工作量与节奏

**总：~11.5 小时**（含实时大盘集成）

**建议交付节奏**：
- **Phase 1**（~5.5h）：Generator 专业版，独立上线即可测试
- **Phase 2 + 3 + 4**（~6h）：VISENTCM + 4 tab 整合 + 部署

---

## 风险

1. **能力字典覆盖**：基础版 ~40 个能力，可能不够覆盖团队真实场景。后续可增量补充。
2. **对比模式 UI**：移动端会折叠双栏。
3. **趋同降权冷启动**：第一次评分时历史库为空，需要先评 5-10 条 idea 才会触发趋同检测。

---

## 上线状态

- v1（创作者侧）：✅ 上线 https://viral-reviewer.vercel.app
- v2 阶段 1（审核脑暴 + 探索方向）：✅ 上线 https://viral-reviewer.vercel.app/template-review
- v2 阶段 2（脑暴生成 + Idea 评分）：⏳ Phase 1 + 2 待建
- 双写功能（写回飞书 doc）：v3 计划

---

## 下一步行动

1. 用户测试 v1 + v2 阶段 1 现有功能
2. 启动 Phase 1 Generator 专业版（含实时大盘集成）
3. Phase 2 VISENTCM 完整算法
4. Phase 3 4 tab 整合
5. Phase 4 部署
