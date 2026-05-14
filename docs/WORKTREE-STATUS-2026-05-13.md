# 三窗口 Worktree 协作状态 — 2026-05-13

> 当天临时离开/换电脑前的快照。回家（仍 Windows）后照此恢复同样的并行工作模式。

---

## 当前并行任务（三个 Claude Code 窗口）

| 窗口 | 任务 | Worktree 路径（相对仓库根）| 分支 | 远程 |
|---|---|---|---|---|
| 1 | CapCut "Couldn't link" 调试 | `.claude/worktrees/capcut-link` | `worktree-capcut-link` | `origin/worktree-capcut-link` |
| 2 | 周热点 P0–P2 功能 | `.claude/worktrees/hot-tracking` | `feat/hot-tracking-p0-p2` | `origin/feat/hot-tracking-p0-p2` |
| 3 | 调度/协调 + 杂项 | 主仓库根（`C:/Users/Admin/Desktop/help_you_viral`）| `main` | `origin/main` |

---

## 各分支最新进度（暂停点 HEAD）

### 窗口 1 — CapCut（`worktree-capcut-link` @ `b78a08e`）
- 最新 commit: `b78a08e docs(capcut): handover for Couldn't link investigation (pause point)`
- 状态：bug 未解。`docs/superpowers/plans/2026-05-13-capcut-zip-blob-relay.md` 内含调查 plan；handover commit 里写了下一步从哪续。
- 续接方法：进入该 worktree 目录，让 Claude 读 handover commit 和 plan 文档即可恢复上下文。

### 窗口 2 — 周热点（`feat/hot-tracking-p0-p2` @ `0d8a596`）
- 最新 commit: `0d8a596 docs(hot-tracking): WIP design spec with Section 1/6 + resume instructions`
- 状态：设计文档刚写 1/6（即只完成第 1 节，还剩 5 节），尚未进入代码实现。
- 续接方法：commit 里附 resume instructions，让 Claude 接着写设计文档。

### 窗口 3 — 主仓库（`main`）
- 角色：协调、push、写跨窗口状态文档（本文件）、运行不归属任一 worktree 的杂活。
- 不在该窗口写任务相关代码，避免和 worktree 抢路径。

---

## 回家恢复步骤（新机器，从零开始）

### 一次性环境准备

```powershell
# 1. clone 主仓库
git clone https://github.com/zhaoyixin0/viral-reviewer.git C:\Users\Admin\Desktop\help_you_viral
cd C:\Users\Admin\Desktop\help_you_viral

# 2. 取所有远程分支
git fetch origin --prune

# 3. 主仓库装依赖（如果撞 enterprise SWG cert 错误，看 docs/HANDOVER-2026-05-13.md 末尾的 SWG 处置经验）
npm install

# 4. 拉一份 .env.local（gitignored，需要从 vercel env pull 或私人备份恢复）
vercel env pull .env.local
```

### 重建两个 worktree

```powershell
# CapCut worktree
git worktree add .claude/worktrees/capcut-link worktree-capcut-link

# 周热点 worktree
git worktree add .claude/worktrees/hot-tracking feat/hot-tracking-p0-p2
```

### 各 worktree 内独立装依赖

> Windows 下推荐直接把主仓库的 `node_modules` 复制过去（省时间，避免再撞 SWG cert）：

```powershell
Copy-Item -Recurse -Force .\node_modules .\.claude\worktrees\capcut-link\
Copy-Item -Recurse -Force .\node_modules .\.claude\worktrees\hot-tracking\
```

或独立 `npm install`：

```powershell
Push-Location .\.claude\worktrees\capcut-link; npm install; Pop-Location
Push-Location .\.claude\worktrees\hot-tracking; npm install; Pop-Location
```

### `.env.local` 复制到每个 worktree

```powershell
Copy-Item .\.env.local .\.claude\worktrees\capcut-link\.env.local
Copy-Item .\.env.local .\.claude\worktrees\hot-tracking\.env.local
```

### 打开三个 Claude Code 窗口

- 窗口 1: 工作目录 `.\.claude\worktrees\capcut-link`
- 窗口 2: 工作目录 `.\.claude\worktrees\hot-tracking`
- 窗口 3: 工作目录主仓库根

每个窗口让 Claude 读对应分支的最新 commit + handover 文档接续即可。

---

## 端口分配（防 dev server 冲突）

| 窗口 | dev 端口 |
|---|---|
| 1 (CapCut) | 3001 |
| 2 (周热点) | 3002 |
| 3 (主) | 3000（默认）|

启动：`npm run dev -- -p 3001`（次同理）。

---

## 协作守则（避免互相踩）

1. **任何项目代码改动只在对应 worktree 里做**，main 主仓库只负责协调和文档。
2. 每个 worktree 推自己分支前先 `git status` 确认没漏文件、没误带别处工作。
3. 跨 worktree 共享改动必须经过 `origin/main` —— 在主仓库 merge 后再各自 rebase 拉取。
4. `node_modules` 各自独立，不要做软链接（next.js / .next 缓存会乱）。
5. `.env.local` 各自独立放一份，不要软链接。
6. 暂停某个窗口的工作前，让 Claude 写一条 `docs(<scope>): handover ... (pause point)` 风格的 commit，把当前调查到哪/下一步要做什么写进 commit message 或独立 handover 文档。

---

## 参考

- 当天主接力文档：`docs/HANDOVER-2026-05-13.md`（权威）
- 之前的接力：`docs/HANDOVER-2026-05-12.md`（过期）
- Multi-window 协作 superpower：`superpowers:using-git-worktrees`
