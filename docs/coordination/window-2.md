# 窗口 2 状态：L3+ T4+T5 全部完成并 merge ✅

> **写于** 2026-05-18 02:45 PDT · **针对 main SHA** (T5 merge 后) · **给窗口 2**

---

## L3+ T4+T5 epic 状态：**SHIPPED**

- T4 chain (C1+C2+C3, insight-projection + /api/trending + RSC seam) merged via `19d5c16`
- T5 chain (C4+C5+C6+C7, InsightTabs + 5 tabs + RTL infra) merged via current tip
- W3 cross-commit review verdict 整体: APPROVE_FOR_MERGE
- npm dep audit clean (+4 RTL devDependencies，runtime 零影响，无新 vuln)
- Gates post-merge: tsc 0 / vitest 62 files / 690 tests / build PASS / `/trending` 5.59 kB 保留 1h ISR + 1y immutable cache

## W2 当前状态：**idle**

L3+ epic 内 W2 owns 部分（T4+T5）已收尾。等下个 epic 派发。

期间可以做：
- 旁观 W1 T6（review InsightBanner）的实施，留意是否触碰 W2 owned 文件（`components/trending/*`、`app/api/trending/*` 等）
- 不主动 ping W3

## T5 reviewer 未 block merge 的 nit list（可选 follow-up，与 T6 sweep 合并或独立小 commit 处理）

1. `components/trending/tabs/BgmTab.tsx:50` — list key 去掉 index suffix（`key={\`${b.name}-${idx}\`}` → `key={b.name}`，BGM name 在 projection 已 unique）
2. `components/trending/tabs/VelocityTab.tsx` — bgmWoW + eventWoW key 同上去 index

## 12 个 npm audit pre-existing vulnerabilities（**不在本 epic scope**）

`@google-cloud/storage` transitives + `ai` SDK 链上的 4 High + 8 Med，需要专项 epic 跑 `npm audit fix --force`（breaking change）。本 epic 不动。

---

## W2 → W3 历史 ack（archive）

T4 + T5 dispatch/ACK/UNBLOCK ack 历史已在 git history。本文件 reset 为 idle 状态。

---

## W3 → W2 · SAVE SESSION 指令 (2026-05-18 02:55 PDT)

**User 要重启电脑**。W2 当前 idle（T4+T5 已 ship），但仍需 SAVE STATE 以防有任何未 push 改动。

**执行**：
1. `git status` 看 working tree 是否 dirty —— 若 clean 直接跳到 step 3
2. 若 dirty：全部 git add + commit 到 WIP commit（`wip(w2): session save before reboot — <一句话当前进度>`）+ push
3. 在 `feat/l3plus-w2-trending-dashboard` 分支 append `## W2 → W3 SAVE STATE (2026-05-18 02:55 PDT)` 段到本文件（window-2.md）：
   - 当前 status: idle / 有 ongoing 工作（描述）
   - 上一个 git commit SHA
   - 是否需要重启后立即恢复某个特定 context（如未完成的 nit 清理）
4. `git add docs/coordination/window-2.md && git commit -m "docs(coordination): W2 SAVE STATE before user reboot" && git push origin feat/l3plus-w2-trending-dashboard`
5. 告诉 user "W2 已 SAVE，分支 tip <SHA>"

**重启后恢复**：
1. 切到 W2 worktree
2. `git pull origin feat/l3plus-w2-trending-dashboard` + `git pull origin main`
3. `cat docs/coordination/window-2.md | tail -50` 读最新 W3 mandate + 自己 SAVE STATE
4. 等 W3 派下个 epic 或 T6 完成后的 close-out 通知

---

## W3 → W2 · RESUME 指令 (2026-05-18 12:00 PDT)

**Welcome back W2**。User 已完成重启，所有窗口在线。

### W2 当前状态：**idle continue**

T4+T5 已 ship，本 epic W2 owned 部分收尾。**当前无新任务派发**。

### Step 0 — 同步（保持环境最新）

```bash
git fetch origin --prune
git pull origin main                          # 拉最新（含 W1 C1.1 进展 + 本 RESUME）
git checkout feat/l3plus-w2-trending-dashboard
git pull origin feat/l3plus-w2-trending-dashboard
git status                                     # 应 clean
git log --oneline -5
```

### Step 1 — 等待模式

W1 现在跑 T6 C1.1 patch + C2-C5 链。期间 W2：

- **不要** 主动 ping W3
- **不要** 起任何新工作（避免与 W1 文件冲突）
- **不要** 动 `components/trending/*` / `app/api/trending/*` / `app/trending/page.tsx`（你自己 owned，但 idle 期不动）

### Step 2 — 旁观（可选）

如果想保持 context warm：
- 偶尔 `git pull origin main` 看 W1 push 的 commit（feat(insight): T6 C2-C5 ...）
- 如发现 W1 commit 触碰了你 owned 文件（不应该），append `W2 → W3 ALERT: W1 touched <file>` 到本文件，W3 会拦

### Step 3 — 下个 epic 触发条件

- T6 整链 merge 后，W3 会 push **L3+ epic close-out** 通知到本文件
- 或 user 派新 epic（review history 持久化 / event-detector 升级 / 运维 dashboard）

收到新 mandate 前**保持 idle**，无需 ACK 本 RESUME 指令。

### T5 nit follow-up（**T6 sweep 时机**）

memory：T5 reviewer 未 block 的 2 个 nit（BgmTab / VelocityTab list key index suffix）等 T6 整链 merge 后，由 W3 派一个 mini-sweep commit 处理。**现在不要动**。

### ACK（可选）

不强制。如想确认在线，可 append 一句：
```bash
echo "
## W2 → W3 RESUME ACK (2026-05-18 XX:XX PDT)
收到 RESUME，已 pull main + 本分支，idle continue 等 T6 close-out。" >> docs/coordination/window-2.md
git add docs/coordination/window-2.md && git commit -m "docs(coordination): W2 RESUME ack idle" && git push origin feat/l3plus-w2-trending-dashboard
```
