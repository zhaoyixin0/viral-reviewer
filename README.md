# Viral Reviewer

> 基于 TikTok / Instagram Reels 真实爆款数据的 AI 评审与脑爆系统。
> 双轨产品：**创作者侧**（让普通人的视频更可能火）+ **TikTok 内部 PM 侧**（脑爆 → 评分 → 立项完整生产线）。

🌐 **Live**: https://viral-reviewer.vercel.app

---

## 核心价值

把 TikTok 内部三件套（Generator / Scorer / Reviewer）+ 实时大盘数据，做成一套可视化的 web 工具：

```
脑爆发散 → Idea 评分 → 立项审核
          (effect-idea-generator v0.3)
                   (VISENTCM v3.4)
                          (effect-production-reviewer)
            ↑↑↑    全部接入 TikTok + IG 真实爆款数据    ↑↑↑
```

外加创作者侧子产品：把任意视频想法或草稿，对标真实同题材爆款，输出按秒优化建议。

---

## 技术栈

- **前端**：Next.js 15 + TypeScript + Tailwind v4 + Framer Motion + shadcn 风格 UI
- **后端**：Next.js Route Handlers (Fluid Compute, Node.js runtime)
- **LLM**：Claude Opus 4.7 (评审) / Haiku 4.5 (富化、Vision、hashtag) / OpenAI Whisper (转录)
- **抓取**：Apify (TikTok scraper + Instagram hashtag scraper)
- **存储**：Vercel Blob (视频上传 + 评分历史 + 周缓存)
- **视频处理**：FFmpeg (抽帧 + 抽音频) + ffprobe-static
- **流式 API**：NDJSON ReadableStream (前端 fetch + reader 解析)
- **部署**：Vercel

---

## 入口

| 路径 | 用户 | 用途 |
|---|---|---|
| `/` | 全部 | 产品介绍 |
| `/review` | 创作者 | 视频想法 / 草稿 → 6 维评分 + 按秒时间轴建议 |
| `/library` | 全部 | 浏览 299 条真实 TikTok / IG 爆款（含富化 metadata） |
| `/template-review` | TikTok 内部 PM | 4 tab：脑暴生成 / Idea 评分 / 审核脑暴 / 探索方向 |

---

## 数据流

```
用户输入题材
    ↓
[1] 本地 enriched 库（299 条）— 题材精确匹配
    ↓ miss
[2] Vercel Blob 周缓存（按 ISO 周键）
    ↓ miss
[3] 实时按题材抓取
    ├── LLM (Haiku) 把题材翻译成 5-6 个真实 hashtag
    ├── Apify TikTok scraper（top 5 by views）
    ├── Apify Instagram scraper（top 5 by views）
    └── Haiku 富化 playStyle / visualStyle / hook
    ↓
[4] 写入 Blob 周缓存
    ↓
[5] Opus 4.7 基于真实数据评审
```

---

## 知识资产

- `effect-production-reviewer` skill 知识 → `lib/review-engine/knowledge/template-pm.ts`
- 创作者增长策略 → `lib/review-engine/knowledge/creator-growth.ts`
- `effect-idea-generator` v0.3 skill → 计划集成（Phase 1）
- `VISENTCM` v3.4 + 算法 v3.3 skill → 计划集成（Phase 2）

---

## 本地开发

```bash
# 1. 装依赖
npm install

# 2. 配 .env.local
cp .env.example .env.local
# 填入：
#   APIFY_TOKEN
#   ANTHROPIC_API_KEY
#   OPENAI_API_KEY (用于 Whisper)
#   BLOB_READ_WRITE_TOKEN (Vercel Blob)

# 3. 启动 dev server
npm run dev
```

可选：
```bash
# 抓取真实数据（消耗 Apify 余额）
npm run scrape:tiktok
npm run scrape:instagram

# LLM 富化抓取数据
npm run enrich
```

---

## 部署

直接 `vercel deploy --prod`（链接到 Vercel 项目即可）。

环境变量在 Vercel Dashboard 配置：
- `APIFY_TOKEN`
- `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`（默认 `claude-opus-4-7`）
- `OPENAI_API_KEY`
- `BLOB_READ_WRITE_TOKEN`（Vercel Blob 自动注入）
- 可选 `ENRICH_MODEL` / `VISION_MODEL` / `HASHTAG_MODEL`（默认都用 `claude-haiku-4-5-20251001`）

---

## 项目结构

```
app/
├── page.tsx              # 首页 (Hero + Features + How + Stats + CTA)
├── review/page.tsx       # v1 创作者评审（流式）
├── library/page.tsx      # 爆款库（RSC + LibraryClient）
├── template-review/page.tsx  # v2 模板审核（4 tab）
└── api/
    ├── review/           # v1 评审 API（流式）
    ├── upload/           # Vercel Blob 客户端直传 token
    ├── analyze-video/    # 视频分析 pipeline
    ├── template-review/  # v2 审核脑暴 API（流式）
    ├── template-explore/ # v2 探索方向 API（流式）
    ├── template-brainstorm/  # v2 Phase 1 待建
    └── template-score/   # v2 Phase 2 待建

components/
├── ui/                   # Header / Footer
├── home/                 # Hero / FeatureGrid / HowItWorks / StatsBand / CTASection
├── review/               # InputPanel / OutputPanel / ProgressTimeline
├── library/              # LibraryClient
└── template-review/      # AuditPanel / AuditOutput / ExplorePanel / ExploreOutput

lib/
├── review-engine/
│   ├── knowledge/        # template-pm + creator-growth ground truths
│   ├── retrieval.ts      # 本地 → cache → live → fallback
│   ├── commonalities.ts  # 共性提炼
│   ├── llm.ts            # Anthropic + OpenAI 双 SDK 封装
│   ├── mock.ts           # 无 API key 时的兜底
│   └── types.ts
├── template-review/
│   ├── audit-prompt.ts   # 7 维立项评审
│   ├── explore-prompt.ts # 探索方向
│   ├── audit-llm.ts      # Opus 4.7 评审调用
│   ├── explore-llm.ts    # Opus 4.7 探索调用 + 数据切片聚合
│   ├── extractor.ts      # 文档结构化抽取（Haiku）
│   └── types.ts
├── research/
│   ├── hashtag-generator.ts  # 题材 → hashtag (Haiku)
│   ├── topic-research.ts     # 实时按题材搜索 + 富化
│   └── enrich-one.ts         # 单条视频富化 (Haiku)
├── topic-cache/
│   └── blob-cache.ts     # Vercel Blob 周缓存（ISO 周键）
├── apify/
│   ├── client.ts
│   ├── normalize.ts      # TikTok / Instagram 字段归一化
│   └── scrapers.ts       # TikTok / Instagram scraper 封装
├── video/
│   ├── ffmpeg.ts         # 抽帧 + 抽音频
│   └── analyze.ts        # 视频分析 pipeline (Whisper + Haiku Vision)
├── utils/cn.ts
└── data/
    └── load-videos.ts    # 加载策略：enriched → raw → seed

data/
├── seed/viral-videos.ts  # 30 条手工策展兜底
└── scraped/              # raw + enriched 抓取数据
    └── enriched-*.json   # 最终用于评审的富化数据

scripts/
├── scrape-tiktok.ts
├── scrape-instagram.ts
├── enrich-videos.ts      # 富化脚本
└── fix-handles.ts        # 清理双 @ bug
```

---

## 文档

- [PLAN.md](./PLAN.md) — 完整产品计划与架构
- [PROGRESS.md](./PROGRESS.md) — 进度跟踪 + 已知问题
