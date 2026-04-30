---
name: viral-reviewer 项目总览
description: 项目当前架构、双轨定位、部署信息、技术栈
type: project
originSessionId: 1bde1864-7990-4c58-a89b-9bd90cc5fe1e
---
## 项目本质

viral-reviewer 是一个 **TikTok / Instagram Reels 真实爆款数据驱动的 AI 评审系统**，部署在 Vercel。

## 双轨架构

- **轨道 A · 创作者侧** (v1) — `/review`：用户输入想法或上传视频草稿 → Claude Opus 4.7 给出 6 维评分 + 按秒优化时间轴 + 四段式建议
- **轨道 B · 内部 PM 侧** (v2) — `/template-review`：完整还原 TikTok 内部三件套生产线（脑暴生成 → Idea 评分 → 立项审核），加大盘探索

## 数据底层

- **本地库**：data/scraped/enriched-2026-04-29.json（299 条真实视频 = TikTok 180 + Instagram 119，全部用 Haiku 4.5 富化了 playStyle / visualStyle / hook）
- **周缓存**：Vercel Blob `topic-cache/{slug}-{ISO-week}.json`（按自然周更新）
- **实时抓取**：retrieve miss → LLM 翻 hashtag → Apify TikTok 5 + IG 5 → Haiku 富化 → 写 cache
- **fallback**：30 条手工种子 `data/seed/viral-videos.ts`

## LLM 分层

- 评审 / 探索 / 脑暴 / 评分：Claude Opus 4.7 (`claude-opus-4-7`)
- 富化 / Vision / hashtag / extract：Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- 视频转录：OpenAI Whisper (`whisper-1`)

## 部署

- **生产 URL**：https://viral-reviewer.vercel.app
- **Vercel 项目**：zhaoyixin0s-projects/viral-reviewer
- **Blob store**：viral-reviewer-store (store_DE6wkPCPwKfRrLDW)

## 当前阶段

- v1：✅ 完整上线
- v2 阶段 1（审核脑暴 + 探索方向）：✅ 上线
- v2 阶段 2（Phase 1 Generator + Phase 2 VISENTCM Scorer + Phase 3 4-tab 整合）：⏳ 待建
- v3：飞书双写 / 季度趋势 / Snapchat / Postgres+pgvector

## 关键技术点

- 流式 NDJSON：所有评审 API 用 ReadableStream + 前端 fetch reader 解析
- 视频上传：Vercel Blob 客户端直传（绕开 4.5MB function body 限制）
- Vercel Function 跑 ffmpeg：用 ffmpeg-static + ffprobe-static + outputFileTracingIncludes 显式打包二进制
- 库内匹配优先：matched=true 用本地 → false 才走 cache/live research（避免关键词污染，例：用户题材"美食探店"绝不偷换为本地有的"料理教程"）
