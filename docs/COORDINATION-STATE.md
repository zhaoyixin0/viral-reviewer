# 协调窗口运行状态（窗口 3）

> Living document。窗口 3（主仓库 `main`）的协调者运行手册 + 进度快照。
> compact / 换机器后读这份文件即可恢复协调工作模式。
> 最后更新：**2026-05-15 回填**（窗口 3 在另一台机器恢复，pull 同步 `main` = `6986166` 后，
> 据 `docs/coordination/` + git 历史重建昨日公司机器上推进的进度）

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
   - review 有 Critical/High → 不 merge，把指令写进 `docs/coordination/window-<N>.md` 并 push（见下方「给窗口传指令」）
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

### 给窗口传指令（用文件，不用用户转贴）

跨窗口指令 / review 反馈 / 决策结果 → 写进 `docs/coordination/window-<N>.md` 并 push 到 `main`。
对应窗口 `git pull` 后自己读，不再依赖用户人工转贴。约定见 `docs/coordination/README.md`：
- 文件整体覆盖，只留最新一条；头部标注「写于哪天 · 针对 main 哪个 SHA · 给哪个窗口」
- 写完 commit + push，然后只给用户一句话回执（写了什么、在哪个文件），不在对话里贴长指令

### 打扰用户的格式（仅在真需要用户动作时）

- 需要**决策**的（只有用户能拍板）：把选项 + 权衡列清楚，等用户回复 —— 这类仍在对话里问
- 纯 FYI 不夹带，只有真需要用户动作时才出现
- 触发条件：merge 冲突解不了、tsc/test/build 验证失败、需要决策（某阶段是否 ship、
  跨窗口依赖打架）、production 风险 / secret
- review 发现 Critical/High → 不打扰用户，直接写 `docs/coordination/window-<N>.md`（见上）

## 当前进度快照（2026-05-15 回填 · `main` = `6986166`）

`main` HEAD：`6986166`（"Merge W2: P2 release confirmation"，已全部 push 到 GitHub）。
昨日（2026-05-14 公司机器）三窗口并行又推进了 31 个 commit，下面是回填后的实际状态。

> **当前没有可 merge 的东西** —— 两个窗口都在 task 内部、各自挂了 WIP 分支并明确标注「勿 merge」。
> 监控模式照常运行，等到完成态 commit 再走标准流程。

### 窗口 1 — ✅ CapCut setup-script 完成 → 🔧 新 initiative: multi-video technique-match
- 分支：`worktree-capcut-link`，origin tip `adf2011`
- **CapCut setup-script link fix —— ✅ 完成**：7 个 task 全部 merge，Windows 实测通过（不再弹 "Couldn't link"）。
  唯一剩余是 macOS `setup.sh` 真机补测，目前由 CI 测试 `tests/capcut-compiler/setup-scripts.test.ts` 覆盖。
- **新 initiative：多视频 technique-match（AI 跨视频编排剪辑）**
  - plan：`docs/superpowers/plans/2026-05-14-multi-video-technique-match.md`（**Task 1–14**，端到端串行）
  - **Task 1（契约冻结 + 共享类型/schema）—— ✅ 已 merge（`b6c5e5b`）**：经过一次 bounce —— 窗口 3 review 发现
    `route.ts` 不能直接 export zod schema（`.next/types` TS2344），窗口 1 改为抽到同目录 `schema.ts`，三项验证全绿后 merge。
  - **Task 2（CapCut 转场结构逆向探测 PROBE）—— 🔧 WIP，勿 merge**：origin tip `adf2011`，commit 标 `[WIP — 勿 merge]`。
    已产出 `docs/CAPCUT-TRANSITION-STRUCTURE.md` + `scripts/probe-capcut-transitions.ts`，逆向出 transition material 字段结构、
    转场挂在前导 segment 的 `extra_material_refs`、时间轴语义是「`is_overlap=true` 但 `target_timerange` 线性累加不重叠」
    （三选一里最简单的一种，大幅简化 Task 8）。**卡点**：只实测到 2 种 `effect_id`（Slick Twist / Filmstrip），
    缺 cross dissolve / 叠化 —— Task 6 降级策略的落点。窗口 1 要补完叠化转场再出完成态 commit。
- ⚠️ **窗口 1 的 WIP 直接推在 `worktree-capcut-link` 上** —— monitor 会对 `adf2011` 触发 `CHANGED`，
  靠 commit message 里的 `[WIP — 勿 merge]` 识别、跳过不 merge（见标准流程第 4 步「还在 task 内部 → 不 merge」）。

### 窗口 2 — ✅ P0 + P1 全部完成 → 🔧 P2 看板实施中（P2.1 checkpoint 1）
- 分支：`feat/hot-tracking-p0-p2`，origin tip `1500459`（P2 放行确认回执）
- spec：`docs/superpowers/specs/2026-05-13-hot-tracking-design.md`（v4.1）
- plan：`docs/superpowers/plans/2026-05-13-hot-tracking-implementation.md`
- **P0 + P1.1–P1.15 —— ✅ 全部 merge 进 main**：P1.8 ck2（`normalizeTikTokTrendingHashtag` + 非有限数 guard）、
  P1.9（`scrapeTikTokTrendingHashtags` Stage 1）、P1.10（IG hot-hashtag list）、P1.11（Haiku topic-classifier）、
  P1.12（two-stage `fetchTrendingSnapshot` 编排）、P1.13（cron route + dual auth）、P1.14（`vercel.ts` 周热点 cron）、
  P1.15（`computeHashtagVelocity` 跨周趋势连续性）。
- **P2 已放行**：architect 确认 P2.1–P2.8 在 plan 里均有 verbatim 代码 + 测试 + Step、无歧义；窗口 2 已回写确认（`window-2.md`），开始 P2.1。
- **P2.1（`retrieval.ts` snapshot 兜底层，任务内双 commit checkpoint）—— 🔧 WIP，NOT FOR MERGE**：
  推在独立分支 `wip/p2.1-progress`，tip `c902584`「checkpoint 1 in progress — pickSnapshotMatches」。
  checkpoint 1 = 纯函数 `pickSnapshotMatches`，checkpoint 2 = 链路集成。恢复笔记在 `docs/WIP-P2.1-RESUME.md`。
- **之后的工作**：P2.1 ck2 链路集成 → P2.2 `/api/trending` route → P2.3 `TrendingCard` → P2.4 `PlatformFilter`
  → P2.5 `TrendingBoard` → P2.6 `app/trending/page.tsx` RSC → P2.7 Playwright E2E → P2.8 全量验证 + push。
- ⚠️ **窗口 2 的 WIP 推在独立 `wip/p2.1-progress` 分支** —— monitor 只看 `feat/hot-tracking-p0-p2`，不会对 WIP 触发。
  完成态 commit 会推回 `feat/hot-tracking-p0-p2`，那时 monitor 才触发。
- ⚠️ **P1.1 的 Vercel 部署前置仍是 deploy-time gate**：viral-reviewer 在 Vercel 账户下还没 project，
  cron 套餐验证 + `ADMIN_TRIGGER_SECRET` 配置要首次部署后才能做 —— 不阻塞代码实施，但 P2 全做完后要安排首次部署。

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

## 换机器恢复步骤

> 用户在多台 Windows 机器间切换。代码全在 GitHub（当前 `main` = `6986166`），照下面走。
> 已有 worktree 的机器只需 `git pull`，从未 clone 过的机器走下面完整步骤。

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
- **窗口 3（主仓库 `main`,协调者）**：`git pull origin main --no-rebase` 同步到 `6986166`,读本文件即可恢复。
  重新用 Monitor 工具起 persistent poll 脚本（90s 间隔,比对 `origin/worktree-capcut-link` 和
  `origin/feat/hot-tracking-p0-p2` 的 tip）。然后进入"收到 CHANGED 事件 → 标准流程"的被动监控模式。
  ⚠️ 收到 `CHANGED` 后先看 commit message:带 `[WIP]` / `勿 merge` / `NOT FOR MERGE` 的不 merge,等完成态 commit。
- **窗口 1（`.claude/worktrees/capcut-link`）**：开窗后先 `git pull origin main --no-rebase`,读 `docs/coordination/window-1.md`
  确认 SHA。**当前在 multi-video technique-match 的 Task 2（CapCut 转场逆向 PROBE）—— WIP 未完成**:
  origin `worktree-capcut-link` = `adf2011`,卡点是只实测到 2 种 transition `effect_id`,缺 cross dissolve / 叠化。
  恢复实施 = 补完叠化转场的 `effect_id` 实测 + 收口 `docs/CAPCUT-TRANSITION-STRUCTURE.md`,出完成态 commit 走 per-task 闭环。
  之后按 `docs/superpowers/plans/2026-05-14-multi-video-technique-match.md` 的 Task 3–14 继续。
- **窗口 2（`.claude/worktrees/hot-tracking`）**：开窗后先 `git pull origin main --no-rebase` 同步到 `6986166`。
  **当前在 P2.1（`retrieval.ts` snapshot 兜底层）—— WIP 未完成**:WIP 在独立分支 `wip/p2.1-progress` = `c902584`,
  checkpoint 1（纯函数 `pickSnapshotMatches`）进行中。恢复实施 = 读 `docs/WIP-P2.1-RESUME.md` + plan 文档 `## Task P2.1`,
  继续 ck1 → ck2 链路集成,完成态 commit 推回 `feat/hot-tracking-p0-p2` 走 per-task 闭环,再 P2.2 → P2.8。
  P1.1-P1.15 已全部 ✅ merge,不要重做。

### 端口分配（防 dev server 冲突）
窗口 1 = 3001,窗口 2 = 3002,窗口 3 = 3000。`npm run dev -- -p <port>`。

---

## 窗口 1 / 2 的 per-task 工作流（强制 —— 换机器后必须照此跑）

> memory 是本机本地的、换机器不跟过去,所以这条工作流写进 repo 文档作权威来源。
> 对应 memory:`feedback_sync_main_before_task.md`(本机)。

多窗口并行(每窗口各自 worktree)时,**每个 task 走完整的「push → 等 merge → 同步」闭环,确认后才开始下一个 task**。不允许不 push 就接着做、或不等 merge 就抢下一个 —— 否则后续 commit 会跟 main 的 merge commit 分叉,merge history 变乱、易冲突。

**完整 per-task 闭环:**
1. 当前 task 完成(实现 + spec review + code-quality review 都过)
2. **立即 `git push`** 把该 task 的 commit 推上去
3. **主动监控 `origin/main` 判定是否已 merge** —— 不被动等用户说,周期性 `git fetch origin` 然后检查该 task 的 commit 是否已可从 `origin/main` 到达(`git branch -r --contains <sha>` 含 `origin/main`)。可用 Monitor 工具跑 `until` 轮询循环,合入即退出。轮询间隔分钟级。
4. merge 确认后 **`git pull origin main --no-rebase`** 同步(显式 merge,保留分支历史)
5. **读 `docs/coordination/window-<N>.md`** —— 若头部 SHA 比上次读的新,说明窗口 3 有新指令(review 反馈 / 决策 / 跨窗口传话),按它执行
6. 同步无冲突、指令已消化后,**才** dispatch 下一个 task

**要点:**
- 「等 merge」是真的停下来等 —— 这是协调关卡,优先级高于「连续自动跑」。autonomous 指「不为每个工具批准停」,不是「跳过同步关卡」。
- task 内部的实现 + 双 review 仍连续自动跑,只在 task 边界(push 后)停下监控 merge。
- 窗口 3(协调者)那侧对应的是「收到 CHANGED → review → merge → 验证 → push」标准流程(见本文件上方)。两侧合起来才是完整闭环。

## 参考

- `docs/HANDOVER-2026-05-13.md` — 5/13 会话主接力文档（P1+P2/hotfix/P3/P0 全记录）
- `docs/HANDOVER-CAPCUT-LINK-2026-05-13.md` — CapCut link fix 调查 + 最终 Findings
- `docs/WORKTREE-STATUS-2026-05-13.md` — 三窗口 worktree setup 详细步骤 + 协作守则
- spec + plan 文档在 `docs/superpowers/specs/` 和 `docs/superpowers/plans/`
