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
| Stream 启动后 fail-fast → HTTP 200 but stream error event | P3 #2 phase 2 `technique-match` | W3 verdict 提示 "stream 启动前必须 batch check" |

新增 anti-pattern 累积在本表，W1 / W3 scope review 时优先 cross-check。

## 5. 历史背景（不在模板，仅供 reference）

本文档由 P3 #2 phase 2.5 W3 verdict §E 决议触发：

- **P3 #2 phase 2 (`4f7f70f`)** merge 后 W3 review 发现 `account-profile/route.ts` 用 `VERCEL_BLOB_PRESET` 但 caller URL 来源是 TT/IG CDN，**100% silent regression**
- W1 phase 2 scope draft 列了 5 个 fetch 点但**没列每个 fetch 点的 URL host 来源** → 实施时默认所有 URL 都是 Vercel Blob
- phase 2.5 scope draft (`8976a54`) W1 主动承认错判 + 提议加 "URL host 来源 → preset 选择"必填栏
- W3 phase 2.5 verdict (`bb832ee`) approve E 决议
- phase 2.5 实施 (`0030171..312ae63`) 的 sample-verify 实测发现 `tiktokcdn-eu.com` 不在 W3 预测 4 host 内 → 扩 preset 为 5 host，避免新 silent regression

scope-first + URL-source-explicit + pre-commit-sample-verify 三重防御机制完成 freeze。
