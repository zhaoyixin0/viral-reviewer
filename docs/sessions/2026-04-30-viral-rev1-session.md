# Session: 2026-04-30 (continuation from 2026-04-29)

**Started:** 2026-04-29（早些时候做了 v1）
**Last Updated:** 2026-04-30 凌晨左右（跨夜会话）
**Project:** viral-reviewer
**Topic:** 从空目录搭建 TikTok 爆款 AI 评审系统，双轨架构（创作者侧 v1 + 内部 PM 侧 v2），上线到 Vercel

---

## What We Are Building

**Viral Reviewer** — TikTok / Instagram Reels 真实爆款数据驱动的 AI 评审系统。双轨产品：

- **轨道 A · 创作者侧（v1，已上线）** — `/review`：用户输入想法或上传视频草稿 → Claude Opus 4.7 给出 6 维评分（钩子强度 / 身份认同 / 节奏密度 / 算法友好度 / 视觉质感 / 传播性）+ 按秒优化时间轴 + 四段式建议
- **轨道 B · 内部 PM 侧（v2，阶段 1 已上线，阶段 2 进行中）** — `/template-review`：完整还原 TikTok 内部三件套（Generator → Scorer → Reviewer）+ 大盘探索

数据底层：本地 enriched 库（299 条真实 TikTok+IG）→ Vercel Blob 周缓存 → Apify 实时按题材抓取 → fallback。
LLM 分层：Opus 4.7（评审）/ Haiku 4.5（富化、Vision、hashtag）/ Whisper（转录）。

完整产品架构、Phase 1/2/3/4 计划、所有维度定义、公式细节，全部沉淀在 repo 内的 `PLAN.md`、`PROGRESS.md`、`docs/memory-snapshot/`。

---

## What WORKED (with evidence)

### v1 创作者侧（已上线生产）
- **完整 Next.js 15 + Tailwind v4 + Framer 风格 UI** — 确认：dev server 跑通 + production https://viral-reviewer.vercel.app/ 返回 200
- **Apify TikTok scraper（180 条）+ Instagram scraper（119 条）** — 确认：data/scraped/{tiktok,instagram}-2026-04-29.json 文件存在 + scraper 输出"180 videos / 119 videos"
- **Claude Haiku 4.5 富化 299 条视频** — 确认：data/scraped/enriched-2026-04-29.json 存在（444KB）+ 95%+ 字段成功填入 playStyle/visualStyle/hook
- **Claude Opus 4.7 评审引擎** — 确认：PowerShell POST 返回 modelId="anthropic/claude-opus-4-7"，verdict 文本质量极高（如「'早餐+健身+厨房'根本不是一条视频，是空壳选题，按现状必扑」）
- **视频上传 pipeline (Vercel Blob 客户端直传 + FFmpeg + Whisper + Haiku Vision)** — 确认：用户实际上传 1.2MB mp4 后 ffprobe 二进制找到 + 整个 pipeline 跑通（修复了 Vercel function 不打包 ffprobe 二进制的 bug）
- **流式 NDJSON 进度反馈** — 确认：用户在浏览器看到 "📚 检索 → 🔍 实时搜索 → 🎵 TikTok → 📸 IG → 🤖 富化 → 🧠 Opus 4.7" 全程时间线
- **Vercel Blob 周缓存** — 确认：retrieveSimilarVideos 命中 cache 时 source="cache" 字段正确返回
- **题材精确匹配优先（matched 字段）** — 确认：用户测「美食探店」时返回 matched=false（不再被关键词污染成"料理教程"）

### v2 阶段 1（已上线生产）
- **/template-review 双 tab** — 确认：production 页面 200，「审核脑暴」+「探索方向」UI 工作
- **7 维立项评审（含市场验证度）** — 确认：audit-prompt.ts 集成 effect-production-reviewer ground truth + LLM 真实输出含 verdict/scores/marketSignal/capabilities/suggestions/interrogation/actions 全字段
- **探索方向 5-8 条赛道推荐** — 确认：API 流式返回 + 输出含 data_driven/llm_inferred 来源标注
- **顶部 nav 加「模板审核」入口** — 确认：Header.tsx NAV_ITEMS 包含 /template-review

### 部署 & 基础设施
- **Vercel 项目部署成功** — 确认：deployment ID 多次完成（最近 e24fbbb commit 后未重部，但代码 push 到 GitHub 已完成）
- **Vercel Blob store 创建并 link 到项目** — 确认：BLOB_READ_WRITE_TOKEN 在 Production+Preview+Development 三个 env 都存在
- **所有 4 个 secret 在 Vercel env vars** — 确认：vercel env ls 显示 APIFY_TOKEN/ANTHROPIC_API_KEY/OPENAI_API_KEY/BLOB_READ_WRITE_TOKEN 全在
- **GitHub 仓库 push 成功** — 确认：https://github.com/zhaoyixin0/viral-reviewer 主分支有 2 个 commit（6306e26 initial + e24fbbb docs/onboarding）
- **Vercel Authentication Protection 已关闭** — 确认：用户操作后 production URL 公开 200

---

## What Did NOT Work (and why)

- **`@ai-sdk/anthropic@3.x`** — 失败原因：是给 AI SDK v6 的，跟 ai@4.3 不兼容。回退到 `@ai-sdk/anthropic@^1.2.12`
- **AI SDK + Claude Opus 4.7 传 temperature** — 失败原因：Anthropic API 返回 `temperature is deprecated for this model`，AI SDK v4 内部强制传 temperature 默认值。**最终方案**：弃用 AI SDK，改用官方 `@anthropic-ai/sdk` + `openai` 两个 SDK 直接调用
- **max_tokens=4096 给 Opus 4.7** — 失败原因：JSON 输出被截断，`Unterminated string in JSON at position 5379`。提到 16384 解决
- **`vercel logs <url> --follow`** — 失败原因：CLI 不接受这个参数组合，monitor 启动失败 exit 1。改用 `vercel logs <deployment-url>` 后台跑 + tail -f 监控文件
- **`yes y | vercel blob create-store`** — 失败原因：第二个交互 prompt（Select environments）卡住，stdin 已关闭收不到输入。改用 dashboard 手动 link store
- **`node:fs/promises` 导入** — 失败原因：Webpack/Turbopack 报 `UnhandledSchemeError`。改成 `fs/promises`（无 node: 前缀）
- **server-side `await import("node:fs/promises")`** — 失败原因：Next 把这个动态 import 推到 client bundle。改成静态 import + 加 `import "server-only"`
- **`vercel link` 命令在交互式步骤** — 失败原因：bash 模式下交互 prompt 直接 fail，需要传 `--scope zhaoyixin0s-projects` 跳过

### 部署遇到但未真正失败的（已修复）
- **ffprobe 二进制 ENOENT** — 起因：ffmpeg-static 不含 ffprobe，单独装 ffprobe-static + 加 `outputFileTracingIncludes` + `serverExternalPackages` 让 Next.js 把 Linux 二进制打包进 function bundle
- **第一次部署 enriched 数据没上去** — 起因：.gitignore 排除 data/scraped/*.json。修改成 `!enriched-*.json` 例外保留 + 重新部署
- **vercel CLI 操作 .env.local 时把手动写的 keys 覆盖了** — 起因：vercel env pull 自动同步 development env vars 到本地 .env.local。修复：把所有 keys 加到 Vercel project env，之后 vercel env pull 会自动填回

---

## What Has NOT Been Tried Yet

下一步要做的（Phase 1+2+3+4 全部，共 ~11.5h）：

### Phase 1 · Generator 专业版（~5.5h）
- 写 `lib/template-review/capabilities-dict.ts`（~40 个 AI/特效/工具能力，含 disambiguation）
- 写 7 种发散方法 prompt templates（SCAMPER / 第一性原理 / 逆向 / 跨域 / 极限 / 隐喻 / 消除约束）
- 写 Generator system prompt（集成 Rule 9-16 全部 8 条治理规则）
- 实现对比模式（选 2 法 → 并发跑 2 次 → 合并 + 气质差异总结）
- **关键**：API 调 LLM 之前先 `await retrieveSimilarVideos(scene)`，注入真实 benchmark（这是用户明确要求的，是产品差异化）
- `/api/template-brainstorm/route.ts` 流式
- `BrainstormPanel.tsx` UI（能力多选 + A/B/C checkbox + 目标多选权重 + 场景 + 痛点 + 7 法 dropdown + 对比模式开关）
- `BrainstormOutput.tsx` UI（14 字段 idea 卡片 + market_reference 引用 + 对比模式双栏）

### Phase 2 · VISENTCM 完整算法（~4h）
- `lib/visentcm/weights.ts` — 7 题材权重矩阵 + 产品功能 9 维权重
- `lib/visentcm/formula.ts` — 完整公式（短板罚 + VS/EH 协同 + T·P 双门槛 + C 修正 + 系列加分）
- `lib/visentcm/log-compress.ts` — 5.0 × (1 - e^(-2.5x/5)) 对数压缩
- `lib/visentcm/threshold.ts` — S/A/B/C/D 阈值 + Pick 概率
- `lib/visentcm/theme-history.ts` — Vercel Blob 评分历史 + LLM 主题标签 + 时间衰减降权
- `Scorer system prompt`（让 Opus 4.7 出 1-4 整数维度分）
- `/api/template-score` 流式 API
- `ScorerPanel + ScorerOutput` UI

### Phase 3 · 4 tab 整合 + 联动（~1.5h）
- /template-review 升级到 4 tab + sticky tabs
- 一键联动：Generator idea 卡片「→ 评分这一条」 / Scorer 高分「→ 立项审核」

### Phase 4 · 部署测试（~30min）

---

## Current State of Files

### v1 (✅ 全部 Complete 并上线)
| File | Status | Notes |
|---|---|---|
| `app/page.tsx` | ✅ Complete | Hero + Features + How + Stats + CTA |
| `app/review/page.tsx` | ✅ Complete | 流式订阅 + ProgressTimeline + Output |
| `app/library/page.tsx` | ✅ Complete | RSC + 加载 enriched + 显示 source |
| `app/api/review/route.ts` | ✅ Complete | NDJSON 流式 + matched 字段 |
| `app/api/upload/route.ts` | ✅ Complete | Vercel Blob 客户端直传 token |
| `app/api/analyze-video/route.ts` | ✅ Complete | 视频分析 pipeline |
| `lib/review-engine/*` | ✅ Complete | 6 个文件，含 retrieval/commonalities/llm/mock/types/system-prompt |
| `lib/review-engine/knowledge/creator-growth.ts` | ✅ Complete | v1 创作者增长 ground truth |
| `lib/research/*` | ✅ Complete | hashtag-generator + topic-research + enrich-one |
| `lib/topic-cache/blob-cache.ts` | ✅ Complete | ISO 周缓存 |
| `lib/apify/*` | ✅ Complete | client + normalize + scrapers |
| `lib/video/*` | ✅ Complete | ffmpeg + analyze (Whisper + Haiku Vision) |
| `lib/data/load-videos.ts` | ✅ Complete | enriched > raw > seed 三级 fallback |
| `data/scraped/enriched-2026-04-29.json` | ✅ Complete | 299 条富化数据 |
| `components/home/*` | ✅ Complete | Hero, FeatureGrid, HowItWorks, StatsBand, CTASection |
| `components/review/*` | ✅ Complete | InputPanel, OutputPanel, ProgressTimeline |
| `components/library/LibraryClient.tsx` | ✅ Complete | 卡片网格 + 筛选 |

### v2 阶段 1 (✅ Complete 并上线)
| File | Status | Notes |
|---|---|---|
| `app/template-review/page.tsx` | ✅ Complete (双 tab) | 待升级到 4 tab |
| `app/api/template-review/route.ts` | ✅ Complete | 7 维审核流式 API |
| `app/api/template-explore/route.ts` | ✅ Complete | 探索方向流式 API |
| `lib/template-review/types.ts` | ✅ Complete | 已含 v2 完整 types |
| `lib/template-review/audit-prompt.ts` | ✅ Complete | 7 维 system prompt |
| `lib/template-review/explore-prompt.ts` | ✅ Complete | 趋势分析师 prompt |
| `lib/template-review/audit-llm.ts` | ✅ Complete | Opus 4.7 调用 |
| `lib/template-review/explore-llm.ts` | ✅ Complete | Opus 4.7 调用 + 数据切片聚合 |
| `lib/template-review/extractor.ts` | ✅ Complete | 文档结构化抽取 |
| `lib/review-engine/knowledge/template-pm.ts` | ✅ Complete | v2 PM ground truth |
| `components/template-review/AuditPanel.tsx` | ✅ Complete | |
| `components/template-review/AuditOutput.tsx` | ✅ Complete | |
| `components/template-review/ExplorePanel.tsx` | ✅ Complete | |
| `components/template-review/ExploreOutput.tsx` | ✅ Complete | |

### v2 阶段 2 待建（Phase 1+2 全部）
| File | Status | Notes |
|---|---|---|
| `lib/template-review/capabilities-dict.ts` | 🗒️ Not Started | ~40 个 AI/特效/工具能力 |
| `lib/template-review/divergence-templates.ts`（或拆 7 个） | 🗒️ Not Started | 7 种发散法 prompts |
| `lib/template-review/brainstorm-prompt.ts` | 🗒️ Not Started | 集成 Rule 9-16 |
| `lib/template-review/brainstorm-llm.ts` | 🗒️ Not Started | 含对比模式逻辑 |
| `app/api/template-brainstorm/route.ts` | 🗒️ Not Started | 流式 |
| `components/template-review/BrainstormPanel.tsx` | 🗒️ Not Started | |
| `components/template-review/BrainstormOutput.tsx` | 🗒️ Not Started | 14 字段 |
| `lib/visentcm/types.ts` | 🗒️ Not Started | |
| `lib/visentcm/weights.ts` | 🗒️ Not Started | 7 题材权重 |
| `lib/visentcm/formula.ts` | 🗒️ Not Started | 完整公式 |
| `lib/visentcm/log-compress.ts` | 🗒️ Not Started | |
| `lib/visentcm/threshold.ts` | 🗒️ Not Started | |
| `lib/visentcm/theme-history.ts` | 🗒️ Not Started | Blob 评分历史 |
| `lib/visentcm/score-prompt.ts` | 🗒️ Not Started | |
| `lib/visentcm/score-llm.ts` | 🗒️ Not Started | |
| `app/api/template-score/route.ts` | 🗒️ Not Started | |
| `components/template-review/ScorerPanel.tsx` | 🗒️ Not Started | |
| `components/template-review/ScorerOutput.tsx` | 🗒️ Not Started | |

---

## Decisions Made

按时间顺序的关键决策：

1. **双轨产品架构** — 不做单一创作者工具或单一内部工具，做"同一份真实大盘数据双向赋能" — 这是产品定位灵魂
2. **保留 effect-production-reviewer ground truth 给 v2 用，v1 改写为创作者增长视角** — 不要混用维度
3. **6 维评分（创作者）vs 7 维评分（PM）vs 8/9 维（VISENTCM）** — 三套维度并存，不要硬合
4. **TikTok 真实抓取 + Instagram Reels 真实抓取**（不抓 Snapchat / CapCut，留 v3）
5. **LLM 分层**：Opus 4.7 评审 / Haiku 4.5 富化与 Vision / Whisper 转录
6. **流式 NDJSON** 取代等待 80-120s 静默 — 显著改善 UX
7. **客户端直传 Vercel Blob**（绕开 4.5MB function body limit）
8. **官方 SDK 取代 AI SDK** — 因为 Claude 4.7 不接受 temperature，AI SDK v4 强制传，最干净就是用官方 `@anthropic-ai/sdk` + `openai`
9. **题材精确匹配优先**（matched 字段）— 库内有就直接用，库内没绝不偷换为相邻题材（避免"美食探店"被错误匹配为"料理教程"）
10. **Vercel Blob 周缓存（ISO 周键）** — 避免每次都跑 Apify
11. **VISENTCM 选完整版**（数学公式 + 对数压缩） vs 简化版 vs LLM 直接打分 — 用户拍板
12. **Generator 选专业版**（含 7 法 + 对比模式 + 完整能力字典） vs 基础版 — 用户主动要求
13. **Generator 必须接入实时大盘检索** — 用户主动追问后明确这是核心差异化

---

## Blockers & Open Questions

- **冷启动趋同降权**：第一次跑 VISENTCM 时 theme-history 库为空，趋同检测无效。需要演示前预热（评 5-10 条 idea）
- **能力字典覆盖范围**：~40 个能力可能不够。需要根据用户实际使用补充
- **Apify Instagram 免费版限制**：每 hashtag 仅 10 条。如果未来要更多 IG 数据需要升级 Apify plan
- **VISENTCM 飞书 Base 集成**：原 skill 用飞书共享 Base 存历史，我们简化为 Vercel Blob — 提案时要解释这个 tradeoff
- **能力字典消歧义**：原 skill 提到"虚拟关系宠物"指"两人互动关系共同饲养的关系化身"而非"个人宠物"，我们的精简字典必须包含这种 disambiguation 字段

---

## Exact Next Step

**起手做 Phase 1 第一个文件**：

```
File: lib/template-review/capabilities-dict.ts
```

写 ~40 个能力，分三类：
- **AI 能力**：文生视频 / 文生图 / 图生图 / 图生视频 / 音色克隆 / ASR / 人脸交换 / Vision 识别 / Embedding / 数字人 / 风格 LoRA / 关系宠物 / ...
- **特效能力**：粒子 / 流体 / 变形 / 抠图 / 慢动作 / 卡点剪辑 / Whip pan / Match cut / Speed ramp / AR 贴纸 / Beauty / ...
- **工具能力**：模板编辑器 / 字幕生成 / 配乐推荐 / 贴纸库 / 画框 / 马赛克 / 定时发布 / ...

每个能力字段：`{ id, name, category, description, disambiguation, typicalUse }`。

写完后立刻动 7 种发散方法 templates。详细 plan 见 `PLAN.md` Phase 1 段。

---

## Environment & Setup Notes

- **Node**: v22.21.0
- **npm**: 11.6.2
- **Vercel CLI**: 52.2.0（已登录 zhaoyixin0）
- **gh CLI**: 2.88.1（已登录 zhaoyixin0）
- **关键 env vars** 都在 Vercel project（dev + prod）：APIFY_TOKEN / ANTHROPIC_API_KEY / ANTHROPIC_MODEL=claude-opus-4-7 / OPENAI_API_KEY / BLOB_READ_WRITE_TOKEN
- **本地 .env.local** 已 sync（vercel env pull）
- **生产 URL**：https://viral-reviewer.vercel.app
- **GitHub**：https://github.com/zhaoyixin0/viral-reviewer (public, main 分支 e24fbbb)
- **Vercel project**: zhaoyixin0s-projects/viral-reviewer (prj_HFKViqKvJMqyvKMajQtkNzFaZJFN)

### 换电脑无缝继续：5 行命令
```bash
gh repo clone zhaoyixin0/viral-reviewer && cd viral-reviewer
npm install
vercel link --yes --project viral-reviewer --scope zhaoyixin0s-projects
vercel env pull .env.local
npm run dev
```

### 让新电脑 Claude 立刻有上下文
打开 Claude 后说：
> 「读 docs/sessions/2026-04-30-viral-rev1-session.tmp.md 和 PLAN.md，我们继续 Phase 1」

或更彻底地把 memory snapshot copy 到 ~/.claude/projects/.../memory/，详见 `docs/ONBOARDING.md` Step 5。

---

## ⚠️ 用户 Demo 完成后必须做

- 立刻 rotate 三个 secret（已暴露在聊天 + GitHub 历史，虽然在 .env.local 但 .vercel 之类不能保证）：
  - ANTHROPIC_API_KEY → https://console.anthropic.com/settings/keys
  - APIFY_TOKEN → https://console.apify.com/account/integrations
  - （OpenAI key 也建议看一下）
- 在 Vercel env vars 里更新新 key
- 不需要 push 新代码（key 不在源码里）
