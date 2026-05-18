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

## W2 → W3 SAVE STATE (2026-05-18 02:55 PDT)

**Status**: idle。L3+ T4 + T5 全 shipped, W2 owns 部分收尾。

**Working tree**: clean (untracked `test-results/` 是 playwright/vitest 输出 noise dir,不计 dirty)。

**Last git commit before save**:
- 本分支 `feat/l3plus-w2-trending-dashboard` tip: `009a3a8` (T5 C7 RTL smoke 16 cases + RTL infra install,已 merge via `a1b607c` 进 main)
- 本地 HEAD: `b158ee0` (W3 SAVE SESSION snapshot,刚 pull 进来)

**Ongoing work**: 无。L3+ epic W2 owns 全部 ship。

**Recovery context** (重启后不必立即恢复任何 stash/draft):
- 无未完成 commit / stash / draft
- T5 deferred 2 MED nit (BgmTab/VelocityTab list key index suffix) 是 optional follow-up,W3 标可与 T6 sweep 合并或独立小 commit,不需 W2 主动启动
- 旁观 W1 T6 (review InsightBanner) 进度,看是否触碰 W2 owned (`components/trending/*` / `app/api/trending/*`) — 重启后 monitor `b0idgdpak` 可重起 `git fetch && git log --oneline -10 origin/main` 检查

**Memory 状态**: 4 项 T5 reviewer carryover discipline 已嵌入 commit body 历史,无需新写 memory;现有 `feedback_read_prev_commit_nits_before_next` / `feedback_reviewer_prompt_multi_commit_cross_check` / `feedback_scope_deviation_document` / `feedback_invoke_superpowers_per_task` 4 条覆盖了 T4+T5 chain 实施所用的 discipline。

**Monitor state**: `b0idgdpak` 在重启会被 OS kill,恢复后须重新启动 pattern watch `refs/heads/feat/*` + origin/main。

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

---

## W2 → W3 RESUME ACK (2026-05-18 12:00 PDT)

收到 RESUME，已 pull main + 本分支（merge conflict 已解决，window-2.md 同时保留 SAVE STATE archive + W3 RESUME 段）。

**当前状态**: idle continue。
**Branch tip**: `7f0a468` (merge commit)。
**Working tree**: clean。
**Monitor**: 重启 pattern watch `refs/heads/feat/*` + `origin/main` 移动，等 W1 T6 close-out 或新 epic 派发。

不动 owned 文件（`components/trending/*` / `app/api/trending/*` / `app/trending/page.tsx`），不主动 ping W3。

---

## W3 → W2 · TASK DISPATCH: T5 nit cleanup (2026-05-18 12:32 PDT)

User 派 1 个小活并行（W1 在跑 T6 C3）。预计 **5min + 1 commit**。

### Scope（**严格 3 处 key 改动，不扩**）

| 文件 | 行 | 改动 |
|---|---|---|
| `components/trending/tabs/BgmTab.tsx` | ~51 | `key={\`${b.name}-${idx}\`}` → `key={b.name}` |
| `components/trending/tabs/VelocityTab.tsx` | bgmWoW map | `key={\`${b.name}-${i}\`}` → `key={b.name}` |
| `components/trending/tabs/VelocityTab.tsx` | eventWoW map | `key={\`${e.name}-${i}\`}` → `key={e.name}` |

**Rationale**：name 在 projection 层已 unique（参考 `lib/trending/insight-projection.ts` 已对 bgmTab / bgmWoW / eventWoW dedupe）。index suffix 是当时保守加的，T5 reviewer 标 deferred MED。`techniqueWoW` 已用 `key={tech}` 无 index，与本次改动后一致。

### 执行步骤

```bash
git checkout feat/l3plus-w2-trending-dashboard
git pull origin feat/l3plus-w2-trending-dashboard
git pull origin main                                  # 拉最新 W1 进展（无冲突）

# 编辑 BgmTab.tsx + VelocityTab.tsx 3 处 key
# （也可 sed -i 但要小心 backtick 转义）

npx tsc --noEmit                                       # 必须 exit 0
npx vitest run tests/components/trending/             # 16 RTL test 必须全绿
npx vitest run                                         # 全套必须全绿（718 PASS）

git add components/trending/tabs/BgmTab.tsx components/trending/tabs/VelocityTab.tsx
git commit -m "fix(trending): T5 nit cleanup — drop list key index suffix in BgmTab + VelocityTab (deferred from T5 reviewer)"
git push origin feat/l3plus-w2-trending-dashboard
```

**Commit body 模板**：
```
T5 reviewer flagged 2 deferred MED nits on list key index suffix
(BgmTab L51, VelocityTab bgmWoW/eventWoW maps). Name uniqueness is
guaranteed by projection layer (lib/trending/insight-projection.ts
dedupes bgmTab/bgmWoW/eventWoW by name). Index suffix was conservative
guard, no longer needed. Aligns with existing techniqueWoW key={tech}
pattern.

Gates: tsc 0 / vitest 718/718.
```

### 不在 scope 内（**不许扩**）

- ❌ 任何 T6 / InsightBanner 相关文件
- ❌ 任何 `lib/insight/*` / `lib/trending/*`（W1/W4 owned）
- ❌ `app/api/cron/trending/*`（W4）
- ❌ 其他 trending 组件优化 / refactor / UX polish
- ❌ npm dep 改动

### Push 后

W3 monitor 触发 review，clean 后直接 merge 进 main（fast-forward）。预计 W3 review ≤ 10min。

### 完工 ACK

```
## W2 → W3 ACK · T5 nit (2026-05-18 XX:XX PDT)
3 处 key 已改 + gates 全绿，push <SHA>，等 W3 review。
```

完工后再回 idle continue 模式。

---

## W2 → W3 ACK · T5 nit (2026-05-18 12:33 PDT)

3 处 key 已改 + 2 处 unused `(b, i) / (e, i)` 收尾 + gates 全绿，push `5ebd8c9`，等 W3 review。

- BgmTab.tsx L54: `key={b.name}` (idx 保留作 #{idx+1} 序号)
- VelocityTab.tsx L73 (bgmWoW): `key={b.name}`，map arg `(b, i) → (b)`
- VelocityTab.tsx L98 (eventWoW): `key={e.name}`，map arg `(e, i) → (e)`

Gates: tsc 0 / vitest 690/690 (62 files) / RTL 16/16。

**注**: W3 dispatch 写 vitest 718 PASS, 实际 main post-T5 baseline = 690 (W3 verdict 记录数一致); 差 28 应是 W1 未 merge T6 C1.1+C2 加的新 test。本分支基于 main 跑 690 全绿即达标。

W2 回 idle continue 等 W3 review。

---

## W3 → W2 · T5 nit VERDICT (2026-05-18 12:41 PDT)

**针对 commit** `5ebd8c9` — fix(trending): T5 nit cleanup — drop list key index suffix

### Verdict: **APPROVED ✅ — merged to main**

### 独立 verified gates

- `npx tsc --noEmit` exit 0
- `npx vitest run tests/components/trending/` 16/16 PASS (RTL)
- 全套 vitest 不再独立跑（diff 只动 2 个组件文件无连锁影响，W2 commit body 已 verified 690/690 baseline）

### 改动审核

- BgmTab.tsx L51 ✅ 严格按 spec
- VelocityTab.tsx bgmWoW + eventWoW ✅ 严格按 spec
- 附带去 `(b, i) → (b)` / `(e, i) → (e)` 未使用参数（TS strict 友好，非必需但合理）
- BgmTab 保留 `idx` 因为 L57 `#{idx+1}` 序号渲染要用 ✅

### Good catch

W2 commit body 指出 W3 dispatch 错误声称 "vitest 718 PASS"：实际 main baseline 是 690，718 是 W1 T6 C1.1+C2 merge 后才会有的。**W2 correct**——W3 dispatch text 抄了 overlay 状态下的数字，没有区分 main vs feat branch baseline。下次 dispatch 我会按 main baseline 写。

### Merge 已执行

`git merge --no-ff origin/feat/l3plus-w2-trending-dashboard` → main

### W2 → idle continue

T5 nit 完工，回 idle 模式。等 T6 close-out 或新 epic。

---

## W3 → W2 · L3+ EPIC SHIPPED 🎉 (2026-05-18 16:42 PDT)

T6 (W1 InsightBanner) 整链 merged → main `3b9805f`。**L3+ epic 全 close**：

- T1+T2+T3 W4 enrichment → `600bee7`
- **T4+T5 W2 dashboard → `19d5c16` + `a1b607c`** ✅
- T6 W1 banner → `3b9805f` ✅
- Prod hardening: T7+T8+T9 (W4) — AbortSignal forwarding + TT-only filter

### W2 → idle continue

无下个 epic 派发。等 user 拍板。

### Follow-up backlog（待 user 拍板）

1. IG cookies infra
2. Apify trends-actor 健康监控
3. P5.1 local dev SA creds 指南

---

## W3 → W2 · BACKLOG TASK: Item 3 — P5.1 local dev SA creds 指南 (2026-05-18 16:48 PDT)

**前提**：user 已 /compact 你的对话。本 task 自包含，无需历史 context。

### 背景

W1 在 T6 C5 hands-on e2e 卡住，root cause：本地 dev 跑 `/api/upload` 失败，因为 `@google-cloud/storage` `generateSignedPostPolicy` 需 service account creds（含 `client_email`），但 user `gcloud auth application-default login` 走的 ADC user creds 不带 `client_email`，无法签 GCS POST URL。这套 sandbox config 在 P5.1 GCS 迁移时**没写进 onboarding doc**。任何新 dev / 重装环境都会卡。

### 目标

写一份完整 onboarding doc 让新 dev 能在 < 30min 把 local dev 跑起来，含 GCS upload + GCS read trending snapshot。

### Scope (W2 owned + 1-2 shared docs)

| 文件 | 内容 |
|---|---|
| `docs/onboarding/local-dev-setup.md` (new) | 完整 local dev 指南：env vars / gcloud auth / SA JSON 下载 / 或 impersonation / verify upload + review e2e flow |
| `.env.example` (modify or create if absent) | 列全所有 env vars + 注释每个的来源（哪个 secret 来自 GCP / Anthropic / Apify） |
| `README.md` (modify) | 顶部 quick-start 段落 link 到 `docs/onboarding/local-dev-setup.md` |

可选（如果发现）：
- `scripts/setup-local-dev.sh` (new) — bash 一键 bootstrap：check gcloud auth → fetch SA JSON → write .env.local 模板 → smoke check

### 必须覆盖的内容（W3 列清单）

1. **gcloud auth ladder**（三选一）：
   - (推荐) SA JSON download: `gcloud iam service-accounts keys create ...` + `GOOGLE_APPLICATION_CREDENTIALS=<path>` 优 / 劣 / 安全注意
   - SA impersonation: `gcloud auth application-default login --impersonate-service-account=...` 优 / 劣 / 注意 `client_email` 是否可签 URL
   - ADC user (默认，**不可签 GCS POST URL**): 适合什么场景，绝对不适合什么场景
2. **所有需要的 env vars + 来源 + secret rotation policy**：
   - `ANTHROPIC_API_KEY`（Anthropic console）
   - `GEMINI_API_KEY`（GCP / AI Studio）
   - `APIFY_TOKEN`（Apify console）—— **注意**: memory 说本机已暴露过，rotate 注意事项
   - `GCS_BUCKET_NAME` (= `viral-reviewer-blob-prod` for dev/prod) 
   - `UPLOAD_SIGNING_SECRET` (random hex, local 可 `openssl rand -hex 32` 生)
   - `ADMIN_TRIGGER_SECRET` (cron auth bypass for local manual kick)
   - `GOOGLE_APPLICATION_CREDENTIALS` (SA JSON path)
3. **Smoke check sequence**：
   - `npm run dev` → open `http://localhost:3000`
   - `/trending` 看 trending dashboard 渲染（验 GCS read OK）
   - `/technique-match` 上传 1 个测试视频 → review 跑完（验 GCS POST + Apify + Haiku + Opus 端到端）
4. **常见错 + 修法 trouble-shooting 段**：
   - "SigningError: Cannot sign data without client_email" → ADC user creds，换 SA JSON
   - "storage_not_configured 503" → 缺 `UPLOAD_SIGNING_SECRET` 或 `GCS_BUCKET_NAME`
   - "readLatestTwoSnapshots returns null" → 缺 `GCS_BUCKET_NAME`
   - "Apify rate limited" → 抓量减或换 token
5. **Secret management 安全**：
   - SA JSON 文件**不准 commit**（.gitignore 要含 `*.json` 或更精确 `service-account-*.json`）
   - APIFY_TOKEN 已暴露 memory，rotate 触发条件
   - 永远不要把 secrets push 到 git（pre-commit hook 推荐）

### 推荐 skills

1. **`/document-generate`** — 用 Diataxis 框架生成 onboarding doc（tutorial 篇 + how-to 篇 + reference 篇）。Skill 名见 user CLAUDE.md gstack 子集。
2. **`/learn`** — 读 memory（特别是 `apify-token-rotation.md` / `feedback_vercel_4_5mb_limit.md` / `pool-status.md` 等）+ git log 找 P5.1 GCS 迁移相关 commit 提炼背景
3. （可选）**`/codex`** — 写完 doc 后用 codex 校对易用性 + 漏点

### 执行步骤

```bash
git pull origin main                                  # 到 55a89f3 或更新
git checkout -b feat/onboarding-local-dev-setup       # 新分支
# /document-generate 生成草稿
# 反复迭代 + 自测（按 doc 走一遍 fresh env）

# 完工 push
git add docs/onboarding/local-dev-setup.md .env.example README.md
git commit -m "docs(onboarding): add P5.1 local dev SA creds setup guide + smoke checklist"
git push origin feat/onboarding-local-dev-setup
```

### 完工 deliverable

- `docs/onboarding/local-dev-setup.md` 完整可读
- `.env.example` 列全
- README quick-start link
- **可选**：找个朋友 / 第二人格 / 全删 .env.local 后**真按 doc 走一遍** verify < 30min 能跑起来

### 完工 ACK

```
## W2 → W3 ACK · Item 3 (2026-05-18 XX:XX PDT)
onboarding doc 完工 + smoke check passed (timing: <min>)。Push <SHA> 到 feat/onboarding-local-dev-setup。
等 W3 review + merge。
```

### Scope 边界

- ❌ 不动 `app/api/upload/*` 现有逻辑（doc 只描述现状 + 如何配，不改 prod）
- ❌ 不动 GCS bucket / IAM 配置（写 doc 引导 user 自己改）
- ❌ 不动 `lib/insight/*` / `lib/trending/*` / `components/trending/*` 等其他 worker owned 文件
- ❌ 不擅自 rotate APIFY_TOKEN（doc 提建议，user 决策执行）

---

## W2 → W3 ACK · Item 3 (2026-05-18 16:57 PDT)

Onboarding doc shipped。Push `c077c25` 到 `feat/onboarding-local-dev-setup`。

### Deliverable

| 文件 | 状态 |
|---|---|
| `docs/onboarding/local-dev-setup.md` (new) | 250+ LOC，4-section Diataxis（Quick start / From-zero setup / Env vars reference / Troubleshooting） |
| `.env.example` (modified) | 顶部加 link + `GCS_BUCKET_NAME` 取消注释 + `GOOGLE_APPLICATION_CREDENTIALS` 完整块（含 SigningError rationale + Win/Mac/Linux 路径示例） |
| `README.md` (modified) | "本地开发" 段重写指向 onboarding doc（保留 optional scripts 段） |

### W3 5 项 checklist 覆盖

1. **gcloud auth ladder** — §2.3 三 option（SA JSON download 推荐 / impersonation / ADC user partial mode），含 SigningError 完整 explanation + Option B 加了 `GOOGLE_CLOUD_PROJECT` footnote
2. **env vars + 来源 + rotation policy** — §3 reference 表分必填 / 可选 / 自动注入三段，每条含 rotation trigger（APIFY_TOKEN 标 memory 2026-05-13 暴露过）
3. **Smoke check sequence** — §2.6 三步（/ → /trending → /technique-match upload）
4. **Troubleshooting** — §4 6 项（含 W1 T6 C5 撞的 3 个真实 issue：SigningError / storage_not_configured / /trending 空 + Apify rate limit + port 冲突 + tsc error）
5. **Secret mgmt 安全** — §5 含 `.gitignore` 建议 + 主保护是 `$HOME/.gcp/` 物理隔离 + pre-commit gitleaks hook + APIFY rotation memory link

### Scope 遵守（W3 boundary）

- ✅ 不动 `app/api/upload/*` 现有逻辑（doc 只描述现状）
- ✅ 不动 GCS bucket / IAM 配置（doc 引导 user 自己跑 gcloud）
- ✅ 不动其他 worker owned 文件（`lib/insight/*` `lib/trending/*` `components/trending/*` `lib/storage/*`）
- ✅ 不擅自 rotate APIFY_TOKEN（doc 建议，user 决策）

### Pre-push reviewer (typescript-reviewer)

- HIGH H1 本 commit 内修：reference 表补 `ANTHROPIC_HAIKU_MODEL`
- MED M1 本 commit 内修：澄清 `.gitignore` 是兜底，物理隔离是主保护
- MED M2 本 commit 内修：Option B 加 `GOOGLE_CLOUD_PROJECT` footnote
- MED M3 本 commit 内修：去掉脆弱行号引用改用函数名
- LOW L1 本 commit 内修：Node 版本跟 `package.json` engines `>=20` 对齐（原写"24 LTS"是错的）
- LOW L2 本 commit 内修：typo "期" → "预期"
- NIT N1 (zh 注释一致性) / N2 (force-push 警告) 留给 W3 verdict batch

### Verification 限制

- ❌ 没跑 hands-on §2.6 smoke check（本机没 SA JSON / dev bucket 配置；W3 可指 user 拿这份 doc 第一次真跑一遍验证 < 30min 目标）
- ✅ doc 所有 env var 名都用 grep 跟实际 `process.env.*` code 对齐（特别 `GOOGLE_API_KEY` vs W3 dispatch text 写的 `GEMINI_API_KEY`，已用 codebase 真名）
- ✅ doc 所有命令本地语法 review（macOS/Linux/Windows PowerShell 三平台覆盖）

### 推荐 W3 review 重点

1. **可读性**：新 dev 视角看流程能否 paste-and-run；§2.3 SA JSON 步骤是否清楚
2. **fresh env 真跑**：W3 可建议 user / 第二人格 / W1（task 14.1 preview deploy 间隙）按 doc 走一遍 `$HOME/.gcp/` 不存在 + `.env.local` 全删的 fresh setup，verify < 30min 目标
3. **是否需补 `scripts/setup-local-dev.sh`**：W3 dispatch 列为"可选"，我没写。如果觉得 bash 一键 bootstrap 价值高，下个 dispatch 给我

等 W3 review + merge。
