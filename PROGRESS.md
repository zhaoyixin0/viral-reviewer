# 进度跟踪

## ✅ 已完成

### v1 创作者评审（生产可用）

- [x] Next.js 15 + Tailwind v4 + Framer Motion 项目骨架
- [x] Framer 风格暗色 UI（首页 / 评审页 / 爆款库）
- [x] Apify TikTok 抓取（180 条真实视频，6 题材 × 30）
- [x] Apify Instagram 抓取（119 条真实 Reels）
- [x] Claude Haiku 4.5 富化（299 条全部标注 playStyle / visualStyle / hook）
- [x] Claude Opus 4.7 评审引擎（6 维创作者视角评分）
- [x] 视频上传 pipeline（Vercel Blob 客户端直传 + FFmpeg + Whisper + Haiku Vision）
- [x] LLM hashtag 生成器（题材 → 真实 hashtag）
- [x] 实时按题材抓取模块（cache miss 时触发 Apify）
- [x] Vercel Blob 周缓存（ISO 周键，自然周更新）
- [x] 流式 NDJSON 进度反馈（前端 ProgressTimeline）
- [x] Retrieval matched / unmatched 分流（库内有 → 直接用，库内无 → 实时抓 → 跨题材兜底）
- [x] 部署到 Vercel（https://viral-reviewer.vercel.app）

### v2 模板审核 阶段 1（生产可用）

- [x] 7 维立项评审 prompt（含市场验证度，源自 effect-production-reviewer skill）
- [x] 趋势分析师 prompt（探索方向用）
- [x] LLM 文档结构化抽取（题材 / 玩法 / 视觉 / hashtags）
- [x] `/api/template-review` 流式 API（审核脑暴）
- [x] `/api/template-explore` 流式 API（探索方向）
- [x] 输入面板 AuditPanel + ExplorePanel
- [x] 输出展示 AuditOutput（verdict + 7 维 + 市场信号 + 能力清单 + 建议 + 拷问 + 行动）
- [x] 输出展示 ExploreOutput（大盘观察 + 5-8 条赛道 + 应避方向，含数据驱动 / LLM 推断标注）
- [x] Header nav 加「模板审核」入口
- [x] 部署到 Vercel（https://viral-reviewer.vercel.app/template-review）

---

## ⏳ 进行中

### v2 模板审核 阶段 2 — 完整三件套生产线

#### Phase 1 · Generator 专业版（~5.5h）

接入 effect-idea-generator v0.3 skill：

- [ ] `lib/template-review/capabilities-dict.ts` — ~40 个 AI/特效/工具能力字典（含 disambiguation）
- [ ] 7 种发散方法 prompt templates（SCAMPER / 第一性原理 / 逆向 / 跨域 / 极限 / 隐喻 / 消除约束）
- [ ] Generator system prompt（集成 Rule 9-16 全部 8 条治理规则）
- [ ] 对比模式（选 2 法 → 并发 → 合并 + 气质差异总结）
- [ ] 实时大盘集成（调 `retrieveSimilarVideos(scene)` 注入 benchmark）
- [ ] `/api/template-brainstorm` 流式 API
- [ ] BrainstormPanel UI
- [ ] BrainstormOutput UI（14 字段 idea 卡片 + market_reference 引用 + 对比模式双栏）

#### Phase 2 · VISENTCM 完整算法（~4h）

接入 effect-idea-scorer v3.4 / 算法 v3.3 skill：

- [ ] Types + 7 题材权重 + 产品功能权重
- [ ] 完整公式（加权和 + 短板罚 + VS/EH 协同 + T·P 双门槛 + C 修正 + 系列加分）
- [ ] 对数压缩 `5.0 × (1 - e^(-2.5 × raw / 5.0))`
- [ ] S/A/B/C/D 阈值映射 + Pick 概率
- [ ] Scorer system prompt（让 Opus 4.7 输出 1-4 整数维度分）
- [ ] `/api/template-score` 流式 API
- [ ] 趋同性降权（Vercel Blob 评分历史 + LLM 主题标签 + 时间衰减）
- [ ] ScorerPanel + ScorerOutput

#### Phase 3 · 4 tab 整合 + 联动（~1.5h）

- [ ] `/template-review` 升级 4 tab + sticky tabs
- [ ] 一键联动：Generator → Scorer → Reviewer
- [ ] Header nav 调整 + 整体 UX 打磨

#### Phase 4 · 部署 + 测试（~30min）

- [ ] vercel deploy --prod
- [ ] 端到端测试两个新 tab
- [ ] 提案前最后调优

---

## 📋 待规划（v3）

- [ ] 飞书 OAuth + 文档抓取（双写：评审意见写回原文档）
- [ ] 季度趋势分析（需多周历史快照累积，4 周后才能跑）
- [ ] 视觉模型识别 BGM 具体歌名（接 ACRCloud）
- [ ] 完整 capabilities_dict.yaml 扩展（用户级自定义能力字典）
- [ ] Snapchat Lenses + CapCut 模板抓取
- [ ] Postgres + pgvector（取代 JSON loadVideos）

---

## 当前线上版本

| 入口 | 状态 | 说明 |
|---|---|---|
| https://viral-reviewer.vercel.app | ✅ Live | 首页 |
| https://viral-reviewer.vercel.app/review | ✅ Live | v1 创作者评审 |
| https://viral-reviewer.vercel.app/library | ✅ Live | 爆款库（299 条） |
| https://viral-reviewer.vercel.app/template-review | ✅ Live | v2 阶段 1（审核脑暴 + 探索方向） |

---

## 已知问题 / 限制

1. Apify Instagram hashtag-scraper 免费版限制单页抓取（每 hashtag 10 条）
2. Claude Opus 4.7 单次评审 80-120 秒（reasoning model 正常耗时）
3. 移动端流式 stream 在网络抖动时偶尔会中断（需要 retry 机制 — v3）
4. 视频上传后特征提取在 Vercel function 上耗时较长（30 秒左右），可能触发 maxDuration 边缘
