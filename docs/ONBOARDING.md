# 换电脑 / 新环境继续开发指南

> 任何新电脑（家里、笔记本、新装 Mac）按这 7 步即可无缝继续 Phase 1/2/3/4 开发。

## 前置（一次性）

新电脑需要装：

- **Node.js ≥ 22**（项目用 Node 22.21+ 跑 dev / npm 11.6+）
- **git**
- **GitHub CLI**: `brew install gh` / `winget install GitHub.cli`
- **Vercel CLI**: `npm i -g vercel`
- **Claude Code**（可选，但推荐）

## Step 1 · Clone

```bash
gh auth login              # 登 GitHub（zhaoyixin0）
gh repo clone zhaoyixin0/viral-reviewer
cd viral-reviewer
```

## Step 2 · 装依赖

```bash
npm install
```

## Step 3 · 链接 Vercel + 拉环境变量（关键）

```bash
vercel login              # 登 Vercel（zhaoyixin0）
vercel link --yes --project viral-reviewer --scope zhaoyixin0s-projects
vercel env pull .env.local
```

这一步会自动把 `APIFY_TOKEN / ANTHROPIC_API_KEY / OPENAI_API_KEY / BLOB_READ_WRITE_TOKEN` 全部拉到本地 `.env.local`。**不需要手填任何 secret**。

## Step 4 · 验证本地能跑

```bash
npm run dev
# 浏览器打开 http://localhost:3000
# 测一下 /review 跑通 = 后端到 LLM 全打通
```

## Step 5 · 恢复 Claude Code 记忆（可选但推荐）

如果你想让 Claude Code 在新电脑上保持原有上下文：

```bash
# Mac / Linux
mkdir -p ~/.claude/projects/$(pwd | sed 's|/|-|g' | sed 's/^-//')/memory
cp docs/memory-snapshot/*.md ~/.claude/projects/$(pwd | sed 's|/|-|g' | sed 's/^-//')/memory/

# Windows (PowerShell)
$projDir = "C--Users-$env:USERNAME-Desktop-help-you-viral"   # 按实际路径调整
$dst = "$env:USERPROFILE\.claude\projects\$projDir\memory"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item docs\memory-snapshot\*.md $dst
```

或者**更简单**：跟 Claude 说一句「读 docs/memory-snapshot/MEMORY.md 和 PLAN.md」，它就有完整上下文。

## Step 6 · 验证生产环境

```bash
curl https://viral-reviewer.vercel.app/  # 应返回 200
```

`https://viral-reviewer.vercel.app` 是稳定别名，永远指向最新的 production deployment，不需要重新部署。

## Step 7 · 继续开发

直接打开 PLAN.md / PROGRESS.md，从「⏳ 进行中」段往下做。

第一个待办是 **Phase 1 Generator 专业版**。

---

## 不需要重新做的事（已在云端）

- ✅ Vercel 项目（zhaoyixin0s-projects/viral-reviewer）
- ✅ Vercel Blob store（viral-reviewer-store, 含周缓存数据）
- ✅ 所有环境变量（vercel env pull 拉回来）
- ✅ 真实抓取数据（enriched-2026-04-29.json 已在 repo）
- ✅ 生产 URL（https://viral-reviewer.vercel.app）

## 需要再确认的事

- ⚠️ **Memory 同步**：`.claude/projects/.../memory/` 是本地文件夹，新电脑必须 copy 一份过去（或让 Claude 直接读 repo 里的 `docs/memory-snapshot/`）
- ⚠️ **Claude Code 全局 CLAUDE.md**：在 `~/.claude/CLAUDE.md`，不属于 repo。如果新电脑没有 Claude Code，需要单独装。
- ⚠️ **桌面工具链**：FFmpeg 不需要本地装（用的是 ffmpeg-static / ffprobe-static npm 包）

---

## 极简版（已经熟练后用）

```bash
gh repo clone zhaoyixin0/viral-reviewer && cd viral-reviewer
npm install
vercel link --yes --project viral-reviewer --scope zhaoyixin0s-projects
vercel env pull .env.local
npm run dev
```

5 行命令搞定。
