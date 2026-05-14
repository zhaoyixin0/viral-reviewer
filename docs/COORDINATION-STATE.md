# 协调窗口运行状态（窗口 3）

> Living document。窗口 3（主仓库 `main`）的协调者运行手册 + 进度快照。
> compact / 换机器后读这份文件即可恢复协调工作模式。
> 最后更新：**2026-05-14 收工**（当天三窗口并行会话结束）

---

## 我的角色：窗口 3 协调者

三窗口并行开发，我在主仓库 `main`，只做协调，不写任一 worktree 的项目代码：
- 窗口 1：`worktree-capcut-link` 分支，worktree 在 `.claude/worktrees/capcut-link/`
- 窗口 2：`feat/hot-tracking-p0-p2` 分支，worktree 在 `.claude/worktrees/hot-tracking/`
- 窗口 3（我）：主仓库根 `G:/claude code/viral reviewer`，`main` 分支

## 自动监控模式（用户授权，进行中）

用户指令原文："自动监控两个窗口的 WORKTREE，有更新了自动审核、MERGE。除非有问题或者
需要我做决策，不然不需要打扰。有需要传话给其他窗口的，直接整合指令给我。"

**持续运行的 monitor**：background task `b7ej73c4i`（persistent，到 session end）。
脚本每 90s `git fetch`，比较 `origin/worktree-capcut-link` 和
`origin/feat/hot-tracking-p0-p2` 的 tip，变化时 emit 一行
`CHANGED <branch> <old8> -> <new8>`。这一行作为 notification 唤醒我。

> compact 后如果 monitor 还在跑（persistent task 会 persist），收到 `CHANGED`
> 事件就按下面的流程处理。如果 monitor 没了，重新用 Monitor 工具起一个同样的
> poll 脚本（90s 间隔，比对两个分支 tip）。

### 收到 `CHANGED` 事件的标准流程

1. `git fetch origin --prune`
2. `git log --oneline <old>..origin/<branch>` 看新 commit；`git diff --stat origin/main...origin/<branch>` 看文件
3. **Review**：
   - 纯文档 / plan 修订 → 自己看 diff 即可
   - 代码改动小（< ~50 行、单一关注点）→ 自己看完整 diff 判断
   - 代码改动大 / 涉及架构 / 多文件 → dispatch `everything-claude-code:code-reviewer`（代码）或 `everything-claude-code:architect`（设计/plan）agent，给足项目 context
4. **判断**：
   - 还在 plan 阶段（只改 plan 文档）→ 不 merge，等实施 commit
   - 实施 commit 且 review 干净 → merge
   - review 有 Critical/High → 不 merge，整理可粘贴指令给用户转达窗口
5. **Merge**（仅实施阶段、review 干净时）：
   ```
   git checkout main && git pull --ff-only origin main
   git merge --no-ff origin/<branch> -m "<merge message>"
   npx tsc --noEmit && npx vitest run && npm run build   # 全绿才继续
   git push origin main
   ```
   merge message 要写清：并入了什么、review 经过、跟 main 无冲突的确认
6. merge 后 worktree 会 behind main 1。**无需再传话提醒 pull** —— 窗口 1/2 的记忆
   已更新：它们每次开新 task 前会自己 `git pull origin main` 并确认上个 task 已 merge。
   只在需要决策 / review 有 Critical-High / 冲突时才传话。

### 打扰用户的格式（仅在真需要时）

- **标明给哪个窗口** + 一段可直接粘贴的指令（用 ``` 代码块）
- 需要决策的：把选项 + 权衡列清楚，用户拍板
- 纯 FYI 不夹带，只有真需要用户动作时才出现
- 触发条件：review 发现 Critical/High、merge 冲突解不了、tsc/test/build 验证失败、
  需要决策（某阶段是否 ship、跨窗口依赖打架）、production 风险 / secret

## 当前进度快照（2026-05-14 收工）

`main` HEAD：`e6d136e`（已全部 push 到 GitHub）。两个 worktree 分支都已完整 merge 进 main。

### 窗口 1 — CapCut setup-script link fix —— ✅ 基本完成
- 分支：`worktree-capcut-link`，tip `797a6e2`，**已完整 merge 进 main**
- 状态：**7 个 task 全部实施并 merge,Windows 实测通过(不再弹 "Couldn't link")**
- plan：`docs/superpowers/plans/2026-05-13-capcut-setup-script-link-fix.md`（全部 ✅）
- 成果（都在 main）：
  - `lib/capcut-compiler/setup-scripts/`（tokens.ts + index.ts 三个 setup 脚本常量）
  - `lib/capcut-compiler/build.ts`（占位 token + 7 组 draft_materials）
  - `lib/capcut-compiler/package.ts`（setup 脚本打进 zip 根 + README 重写）
  - `app/api/compile-capcut/route.ts`（文件名贯穿管线 + Zod 路径分隔符 guard + 通用 500）
  - 测试：build / package / sanitize / setup-scripts(真实执行) 四套
  - `docs/HANDOVER-CAPCUT-LINK-2026-05-13.md` 末尾 "Findings" 章节（根因 + 方案 + 实测）
  - `scripts/probe-capcut-zip.ts`（绕开 Gemini/Opus 直接生成测试 zip）
- **唯一剩余**：macOS 真机补测（`setup.sh`）—— 目前由 CI 执行测试 `tests/capcut-compiler/setup-scripts.test.ts` 覆盖。窗口 1 明天**无新任务**,除非要做 macOS 实测或新的 CapCut 功能。

### 窗口 2 — hot-tracking / 周热点 —— 🔧 实施进行中,恢复点 **P1.8 checkpoint 2**
- 分支：`feat/hot-tracking-p0-p2`,**已完整 merge 进 main（含到 P1.8 checkpoint 1）**,分支 tip behind main 1（`e6d136e` merge commit）
- 状态：**P0 + P1 数据层 + spec v4.1 + plan 重写 + P1.8 checkpoint 1 全部 merge。恢复点 = P1.8 checkpoint 2**
- spec：`docs/superpowers/specs/2026-05-13-hot-tracking-design.md`（**v4.1**,经 architect v1-v4 共 5 轮 review）
- plan：`docs/superpowers/plans/2026-05-13-hot-tracking-implementation.md`（按 v4.1 重写,经 architect plan review 两轮,残留项已修）
- 已 merge 的实施成果（都在 main）：
  - P0：`lib/research/topic-research.ts` 30 天发布窗口过滤
  - P1 数据层：`lib/trending/{types,velocity,snapshot-store}.ts`、`lib/utils/iso-week.ts`、`scripts/probe-tiktok-trends.ts`（P1.7 probe）
  - **P1.8 checkpoint 1**：v4 schema type 层 —— `TrendingHashtag` 类型 + `TrendingSnapshot.trendingHashtags` + `ViralVideo.trendingContext?` + loose Zod 同步（commit `4331835`）
- **恢复点 = P1.8 checkpoint 2**：`normalizeTikTokTrendingHashtag` 加进 `lib/apify/normalize.ts` + 新建 `tests/apify/normalize-trending-hashtag.test.ts`（plan 里 `## Task P1.8` 的 Step 7-11,字段映射表在那,用 P1.7 probe 实测字段）
- **之后的工作**：P1.9 `scrapeTikTokTrendingHashtags`(Stage 1) → P1.10/P1.11(ig-hot-hashtags / topic-classifier) → P1.12 `fetchTikTokTwoStage` 两阶段编排 → P1.13 cron route → P1.14 vercel.ts → P1.15 `computeHashtagVelocity` → P2 看板
- architect 已确认：P1.8-P1.15 核心编排可信可连续实施；P2.2/P2.3/P2.5/P2.6 的 Step 代码已在 plan 修订里重写到位。窗口 2 建议:P1 段做完、进 P2 前再跟窗口 3 确认一次 P2 完全放行(architect C1 复审已覆盖,属保险确认)
- ⚠️ **P1.1 的 Vercel 部署前置是 deploy-time gate**:viral-reviewer 在 Vercel 账户下还没 project,cron 套餐验证 + `ADMIN_TRIGGER_SECRET` 配置要首次部署后才能做 —— 不阻塞 P1.2-P1.14 代码实施

## 关键决策记忆（换机器/compact 后不能丢）

1. **CapCut 导入 bug 根因**：CapCut 用绝对路径引用素材,server 不知道用户解压到哪 →
   绝对路径只能在用户机器上生成 → 方案是 zip 里附 setup.ps1/.bat/.sh,用户本地跑。
   ✅ 已实施完成。历史误判已纠正：`5db8fce` 的"死锁"是填了相对 `file_Path`,不是填 `draft_materials` 本身错。
2. **CapCut zip 下载 4.5MB 限制**：Vercel function response body 上限 4.5MB,已用
   Vercel Blob relay 解决,client 从 CDN 下 `blob.downloadUrl`。
3. **hot-tracking 两阶段 TikTok（spec v4.1）**：P1.7 probe 实测发现 `clockworks/tiktok-trends-scraper`
   返回热门 hashtag 榜、不是 trending 视频。改两阶段：Stage 1 抓 hashtag 榜 → Stage 2 取 top-5
   hashtag 喂现有 `scrapeTikTokByHashtag` 抓视频。否决了 $39/月的 lexis-solutions actor。
4. **hot-tracking H2 解法（用户已拍板）**：两阶段下视频集合周周变 → 视频 velocity 退化成几乎全 NEW。
   解法：新增 `computeHashtagVelocity`（趋势 hashtag 榜有跨周连续性,是真正能做周环比的对象），
   视频级 velocity 保留但明确"预期稀疏"。看板周环比涨跌主要挂 hashtag 榜。
5. **hot-tracking H1**：Vercel Cron 在当前套餐的可用性未验证,P1.13 cron route 要先验证 +
   配 `ADMIN_TRIGGER_SECRET`（非 Vercel 自带,漏配则手动触发降级入口失效）。
6. **抓取参数已钉死成常量**（spec 成本段）：`TT_TRENDING_FETCH_LIMIT=20` / `TT_TRENDING_HASHTAG_COUNT=5`
   / `TT_VIDEOS_PER_HASHTAG=30`。调大会线性涨成本(N=8×50 会吃满 $5/月预算),不要随意改。
7. **跨 worktree 共享改动必须经 main**：窗口改 → push 分支 → 窗口 3 merge → 其它窗口 `git pull origin main`。不跨目录 cp。
8. **窗口 1/2 自己同步 main**：它们每次开新 task 前自行 pull main + 确认上个 task 已 merge,窗口 3 不再传话提醒 pull。
9. **APIFY_TOKEN 仍未 rotate**（`HANDOVER-2026-05-13.md` 第 4 节）。worktree 的 `.env.local` 带过泄露的旧 token —— 标准安全 TODO,用户负责。

---

## 明天换机器恢复步骤

> 用户明天在另一台 Windows 机器上继续。代码全在 GitHub（`main` = `e6d136e`），照下面走。

### 一次性环境准备
```powershell
git clone https://github.com/zhaoyixin0/viral-reviewer.git "<目标目录>"
cd "<目标目录>"
git fetch origin --prune
npm install        # 若撞公司 SWG cert 错误,看 HANDOVER-2026-05-13.md 末尾 SWG 处置
# .env.local 不在 git 里,需从 vercel env pull 或私人备份恢复（含 5 个 key）
```

### 重建两个 worktree
```powershell
git worktree add .claude/worktrees/capcut-link worktree-capcut-link
git worktree add .claude/worktrees/hot-tracking feat/hot-tracking-p0-p2
# 各 worktree 复制 node_modules + .env.local（见 WORKTREE-STATUS-2026-05-13.md）
Copy-Item -Recurse -Force .\node_modules .\.claude\worktrees\capcut-link\
Copy-Item -Recurse -Force .\node_modules .\.claude\worktrees\hot-tracking\
Copy-Item .\.env.local .\.claude\worktrees\capcut-link\.env.local
Copy-Item .\.env.local .\.claude\worktrees\hot-tracking\.env.local
```

### 三个窗口各自恢复
- **窗口 3（主仓库 `main`,协调者）**：读本文件即可恢复。重新用 Monitor 工具起 persistent poll 脚本（90s 间隔,比对 `origin/worktree-capcut-link` 和 `origin/feat/hot-tracking-p0-p2` 的 tip）。然后进入"收到 CHANGED 事件 → 标准流程"的被动监控模式。
- **窗口 1（`.claude/worktrees/capcut-link`）**：CapCut setup-script 任务**已完成**。开窗后先 `git pull origin main`。明天**无新任务**,除非用户要做 macOS `setup.sh` 真机实测,或开新的 CapCut 功能。
- **窗口 2（`.claude/worktrees/hot-tracking`）**：开窗后先 `git pull origin main` 同步到 `e6d136e`。然后读 `docs/superpowers/plans/2026-05-13-hot-tracking-implementation.md` 的 `## Task P1.8`,**从 P1.8 checkpoint 2 恢复实施**（Step 7-11:`normalizeTikTokTrendingHashtag` 加进 `lib/apify/normalize.ts` + 新建 `tests/apify/normalize-trending-hashtag.test.ts`。P1.1-P1.7 + P1.8 checkpoint 1 已 ✅ merge,不要重新 Create/重做）。用 subagent-driven-development 跑 P1.8 ck2 → P1.9 → P1.15 → P2。

### 端口分配（防 dev server 冲突）
窗口 1 = 3001,窗口 2 = 3002,窗口 3 = 3000。`npm run dev -- -p <port>`。

## 参考

- `docs/HANDOVER-2026-05-13.md` — 5/13 会话主接力文档（P1+P2/hotfix/P3/P0 全记录）
- `docs/HANDOVER-CAPCUT-LINK-2026-05-13.md` — CapCut link fix 调查 + 最终 Findings
- `docs/WORKTREE-STATUS-2026-05-13.md` — 三窗口 worktree setup 详细步骤 + 协作守则
- spec + plan 文档在 `docs/superpowers/specs/` 和 `docs/superpowers/plans/`
