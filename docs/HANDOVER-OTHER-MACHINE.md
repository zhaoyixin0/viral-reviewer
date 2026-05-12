# Handover · 给另一台 Windows 机器的 Claude Code

> 这个文件是另一台开发机器（用户家里 / 工作室那台）的 Claude Code 看的。
> 你在那台机器上读到这份文档时，本仓库已经有从这台机器（user 出差/外面用的笔记本）push 上 GitHub 的最新 Phase 0-5 代码。
> 你的核心任务是把那台机器上**未推送的 production 代码**安全恢复到 GitHub，并把 Phase 0-5 的新代码 rebase 进去。

---

## 1. 背景（必读）

用户拥有两台开发 viral-reviewer 的 Windows 机器：

| 机器 | 你看到的 | Production 关键性 |
|---|---|---|
| **这台**（你正在用的） | 历史上做过 `vercel deploy --prod` 的部署，本地有 5 个未推送的 commit | ⚠️ **这台机器是 Vercel production 唯一的代码 source**。硬盘出问题或 git clean 一次会永久丢失。 |
| **那台** | 出差用的笔记本，最近做了 Phase 0-5 新功能，已 push 到 GitHub | 安全，所有代码都在 GitHub |

**当前混乱状态**：
- Vercel 项目 `zhaoyixin0s-projects/viral-reviewer` **没有连 GitHub repo**（CLI `vercel pull` 验证 `VERCEL_GIT_*` 字段全部空字符串）
- 之前 May 4 由这台机器跑 `vercel deploy --prod` 把本地代码上传到 Vercel 部署
- 上传的 deployment 显示了本地 `.git` 的 commit hash（如 `8d3902e`），但 GitHub 上没有这些 hash

**production 跑的 5 个未推送 commit**（你这台机器本地应该有）：

```
8d3902e  feat(review): bump video upload limit 30MB → 200MB
03bcada  feat(creator-side): account profile binding (TikTok + Instagram)
dd852f1  fix(llm): drop assistant prefill — Opus 4.7 rejects it
269df71  feat(template-brief): support 100MB PDFs via Vercel Blob direct upload
d6eb83f  feat(template-review): Phase 1 Generator v0.3 with PDF brief upload
```

这 5 个 commit 的祖先是 `ab8a380 docs: add session log for cross-device resume`（GitHub 上确实存在的 commit）。

---

## 2. GitHub 上目前的状态

那台机器今天 push 了 5 个 commit 到 `origin/main`（从 `ab8a380` 长出）：

```
9ea3c90  feat(technique-match): Opus 4.7 bidirectional matching + streaming UI
35efa33  feat(potential): add MaterialPotential analyzer (2-stage Gemini pipeline)
c7988a2  feat(cut-plan): add CutPlan IR + Gemini 2.5 Pro video understanding
e2a61ad  feat(retrieval): force LLM topic inference for all review requests
[Phase 5 commit 待补，那台机器跑完会有]
ab8a380  docs: add session log for cross-device resume  ← 共同祖先
e24fbbb  docs: add memory snapshot + onboarding for cross-device continuation
6306e26  chore: initial commit - viral-reviewer demo
```

git history 分叉：

```
                   ab8a380 ─┬──── (this machine) ──── 8d3902e (production)
                            │
                            └──── (other machine) ──── 9ea3c90 (Phase 0-5)
```

---

## 3. 你要做的事

按顺序执行。**每一步都跑一次确认结果再做下一步**，不要批量执行。

### Step 0 · 安全确认

```powershell
cd <你这台机器 viral-reviewer 工作目录>
git status         # 必须 clean
git log --oneline -8
```

预期看到 `8d3902e` 是 HEAD，工作区 clean。如果不 clean，**先停下来问用户**，可能有未保存改动。

### Step 1 · 抓 GitHub 最新

```powershell
git fetch origin
git log --oneline origin/main -10
```

预期：能看到 `9ea3c90 feat(technique-match)` 等那台机器 push 的 commits + ab8a380。

### Step 2 · 备份当前 HEAD（保险）

```powershell
git branch backup/before-rebase-pre-handover
git tag pre-handover-snapshot
```

万一 rebase 出问题可以 `git reset --hard backup/before-rebase-pre-handover` 回滚。

### Step 3 · rebase 把本地 5 个 commit 接到 origin/main 之上

```powershell
git rebase origin/main
```

会逐个 cherry-pick `d6eb83f` `269df71` `dd852f1` `03bcada` `8d3902e` 这 5 个 commit 到 `9ea3c90` 之上。

**预期冲突高发文件**：
- `lib/review-engine/types.ts`（两边都改了 ViralVideo）
- `app/api/review/route.ts`
- `lib/review-engine/retrieval.ts`
- `package.json` / `package-lock.json`
- `.env.example`

冲突处理原则：
- **Phase 0-5 的新结构是基础**，把本地 5 个 commit 的功能 **merge 进**新结构
- 比如 `ViralVideo` 类型：保留 Phase 1 新增的 `videoFormat / density / cutPlanRef` 字段，加上本地 commit 想加的字段
- 比如 `app/api/review/route.ts`：保留 Phase 0 的 LLM 题材推断 + 视频上传上限改成本地 commit 里的 200MB
- 优先用 `git rebase --merge` 模式（默认就是），冲突 marker 出现时手动解决

每个冲突解决后：
```powershell
# 编辑文件解决冲突
git add <files>
git rebase --continue
```

如果中途想放弃：
```powershell
git rebase --abort   # 回到 rebase 前状态
```

### Step 4 · rebase 完成后验证

```powershell
git log --oneline -12
```

预期能看到 12 个 commit：

```
8d3902e' (rebased) feat(review): bump video upload limit ...
03bcada' (rebased) feat(creator-side): account profile binding ...
dd852f1' (rebased) fix(llm): drop assistant prefill ...
269df71' (rebased) feat(template-brief): support 100MB PDFs ...
d6eb83f' (rebased) feat(template-review): Phase 1 Generator v0.3 ...
9ea3c90  feat(technique-match): Opus 4.7 bidirectional matching + UI
[Phase 5 commit]
35efa33  feat(potential): MaterialPotential analyzer
c7988a2  feat(cut-plan): CutPlan IR + Gemini understanding
e2a61ad  feat(retrieval): force LLM topic inference
ab8a380  docs: cross-device resume
... (older)
```

注意：rebase 后那 5 个 commit 的 SHA 会变（标 `'`），这是正常的。

跑构建确认没坏：

```powershell
$env:NODE_EXTRA_CA_CERTS = "C:\Program Files\Git\mingw64\etc\ssl\certs\ca-bundle.crt"
npm install
node_modules\.bin\tsc --noEmit       # 必须 exit 0
node_modules\.bin\next build         # 必须 success
```

如果 tsc 或 build 失败，**不要 push**，先把错误修了或者 `git rebase --abort` 回滚。

### Step 5 · push 到 GitHub

rebase 改了历史所以需要 force-with-lease（比 force 安全，会检查 remote 没被别人更新）：

```powershell
git push --force-with-lease origin main
```

预期 push 成功，GitHub 上 `main` 变成 12 个 commit。

### Step 6 · 删除 backup（确认无问题后再删）

跑几小时 / 第二天确认 production 没坏，再：

```powershell
git branch -D backup/before-rebase-pre-handover
git tag -d pre-handover-snapshot
```

### Step 7 · 修复 Vercel git auto-deploy（一劳永逸）

打开 [vercel.com/dashboard](https://vercel.com/dashboard) → `viral-reviewer` 项目（注意不是 `aige-studio-app`）。

1. **Settings → Git** 标签
2. 如果显示 "Connect Git Repository" → 点击 → 选 `zhaoyixin0/viral-reviewer` → Production Branch: `main` → Save
3. Vercel 会自动 deploy 当前 main HEAD（含完整 12 个 commit），约 2 分钟

如果显示 "Already connected" 但实际没工作：
1. **Disconnect** 一次
2. 等 30 秒
3. **Reconnect** 同一个 repo

connect 完成后，以后任何 push 到 main 会自动触发 production deploy，不需要再 `vercel deploy` CLI。

### Step 8 · 验证 production

打开 `https://viral-reviewer.vercel.app` 验证：

- ✅ 首页能开
- ✅ `/review` 上传视频，上限 200MB（来自本地 8d3902e）
- ✅ `/template-review` 选 "脑暴生成" tab，能上传 100MB PDF（来自 269df71 + d6eb83f）
- ✅ 创作者侧 profile binding（来自 03bcada）
- ✅ `/technique-match` 新页面能用，上传视频跑出剪辑清单（Phase 4）
- ✅ 跑完 technique-match 后看到 "一键导出 CapCut" 按钮，能下载 zip（Phase 5）
- ✅ 解压 zip 到 CapCut Projects 目录，CapCut 打开看到剪辑好的项目

任何一项不工作 → 看 Vercel 部署 log + 把 stack trace 提供给用户。

---

## 4. 环境变量

那台机器 push 时 `.env.example` 已经加了 `GOOGLE_API_KEY`。Vercel 上用户已经手动加了。但要再验证一次：

```powershell
npx vercel link --yes --project viral-reviewer --scope zhaoyixin0s-projects
npx vercel env ls 2>&1 | findstr GOOGLE_API_KEY
npx vercel env ls 2>&1 | findstr ANTHROPIC_API_KEY
npx vercel env ls 2>&1 | findstr APIFY_TOKEN
npx vercel env ls 2>&1 | findstr OPENAI_API_KEY
npx vercel env ls 2>&1 | findstr BLOB_READ_WRITE_TOKEN
```

5 个 key 都该看到 "Encrypted" 标记。少哪个 → 让用户去 Vercel Dashboard 加。

---

## 5. Phase 0-5 的功能简介（你可能要回答用户问题）

**Phase 0 · LLM 题材推断**（`e2a61ad`）
- 删除了 `lib/review-engine/retrieval.ts` 的 6 题材硬编码
- 新增 `lib/research/topic-inference.ts`：Haiku 4.5 看用户全部输入 → 归一化到本地库题材
- `/api/review` 现在第一阶段强制走 LLM 推断

**Phase 1 · CutPlan IR + Gemini 视频理解**（`c7988a2`）
- 新增 `lib/cut-plan/{schema,time-code}.ts`：CutPlan IR 完整 Zod schema
- 新增 `lib/video/{ffprobe-meta,gemini-understand}.ts`：Gemini 2.5 Pro 视频 → CutPlan
- 新增 `scripts/probe-one-video.ts`：`npm run probe -- --video <mp4>` 验证
- 新增 dep: `@google/genai`
- 扩展 `ViralVideo` 加 `videoFormat / density / cutPlanRef` 字段（**rebase 时这里跟本地有冲突，仔细处理**）

**Phase 2 · MaterialPotential**（`35efa33`）
- 新增 `lib/cut-plan/material-potential.ts`：8 维可塑性 IR
- 新增 `lib/video/analyze-potential.ts`：两阶段 Gemini pipeline
- 新增 `scripts/probe-user-potential.ts`：`npm run probe:potential`

**Phase 3 · 双向技法匹配引擎**（`9ea3c90` 的一部分）
- 新增 `lib/technique-matching/{types,match-prompt,match-engine}.ts`
- Opus 4.7 推理，4 选 1 verdict（learn / adapt / skip / inverse）
- 新增 `scripts/probe-technique-match.ts`：`npm run probe:match`

**Phase 4 · API + UI**（`9ea3c90` 的另一部分）
- 新增 `app/api/technique-match/route.ts`：NDJSON 流式 API
- 新增 `app/technique-match/page.tsx` + 5 个组件
- Header 加 "剪辑参考" nav
- 临时方案：`lib/sample-references/` 用 2 条手工 CutPlan 作为爆款池

**Phase 5 · CapCut Compiler MVP**（最新 commit）
- 新增 `lib/capcut-compiler/{schema,build,assets,package}.ts`：CutPlan → CapCut draft_content.json + zip 打包
- 新增 `app/api/compile-capcut/route.ts`：API endpoint
- 新增 `components/technique-match/CapCutExport.tsx`：UI 导出按钮（含可选 BGM 上传）
- 新增 dep: `jszip`
- 支持：主视频轨（10 段切镜 + 每段 push-in/pull-out 缩放关键帧，4 个 property type ScaleX/PositionX/PositionY/Rotation）+ 字幕轨（仅用户原视频字幕）
- ⚠️ 视频自带音轨默认随视频段播放，不创建独立 audio 轨（避免"媒体丢失"困扰）
- 不支持（Phase 6+）：复杂转场 / 调色 / 特效

**Phase 5.5 · AI 推荐配乐 + 用户上传 BGM**（最新 commit）
- `lib/technique-matching/types.ts` 加 `RecommendedBgmSchema`（name / artist / kind / reasoning / searchKeywords / fromReferenceId / searchUrl / priority）
- `lib/technique-matching/match-prompt.ts` 让 Opus 输出 3-5 首推荐 BGM（综合 metaphorHooks + videoFormat + 节奏推断 vibe）
- 新增 `components/technique-match/BgmRecommendations.tsx`：UI 卡片展示推荐音乐 + 搜索链接
- `components/technique-match/CapCutExport.tsx` 加 BGM 文件上传字段（可选，30MB 上限）
- `/api/upload` 加 audio MIME types（mp3/wav/m4a/aac）
- `app/api/compile-capcut/route.ts` 接受 `bgmUrl`，下载并作为独立 audio 轨打进 zip
- BGM 上传后 CapCut 项目里 `audio material.path = "materials/bgm.mp3"`（纯相对路径）
- ⚠️ 用户在 CapCut 第一次打开仍需手动点"链接媒体"两次（一次 video 一次 audio）— CapCut 限制

---

## 6. 下一步开发路线图（如果用户问）

按优先级：

1. **Phase 6 · 批量富化 299 条爆款**
   - 跑 Gemini 把现有 `data/scraped/enriched-2026-04-29.json` 全部补 cutPlan
   - 替换 `lib/sample-references/` 为真实 retrieval
   - 工作量：~3.7h API call + 写脚本 ~2h

2. **Phase 7 · CapCut Compiler 进阶**
   - 支持复杂转场（whip pan / match cut / 速度坡）
   - 调色（teal-orange grading 等）
   - 特效

3. **Phase 8 · 飞书 OAuth + 双写**
   - 评审意见写回原 Feishu 文档
   - PLAN.md 提到的 v3 计划

参考 `PLAN.md` + `PROGRESS.md` 看完整路线。

---

## 7. 紧急联系

如果 rebase 出问题：
- 不要 `git push --force` 不带 `--force-with-lease`
- 不要 `git reset --hard origin/main`（会丢本地 5 个 commit）
- 不要 `git clean -fd`（会丢未跟踪改动）
- 把现场 `git status` + `git log --oneline -15` + `git diff` 完整 paste 给用户

如果 Vercel deploy 失败：
- 看 Vercel Dashboard 那条 deployment 的 Build Logs
- 把完整 log paste 给用户
- 不要在 Vercel 上手动改环境变量除非用户明确说

---

完。

`docs/HANDOVER-OTHER-MACHINE.md`，由 Phase 0-5 那台机器的 Claude 起草。
