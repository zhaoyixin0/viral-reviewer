# 协调窗口运行状态（窗口 3）

> Living document。窗口 3（主仓库 `main`）的协调者运行手册 + 进度快照。
> compact / 换机器后读这份文件即可恢复协调工作模式。
> 最后更新：2026-05-13 会话中段（strategic-compact 前）

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

## 当前进度快照

`main` HEAD：`1ed055d`（含 CapCut Blob relay merge + hot-tracking P0 merge）

### 窗口 1 — CapCut setup-script link fix
- 分支 HEAD：`8b05887`（= `1bd6697` plan + `621f95f` plan 修订 + merge main 同步）
- 状态：**plan 定稿，已同步 main，待进 subagent-driven-development 实施**
- plan 文件：`docs/superpowers/plans/2026-05-13-capcut-setup-script-link-fix.md`（7 个 task）
- plan 经窗口 3 两轮 review（含 architect agent），定稿。修订落实了：CI-able 脚本
  执行测试 + `VR_SETUP_DRAFTS_DIR` override + 3-guard 防御注释澄清
- 已 merge 进 main 的相关成果：`ff039a5` CapCut zip Blob relay（绕开 Vercel 4.5MB
  response 上限）
- **下一步预期**：窗口 1 push Task 1~7 的实施 commit，我逐个 review + merge
- Task 6 是用户手动实测（解压 zip → 跑 setup 脚本 → 开 CapCut 验证），到那步需用户介入

### 窗口 2 — hot-tracking / 周热点
- 分支 HEAD：`6f74661`（P0 实现）— 注意分支可能已 behind main 1（P0 merge commit）
- 状态：**P0 已 merge 进 main，在做 P1**
- spec：`docs/superpowers/specs/2026-05-13-hot-tracking-design.md`（3 轮 architect review 定稿）
- plan：`docs/superpowers/plans/2026-05-13-hot-tracking-implementation.md`（2 轮 review，
  C2/C3/M1/H3/H2 全部 fully fixed，定稿）
- 已 merge：`1ed055d` P0 — 30 天发布窗口过滤（`lib/research/topic-research.ts`，
  `withinPublishWindow` 纯函数 + 5 测试）
- **下一步预期**：窗口 2 push P1 的实施 commit。P1.1 是硬前置（验证 Vercel Cron
  可用 + 配 `ADMIN_TRIGGER_SECRET`），P1.8 BLOCKED ON P1.7（探测真实 actor key 名）
- P1/P2 会增量 merge

## compact 后不能丢的关键决策记忆

1. **CapCut 导入 bug 根因**：CapCut 用绝对路径引用素材，server 不知道用户解压到哪 →
   绝对路径只能在用户机器上生成 → 方案是 zip 里附 setup.ps1/.bat/.sh，用户本地跑。
   历史误判已纠正：`5db8fce` 的"死锁"不是填 `draft_materials` 错，是填了相对 `file_Path`。
2. **CapCut zip 下载 4.5MB 限制**：Vercel function response body 上限 4.5MB，已用
   Vercel Blob relay 解决（`ff039a5`），client 从 CDN 下 `blob.downloadUrl`。
3. **hot-tracking H1**：Vercel Cron 在当前套餐的可用性未验证，P1.1 必须先验证 +
   配 `ADMIN_TRIGGER_SECRET`（非 Vercel 自带，漏配则手动触发降级入口失效）。
4. **跨 worktree 共享改动必须经 main**：窗口改 → push 分支 → 窗口 3 merge → 其它
   窗口 `git pull origin main` + rebase。不跨目录 cp。
5. **APIFY_TOKEN 仍未 rotate**（`HANDOVER-2026-05-13.md` 第 4 节）。三个 worktree 的
   `.env.local` 都带泄露过的旧 token。

## 参考

- `docs/HANDOVER-2026-05-13.md` — 会话主接力文档（P1+P2/hotfix/P3/P0 全记录）
- `docs/WORKTREE-STATUS-2026-05-13.md` — 三窗口 worktree setup 步骤
- 两个 plan 文档 + 两个 spec 文档在 `docs/superpowers/`
