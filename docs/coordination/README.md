# docs/coordination/ — 窗口 3 → 窗口 1/2 的指令信箱

窗口 3（协调者）把给某个窗口的指令 / review 反馈 / 决策结果写进这里并 push 到 `main`。
对应窗口 `git pull origin main` 后读自己的文件即可，不再依赖用户人工转贴。

## 约定

- `window-1.md` — 给窗口 1（`worktree-capcut-link`）的最新指令
- `window-2.md` — 给窗口 2（`feat/hot-tracking-p0-p2`）的最新指令
- 文件**整体覆盖**，只保留最新一条指令；历史在 git log 里
- 每份文件头部标注：写于哪天 · 针对 `main` 的哪个 SHA · 给哪个窗口
- 窗口读完执行后，**无需删除或回写** —— 下次窗口 3 有新指令时直接覆盖

## 窗口侧动作

每次开新 task 前（已有的 per-task 工作流的一部分）：
1. `git pull origin main --no-rebase`
2. 读 `docs/coordination/window-<N>.md` —— 如果头部 SHA 比你上次读的新，按它执行
3. 没有新指令 / 文件没变 → 按 plan 文档继续

## 触发写入的场景（窗口 3 侧）

review 有 Critical/High、需要跨窗口传话、需要窗口确认的决策、merge 后的后续指示。
纯 FYI 不写；只有需要窗口动作时才写。
