# docs/coordination/ — 窗口 3 → 窗口 1/2 的指令信箱

窗口 3（协调者）把给某个窗口的指令 / review 反馈 / 决策结果写进这里并 push 到 `main`。
对应窗口 `git pull origin main` 后读自己的文件即可，不再依赖用户人工转贴。

## 文件约定

- `window-1.md` — 给窗口 1（`worktree-capcut-link`）的指令历史
- `window-2.md` — 给窗口 2（`feat/hot-tracking-p0-p2`）的指令历史
- **追加式**：每条新指令以 `---` 分隔追加到文件末尾，**最新一段在末尾**；历史保留方便回溯上下文，git log 也是权威
- 每段头部标注：`写于 YYYY-MM-DD · 针对 main = <SHA> · 来自窗口 3 协调者`
- 窗口读完执行后，**无需删除或回写** —— 下次窗口 3 有新指令时再追加到末尾

## 窗口侧动作 — 触发点

**任一触发点出现就跑完整动作流**，不要跳过：

1. **monitor 触发 `origin/main` tip 前进**（W3 push 完 merge / coordination doc 后最常见的异步信号）—— 包括 "main moved" 这种纯 SHA 事件，**不要假设事件等于 merge 通过**，可能是 bounce 反馈 / 跨窗口传话 / follow-up
2. **monitor 触发自己分支的 push 后 W3 写信箱**（W3 看到你的 push 后通常先写反馈再 merge）
3. **开新 task 前**（无 monitor 信号时的兜底，确保不漏未送达的旧指令）

## 窗口侧动作 — 动作流

每次触发后**完整跑完这三步**，不要在中途下结论：

1. `git pull origin main --no-rebase`
2. 读 `docs/coordination/window-<N>.md` 的**最后一段**（用 `---` 切的最末一段）
   - 段头部 SHA 比你上次读的新 → 这是新指令，按它执行
   - 段头部 SHA 跟上次一样 → 没有新指令，按 plan 继续
3. **不要跳过 review 笔记 / follow-up / 浏览器烟测试 / 探测点列表** —— 这些不阻塞 merge 但决定下一步姿态（如 SSRF hardening 留 P3、N=6 并行 429 探测、a11y E2E 覆盖等）

### 误读保护

- **看到 "merged ✅" 不等于结束**：同一段里很可能附带「下一个 task 的 SSRF / a11y / 探测点」follow-up，必须读完整段
- **看到 "bounce" 不等于失败**：bounce = 这次 push 不进 main 直到 fix commit 推上来；按裁决加 fix commit 后再 push，不要切到下一个 task

## 触发写入的场景（窗口 3 侧）

- merge 后的 confirmation + 放行下一个 task
- review 反馈：critical / high finding 的裁决（bounce / 接受 in-PR fix / 接受 follow-up 后置）
- 跨窗口传话（如 W1 的 follow-up 影响 W2 接口契约）
- 浏览器烟测试 / 探测点列表（窗口 3 无 headless 环境时让用户那边跑）

纯 FYI 不写；只有需要窗口动作或需要窗口知情的事项才写。

## 跨 session 限制（W3 视角）

W3 **无法主动唤起 W1/W2 的 Claude session** —— 文件信箱是单向投递，monitor 是窗口侧异步信号。
如果窗口长时间 idle 又没有 monitor 触发（如 monitor 任务挂了 / 窗口未启动 monitor），需要用户在窗口侧手动发一句话唤起。
W3 push 完 coordination doc 后，**默认窗口很快会读到**；超过 15-30 分钟还无 push 信号回弹时，向用户提示「W<N> 可能 idle，需要手动唤起」。
