---
name: 用户要专业版 Generator + 实时大盘集成
description: Phase 1 Generator 必须做完整能力字典 + 对比模式，且必须接入实时大盘检索数据
type: feedback
originSessionId: 1bde1864-7990-4c58-a89b-9bd90cc5fe1e
---
## 决策

- Generator 实现深度选 **C 专业版**：4 件套 + 7 种发散法 dropdown + 内置精简能力字典 + **对比模式**
- Generator **必须接入实时大盘检索能力**（在调 LLM 前先调 retrieveSimilarVideos(scene)）

**Why（用户原话）**：用户主动确认「3 的答案我需要做专业版」+ 主动追问「这个 generator 的功能是否有结合我们实时爬取大盘数据的能力」— 实时大盘集成是必做项。

**How to apply**：
- 写 Generator API 时不能跳过 Layer 0（输入侧灵感检索）
- system prompt 必须告诉 LLM 在 ai_necessity / market_reference 字段里引用 benchmark 中的真实作者 + views，而不是凭空编造
- 对比模式 UI 必须做双栏 + 末尾「气质差异总结」（PDF 写得很明确不能和稀泥，必须明确推荐一个方向）

## 关键差异化论点（提案演示讲）

我们对 Generator 的实现 vs 原版 skill 的核心区别：
- 原版 skill 的 reference 用的是 producthunt / medium / reddit / 36kr 等通用产品库
- 我们的 reference 是 **TikTok + Instagram Reels 真实爆款**（299 条已富化 + 实时按题材抓取 + 周缓存）
- 这是我们工具相对于原版 skill 的**核心差异化优势**

## 不要走歪的常见诱惑

- 不要为了快只做 SCAMPER 不暴露 7 种发散法 → 用户已经否定基础版
- 不要为了简单跳过对比模式 → 是专业版核心特性
- 不要让 Generator 完全脱离爆款库自己发散 → 用户原话「这是我们的核心差异化优势」
- 能力字典不需要追求 100+ 完整覆盖，~40 个常见的能撑住 demo + 后续可增量
