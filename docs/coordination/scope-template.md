# Scope-First PR 模板（viral-reviewer · W1 ⇄ W3 协调工作流）

> **生效**：2026-05-15 起，from P3 #3 phase 2（rate-limit route wiring）onward
> **来源**：P3 #2 phase 2 hidden regression 教训（账户路径 frame analyze 因 caller 选错 preset 被 100% silently 废）→ phase 2.5 W3 verdict §E 决议 freeze
> **强制度**：W3 review scope draft 时**必须**核查本模板每个必填栏；缺栏 / 不一致 = 阻止 scope merge

---

## 1. 适用范围

任何涉及以下任一情况的 W1 → W3 scope draft：

- 跨越 ≥2 个 fetch 点 / route 入口的 hardening pass（如 rate-limit / url-allowlist / input-validation 批量改造）
- 涉及 caller 选 preset / 策略实例的 lib wiring（如 P3 #2 preset 选择、P3 #3 rate-limit bucket 选择）
- 改动多个 schema / route handler 的 API tightening（如 Task 14 schema 收紧）

单文件 < 30 LoC bug fix / 纯 docs / 纯 test 不强制走本模板。

## 2. 必填栏（W3 review 核查项）

### 2.1 改动清单表格

```
| # | 位置 | 改动类型 | 改动摘要 | 影响面 |
|---|---|---|---|---|
| 1 | path/to/file.ts:line | feat / fix / refactor | 1 句话 | route / lib / test / docs |
```

### 2.2 URL / 数据源 → 策略选择表格（**P3 #2 phase 2 错判根因**）

**如果 scope 涉及 fetch user-supplied URL / 数据源走 allowlist / rate-limit bucket / preset 选择，本表必填**：

```
| # | 位置 | URL 来源 | URL host pattern / 数据来源 | 选用 preset / 策略 | 现有校验 |
|---|---|---|---|---|---|
| 1 | route file:line | client JSON body / scrape output / config / cron | 实际 host suffix（如 `*.public.blob.vercel-storage.com` / `*.tiktokcdn.com`）/ 数据 schema | VERCEL_BLOB_PRESET / TIKTOK_INSTAGRAM_CDN_PRESET / new | inline / lib / none |
```

**W3 核查 checklist**：
- [ ] 每个 fetch 点的 "URL 来源" 列**明确写出**（不能是 "user input"——要具体到 `client JSON body` / `Apify scrape output` / `Cron config` 等）
- [ ] 每个 fetch 点的 "URL host pattern" 列与 "选用 preset" 一致（preset 的 allowedHosts 覆盖该 host pattern）
- [ ] 不一致 = 阻止 scope merge

### 2.3 设计决策点（A/B/C/...）

每个决策点至少包含：

- **选项**：2-4 个候选，命名 A1 / A2 / ...
- **优缺点**：每候选 1-3 bullet
- **W1 倾向**：明确写"W1 倾向 X，理由 ..."
- **请 W3 拍板**：列出 W3 应回答的具体问题

### 2.4 提议改动清单（基于 W1 倾向）

按 W1 倾向假设展开，列每文件预期改动 + 新增测试 case 数。

### 2.5 三门估算

- `tsc --noEmit` 预期：0 / N error
- `vitest run` 预期：base + N new
- `next build` 预期：routes 变化 / bundle 变化

### 2.6 风险面 + 兜底

列出已识别的 N 个风险 + 每风险的兜底方案（短期 fix / 长期 fix）。

### 2.7 **pre-commit 验证机制**（**P3 #2 phase 2.5 起新增**）

如果 scope 涉及 preset / 策略选择，**W3 verdict 时通常会要求 W1 在 commit 1 前做本机 sample-verify**：

- 跑真实 sample（如 Apify scrape / 现有 `data/scraped/*.json`）
- 统计 host 分布 / 数据 shape 分布
- 验证 scope 所选 preset / 策略覆盖实际流量
- **结果写进 commit 1 message 末尾**（不进 git tracked file）

W1 主动在 scope draft 风险面里提到"实施前会本机 sample 验证"是加分项。

## 3. W3 verdict 必含项

W3 接收 scope draft 后的 verdict 必须包含：

### 3.1 逐项决策回答

每个 W1 提议的决策点 (A/B/C/...) 都要给 explicit verdict（不能 "看你的"）。

### 3.2 必要的 scope 收紧 / 扩张

如 W3 发现 W1 漏列的风险面 / 错判的 URL 来源，**必须**在 verdict 显式提出（如 P3 #2 phase 2.5 verdict §D 要求 sample-verify）。

### 3.3 commit chain 建议

W3 verdict 应给 commit 拆分建议（如 P3 #2 phase 2 给 6-commit 拆分），并接受 W1 deviation 如果有 tsc-green 等硬约束。

### 3.4 不阻塞建议

scope 之外的优化建议（如"未来可以加 metric"），明确标"不阻塞 phase X scope"。

### 3.5 信箱清场

W3 verdict 末尾必须明确：
- 当前 W3 状态（idle / waiting on X）
- 期待的下个 monitor 事件
- W1 是否 cleared / blocked

## 4. 已记录的协调 anti-pattern

| Anti-pattern | 出处 | 防御机制 |
|---|---|---|
| Caller 选错 preset → silent regression | P3 #2 phase 2 (`account-profile` frame analyze 100% disabled) | §2.2 "URL host pattern → preset" 必填栏 + W3 核查 |
| Lib 函数 optional 参数 → caller 漏传 = runtime SSRF 漏洞 | P3 #2 phase 2 (lib opt-in 设计) | W3 verdict 要求把 `urlAllowlist` 改 required + tsc 编译期堵漏 |
| Test fixture 假设旧 API 行为 → 新 API 测试覆盖率虚高 | Task 14 / phase 2 (`template-brief-route.test.ts`) | scope draft §2.6 风险面强制列"既有 test fixture 是否需更新" |
| Stream 启动后 fail-fast → HTTP 200 but stream error event；**衍生**: stream 内调 fetch 必须用 `fetchWithAllowlist` 或 helper（pre-batch checkAsync 已防御，但 stream 内部 caller 必须用 helper 防回归） | P3 #2 phase 2 `technique-match` + P3 #2 phase 3.5 caller wiring | W3 verdict 提示 "stream 启动前必须 batch check"；衍生防御：stream 内 fetch 必须用 helper（P3 #2 phase 3.5 `a9d615d` 落地） |
| Scope 列 route 模式（wrapper/inline）但实施时未复核 route 实际行为（stream vs non-stream） | P3 #3 phase 2 commit 3（W1 主动 deviation：4 routes scope 列 wrapper 但实际是 NDJSON stream） | scope draft §2.1 改动清单加 "route mode (stream/non-stream)" 必填栏 + 实施前 `grep -r "ReadableStream" app/api/<route>/` 复核 |
| DNS resolve 用 `dns.lookup`（libc getaddrinfo）→ 受 OS hosts file 干扰 → 测试 / CI / runtime 行为不可重复 | P3 #2 phase 3 commit 1（W2 选 `dns.resolve4/6` 而非 lookup） | SSRF 防御 lib 必用 `dns.promises.resolve4` + `resolve6`，绕 libc 直查 authoritative |
| Fetch with IP literal 不传 SNI / Host header → TLS cert validation fail + virtual host routing 错 | P3 #2 phase 3 commit 3（W2 用 undici Pool `connect.servername`） | `fetchWithAllowlist` 用 undici Pool with `origin: <resolvedIp>:<port>` + `connect: { servername: hostname }`；caller 一行用 helper 不可漏 |
| Lib 不显式 close 资源（undici Pool 等） → 测试不查 → 长期泄漏 | P3 #2 phase 3 commit 3（W3 verdict 强制断言 `Pool.close()` 被调用） | 涉及创建有状态资源的 lib helper 必须用 `try { } finally { resource.close() }` + 测试显式断言 close 被调用 |
| **#10**: Scope 假设依赖 ownership-locked 文件但未在 §2.6 列出 → implementer 实施才发现 deps missing | P5.2 phase（W2 P5.2.4 scope §2.6 首次落地 reference example）+ W4 P5.8 §2.6 reference example #2 | scope draft §2.6 强制 "ownership-dependency check" 子节：每个假设的外部 owned 文件 (lib / route / service.yaml / runbook) 必须列出 + frozen/pending 标注 + W3 ownership 验证；详见 [[feedback_scope_ownership_dependency_check]] |
| **#11**: GHA workflow 不显式 pin docker buildx platform → multi-arch 浪费 Artifact Registry 存储 + Cloud Run 只跑单 arch | P5.2.1 W4 v1 (`d3fddf7`) buildx default multi-arch 实测 +640MB blob 浪费 → W3 verdict MED #2 mandate | infra scope GHA workflow 涉及 docker build 必须显式 `--platform linux/amd64`（Cloud Run target arch）+ post-build `docker image inspect` 验 arch；scope draft §2.3 强制列 platform pin 决策 |
| **#12**: 多 worker 共享同一 worktree 切 branch → 对方 uncommitted 改动会丢 | P5.2.1 v2 W4 ops 现场（`.claude/worktrees/hot-tracking` 被 W2 worker 切到 `feat/p5.2.4-deploy-workflow-scope` 后 W4 v2 uncommitted 改动丢失） | 强制每 worker 独立 worktree（W1=`w1-*` / W2=`w2-*` / W4=`w4-*`），互不切对方 branch；多 worker 同 repo 并行时（如 P5 phase 4-window）必须 enforce |
| **#13**: Untrusted client-driven webhook (completion ping / event ack) without signing → impersonation | P5.1.b-2 W1 b-2 scope §4 提议 + commit chain 实施 (handleCompletion phase 3b) | 4 重防御 mandatory：(1) HMAC + TTL token 防 tamper + replay (2) Payload-content match：关键身份字段 (finalKey / userId) 在 token AND request body, verify 时 strict URL parse 不能 substring (3) Forward-compat nonce field for future at-least-once callers (4) Idempotency key DB enforcement (DB-write caller mandatory)；详见 [[feedback_hmac_token_implementation_defenses]] |
| **#14**: 移除 npm dep 前未 audit transitive 依赖 → local node_modules cached 会 mask removal regression → 必须 fresh install 才能 catch | P5.1.b-4 W1 (`fadabd2`) `npm uninstall @vercel/blob` 删除 transitive `undici`，但 `lib/url-allowlist/fetch.ts` 直接 imports → W3 fresh install caught TS2307；W3 hot fix `npm install undici@^7` 救场 | 5-step pre-uninstall checklist：(1) `npm ls --all <dep>` 列 transitive (2) `git grep "from \"<transitive>\""` audit 直接引用 (3) promote 到 direct dep (4) `rm -rf node_modules && npm install && tsc && test` fresh-install verify (5) THEN commit；详见 [[feedback_dep_removal_transitive_check]] + [[feedback_pre_push_reviewer_skip_dep_changes]] |

新增 anti-pattern 累积在本表，W1 / W3 scope review 时优先 cross-check。

## 5. 历史背景（不在模板，仅供 reference）

本文档由 P3 #2 phase 2.5 W3 verdict §E 决议触发：

- **P3 #2 phase 2 (`4f7f70f`)** merge 后 W3 review 发现 `account-profile/route.ts` 用 `VERCEL_BLOB_PRESET` 但 caller URL 来源是 TT/IG CDN，**100% silent regression**
- W1 phase 2 scope draft 列了 5 个 fetch 点但**没列每个 fetch 点的 URL host 来源** → 实施时默认所有 URL 都是 Vercel Blob
- phase 2.5 scope draft (`8976a54`) W1 主动承认错判 + 提议加 "URL host 来源 → preset 选择"必填栏
- W3 phase 2.5 verdict (`bb832ee`) approve E 决议
- phase 2.5 实施 (`0030171..312ae63`) 的 sample-verify 实测发现 `tiktokcdn-eu.com` 不在 W3 预测 4 host 内 → 扩 preset 为 5 host，避免新 silent regression

scope-first + URL-source-explicit + pre-commit-sample-verify 三重防御机制完成 freeze。
