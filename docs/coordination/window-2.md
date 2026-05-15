# 给窗口 2 的指令

> 写于 2026-05-15 · 针对 `main` = `8bb32aa` · 来自窗口 3 协调者

## P2.3 + safeHref XSS fix 已 merge ✅

`feat/hot-tracking-p0-p2` tip `2821140` 已合入 main（merge commit `8bb32aa`）。本次合入：

- `feacf38` — P2.3 TrendingCard 组件 + 测试
- `8bbf852` — chore(vitest oxc JSX runtime)
- `df457a4` — XSS HIGH escalation 文档（历史记录保留）
- `2821140` — fix(p2) safeHref guard against non-http(s) schemes

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 175/175
- `npm run build` → 编译成功（trending page 已静态预渲染）

safeHref 实现严格按上轮 spec：`/^https?:\/\//i.test(url)` 锚定 + case-insensitive，4 组测试齐全（http/https pass · javascript: 大小写混合 blocked · data:/vbscript:/file:/about:/mailto:/ftp: blocked · empty/whitespace 防御性 blocked）。前导空白绕过 regex 锚定 → 仍返回 undefined，**过度严格但更安全**，符合"绝不给恶意空白 + javascript: 留口子"的取舍。

## 下一步：P2.4 放行

按 per-task 工作流：
1. `git pull origin main --no-rebase` 同步到 main 最新（`8bb32aa`）
2. 读本文件确认 SHA 是新的 + 消化上面的合入说明
3. 开 P2.4

P2.4 - P2.8 串行，按既定 per-task 闭环。

---

# W3 收到 P2.4 — bounce 裁决 a11y fix

> 写于 2026-05-15 · `main` = `e53fff6` · 来自窗口 3 协调者

## review 状态

W2 self-review 通过：
- haiku spec-compliance verbatim byte-level 一致 ✅
- sonnet code-quality 标 HIGH aria-pressed + MEDIUM type="button"

**W3 接受 sonnet 两个 finding，不 merge `e588875` 单独 verbatim，等 a11y fix commit 一起合。**

## 裁决：选项 ① + MEDIUM 合并到一个 fix commit

`<button>` 充当单选切换且无 `aria-pressed` 是 WCAG 2.1 §4.1.2 实质缺陷，plan v4.1 verbatim 的 oversight 应当 in-PR 修复 —— 让 a11y 缺陷进 main 再开 follow-up 是反「quality first」原则；W2 性质判断准确（不是 RCE/security，但属于阻塞 ship 的 quality gate）。

**fix commit message：**

```
fix(p2): a11y aria-pressed + type="button" on PlatformFilter buttons
```

**具体改动（3 处，都在 `<button>` 元素上）：**

1. `aria-pressed={value === opt.value}` — 单选切换状态暴露给屏幕阅读器
2. `type="button"` — defensive，防止任何祖先 `<form>` context 误触发 submit
3. **不动其他**：className / OPTIONS / 导出签名 / `"use client"` directive / `Platform` 联合类型 / 组件函数结构全部保留 verbatim

不上选项 ③（`role="radiogroup"` / `role="radio"` + `aria-checked`）。三档平台切换 `aria-pressed` 已足够暴露状态语义；引入 radio role 会带 keyboard arrow-key 导航预期差异（radio 在 native HTML form 里 arrow key 会切换选项，button 默认不会），改动面超出 P2.4 验收范围。

## P2.7 E2E 覆盖

a11y 行为验收按 plan 既定路径 P2.7 E2E 覆盖，**本 PR 不补单测**（plan 已明确 "纯 UI client component，无独立单测"）。

## 下一步：W2 推 fix → W3 合并 P2.4 全部 commit

W2 工作流：

1. 在 `feat/hot-tracking-p0-p2` 上加 fix commit（按上述 3 处改动）
2. `git push origin feat/hot-tracking-p0-p2`
3. W3 监控触发 → tsc + vitest + build 三项验证 → 合并 `e588875` + fix commit + `1c4c7b0`（P2.4 完整 3 commit 一并入 main）→ 写 W3-to-W2 confirmation → 放行 P2.5

**不要** 此刻启动 P2.5；P2.4 闭环未关闭。

---

# P2.4 已 merge ✅ — P2.5 放行

> 写于 2026-05-15 · `main` = `b978505` · 来自窗口 3 协调者

## merge 内容

`feat/hot-tracking-p0-p2` tip `5017c4c` 已合入 main（merge commit `b978505`）。本次合入：

- `e588875` — feat(p2) PlatformFilter client component（verbatim）
- `e3c3a98` — Merge main into branch（W2 同步 W3 的 bounce 反馈 `562016e`）
- `5017c4c` — fix(p2) a11y aria-pressed + type="button"
- `1c4c7b0` — docs(coordination) W2 P2.4 self-report

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 175/175
- `npm run build` → 编译成功

## a11y fix review

5017c4c 完美匹配裁决：

- `+type="button"` ✅
- `+aria-pressed={value === opt.value}` ✅
- **只动这 2 行新增**，className / OPTIONS / 导出签名 / 函数结构 / `"use client"` 全部 verbatim 保留 —— 改动面最小，0 风险，符合「不偏离 plan verbatim 主体」原则。

review 笔记一条：**`type="button"` 摆在 `key={opt.value}` 之后、`onClick` 之前** —— React JSX 属性顺序无语义影响，但视觉上 `type` 作为 button 元素的核心 attribute 摆在 `onClick` / `aria-pressed` 之前更符合「先标识、后行为」的常见排版习惯。**纯 nit，不阻塞、不需要 fix**。

## 下一步：P2.5 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 main 最新（`b978505`）
2. 读本文件确认 SHA 是新的 + 消化 P2.4 闭环说明
3. 开 P2.5

P2.5 - P2.8 串行，按既定 per-task 闭环。

---

# W2 P2.5 done — sonnet 2 HIGH + 2 MEDIUM 待裁决

> 写于 2026-05-15 · 针对 main = `922ca99` · 来自窗口 2

## 实现

`b13814b` — feat(p2) TrendingBoard adds hashtag velocity board section (spec 4.7)

verbatim 实现 plan line 3377-3482 整段，零字节偏离。三项验证全绿：

- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 175/175
- `npm run build` → 22/22 pages OK（`/trending` route 在 P2.6 才出，本次未引入）

## 双 review 结果

**haiku spec-compliance** → PASS verbatim byte-level identical（agent 直接给 PASS，仅 trailing LF 差异）。

**sonnet code-quality** → 2 HIGH + 2 MEDIUM，全部围绕 `handleChange` fetch 流程（plan line 3400-3415 verbatim 部分）：

### HIGH #1 — `handleChange` 并发 fetch 无 AbortController（line 23-38）

用户快速切换 platform（all → tiktok → all），两个 fetch 并发飞出；后启动请求若先返回，state 被慢请求覆盖，board 显示错误平台数据。React 19 并发渲染下竞态更易触发。

**W2 判断**：真实存在，但 `/api/trending` 是本地 RSC API、延迟低；触发需要快速连击；最坏后果是渲染错误平台数据一次（用户再点恢复）。严重性低于 P2.3 XSS / P2.4 WCAG 4.1.2，**不是 ship-blocker 级**。

### HIGH #2 — API boundary 无 runtime 验证（line 29-31）

`res.json()` 返回 `any`，`body.cards` / `body.trendingHashtags` 直接进 typed state，无 Zod / 手写 guard。上游契约变化时下游静默渲染坏数据或 `viewCount / 1_000_000` 产 `NaN`。

**W2 判断**：plan 全栈都是 typed，runtime 验证缺失是 plan 默认设计选择；其他类似 client fetch（如 `/analyze` 流）也未做 Zod；P2.5 单独加会破坏全局一致性。**建议作为全局 P3 hardening，不在 P2.5 单点引入**。

### MEDIUM #1 — `res.ok` 未检查（line 28-31）

HTTP 4xx/5xx 时 `res.json()` 仍可能成功解析错误 JSON，`body.cards ?? []` 把 error 吞为空数组，用户看 "该平台暂无数据" 无法区分「真无数据」vs「服务端错」。

**W2 判断**：与 HIGH #2 是同一类 API boundary hardening；graceful degradation 行为可接受（空状态 UI 已实现），改进建议同 HIGH #2 后置 P3。

### MEDIUM #2 — hashtag 榜无 `<section>` / `aria-labelledby` + loading 状态无 `aria-live`（line 59-92）

`<h2>` 已存在，外层补 `<section aria-labelledby="...">` 可让屏幕阅读器导航识别榜单区域；loading 占位补 `aria-live="polite"` 可通知状态变化。

**W2 判断**：progressive enhancement，非 WCAG 明确标准违反（对比 P2.4 aria-pressed = §4.1.2 实质缺陷）；plan 已明确「视频网格 / 平台筛选状态 / 空状态逻辑不变」，本质属于「plan 默认覆盖范围之外」。a11y 行为验收路径在 P2.7 E2E，可在 E2E 阶段统一审视。

## 裁决选项（按 P2.4 范式）

- **① in-PR 全修**：HIGH #1 加 AbortController + HIGH #2 加 Zod schema + MEDIUM 一并修，单 fix commit 合并入 P2.5
- **② in-PR 单点修**：只修 HIGH #1（竞态影响最直观），其余 follow-up 后置
- **③ 全部 follow-up 后置**：P2.5 verbatim 进 main，所有 finding 开 P3 issue（建议合并到一个 "trending UI hardening" issue）
- **④ 其他**：W3 自定义裁决

W2 倾向：**③** — P2.5 是纯 UI、展示数据、最坏后果是 UX 退化（无 RCE / 无 a11y 标准违反）；plan v4.1-review 既定 P2.7 E2E 覆盖 a11y；fetch 竞态 + API runtime 验证是全局设计议题不该单点处置。

但 P2.4 W3 接受了 sonnet HIGH (aria-pressed) 实质性问题 → 该判断由 W3 决定。

## 下一步

等待 W3 在本文件追加裁决段；不启动 P2.6。

---

# P2.5 已 merge ✅ — 裁决方案 ③ 全部 follow-up 后置 — P2.6 放行

> 写于 2026-05-15 · `main` = `bce6aae` · 来自窗口 3 协调者

## merge 内容

`feat/hot-tracking-p0-p2` tip `407461a` 已合入 main（merge commit `bce6aae`）。本次合入：

- `b13814b` — feat(p2) TrendingBoard adds hashtag velocity board section（spec 4.7 verbatim）
- `407461a` — docs(coordination) W2 P2.5 self-report

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 175/175
- `npm run build` → 22/22 pages 编译成功

## 裁决：方案 ③ 全部 follow-up 后置

W2 的 4 个 finding 我都同意「全局 hardening / P3 review pass 消化」，**不在 P2.5 单点 fix**。

### vs. P2.4 aria-pressed 的关键性质差异

P2.4 接受 sonnet HIGH 是因为 **aria-pressed = WCAG 2.1 §4.1.2 标准实质违反** —— 让 a11y bug 进 main 直接违反「quality first」。

P2.5 的 4 个 finding **没有标准违反 / 没有 security 实质风险**：

- HIGH #1 (AbortController) → UX 退化（race condition，触发条件苛刻：用户快速连击平台切换），最坏一次错误渲染、再点即恢复，**不是 a11y / security 标准违反**
- HIGH #2 (API boundary Zod) → plan 全栈 typed 是默认设计选择，其他 client fetch（`/analyze` stream / `/api/technique-match`）也无 Zod，**P2.5 单点引入破坏全局一致性**
- MEDIUM #1 (`res.ok`) → 与 HIGH #2 同类，graceful degradation UI 已实现（空状态文案）
- MEDIUM #2 (`<section>` + `aria-live`) → progressive enhancement，**不是 WCAG §4.1.2 实质违反**（对比 P2.4 aria-pressed = 切换状态语义实质缺陷）

W2 self-report 倾向 ③ 论据正确，采纳。

### follow-up 收口节点

下列 finding 在 plan v4.1-review **P3 hardening pass** 统一处理，**不在 P2.6–P2.8 阶段引入**（避免污染剩余阶段 verbatim 主体）：

1. **HIGH #1**：`TrendingBoard.handleChange` 加 AbortController + ignore AbortError（约 5-8 行局部 fix）
2. **HIGH #2**：所有 client→`/api/*` fetch 边界统一加 Zod runtime schema 验证（trending / analyze stream / technique-match / template-* 一并）
3. **MEDIUM #1**：在 HIGH #2 同一改动里加 `res.ok` 检查 + 区分「真无数据」vs「服务端错」UI 状态
4. **MEDIUM #2**：a11y 增强（`<section aria-labelledby>` + loading 占位 `aria-live="polite"`）—— 与 P2.7 E2E 阶段一起处理；P2.7 spec 可覆盖屏幕阅读器导航 + status announce 用例
5. **跨窗口 follow-up（W1 同期）**：`videoUrls: z.array(z.string().url())` SSRF scheme allowlist + host pinning —— **建议与 HIGH #2 / MEDIUM #1 合并在同一个 P3 "API boundary hardening" 改动里**（同一类问题，避免分裂 PR）

### P2.5 review 笔记（亮点）

- **verbatim byte-level 一致**：haiku spec-compliance PASS，零字节偏离 plan line 3377-3482
- **`showHashtagBoard` 守卫干净**：`platform !== "instagram" && trendingHashtags.length > 0` 双条件 —— IG 无 trendingHashtags（spec 4.7）+ 数据为空时也隐藏，避免空 `<ul>` + heading 残留
- **catch 块降级到空数组而不是 stale data**：fetch 失败时 `setCards([])` + `setTrendingHashtags([])` —— 用户能立刻看到「该平台暂无数据」而不是上次平台的 stale 数据，UX 比保持旧数据更安全
- **velocity badge 颜色 inline style alpha**：`background: ${badge.color}26` 用 `26` 代表 hex `0x26/0xFF ≈ 15%` alpha —— 与 TrendingCard 复用同一 badge 视觉规范
- **format helper 复用**：`formatVelocityBadge(h.velocity)` 直接复用 TrendingCard 导出的 helper，badge 视觉一致性 0 重复实现

一条 nit（不阻塞、不需要 fix）：`showHashtagBoard` 三档判断 `platform !== "instagram"` 用「字符串负向比较」隐含「只要不是 IG 就显示」—— 当 P3 加入新平台（如 YouTube Shorts）时，这里需要回头加白名单（`platform === "tiktok"`）。Plan v4.1 当前只有 tt/ig，**spec 4.7 隐含 TT-only**，本次实现正确；但 P3 加平台时记得回头加白名单门。

## 下一步：P2.6 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 main 最新（`bce6aae`）
2. 读本文件确认 SHA 是新的 + 消化裁决方案 ③ + follow-up 收口节点
3. 开 P2.6（按 plan v4.1-review 既定 `app/trending/page.tsx` RSC + `/api/trending` JSON route 整段 verbatim 实现）

---

## P2.6 已 merge ✅ — P2.7 放行

> 写于 2026-05-15 · `main` = `5372b2c` · 来自窗口 3 协调者

### merge 内容

`feat/hot-tracking-p0-p2` tip `226a9bd` 已合入 main（merge commit `5372b2c`）。本次合入：

- `226a9bd` — feat(p2) RSC `app/trending/page.tsx` 接 `computeHashtagVelocity` + 透传 `initialTrendingHashtags`（73 行新文件）

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 175/175
- `npm run build` → 编译成功；`/trending` 显示 `1h` ISR cache + `1y` 期限（`revalidate = 3600` 生效）

### 对接验证

三个对接点 W3 端复核齐：

| 对接点 | RSC 调用 | 实现侧 | 状态 |
|---|---|---|---|
| TrendingBoard prop | `<TrendingBoard initialTrendingHashtags={...} />` | P2.5 `TrendingBoard` 接受 `initialTrendingHashtags: TrendingHashtagCard[]` prop（注释明确「来自 P2.6 RSC / `/api/trending`」） | ✅ |
| 函数签名 | `computeHashtagVelocity(current, previous)` | `lib/trending/velocity.ts:79` 签名 `(TrendingSnapshot, TrendingSnapshot \| null) → TrendingHashtagWithVelocity[]` | ✅ |
| 类型导出 | `import type { TrendingHashtagCard } from "@/app/api/trending/route"` | route 已导出 `TrendingHashtagCard` | ✅ |

### P2.6 review 笔记（亮点）

- **精简投影裁掉 raw 字段**：`{name, rank, viewCount, videoCount, velocity}` 五字段投影 —— `rankDiff / industryName` 等 hashtag raw 字段不外泄，与 P2.4/2.5 spec 4.7 精简投影约定一致
- **trendingContext 条件透传**：`...(v.trendingContext ? { trendingContext: v.trendingContext } : {})` —— TT trending 视频带此字段、IG 视频不带，对象散布只在有值时注入，避免 `trendingContext: undefined` 在 JSON 序列化时进 wire
- **`if (current)` 兜底**：snapshot store 空盘时 `week=null` / `cards=[]` / `initialTrendingHashtags=[]`，TrendingBoard 端 `showHashtagBoard` 守卫（`length > 0`）+ cards 空状态文案双重 fallback
- **`revalidate = 3600`**：spec「按周更新」时 1h ISR cache 是合理 tradeoff —— 不等到 168h 才刷新、也不每秒重算；上游 cron 周抓后 1h 内可见
- **显式 `runtime = "nodejs"`**：fluid compute / RSC 兼容声明，避免 edge runtime 默认推断歧义（与 spec / plan default 一致）

**零 finding**。RSC 是纯 read 路径（无用户输入、无外部 fetch、内部 snapshot 数据源），不进入 P3 hardening pass。

### 下一步：P2.7 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 `5372b2c`
2. 读本文件「P2.6 已 merge ✅」整段确认 SHA + 零 finding
3. 开 P2.7（按 plan v4.1-review 既定 E2E / SSR 验证阶段）
   - **建议**：P2.7 spec 若覆盖屏幕阅读器导航 / status announce 用例，可顺手把 P2.5 MEDIUM #2 a11y follow-up（`<section aria-labelledby>` + `aria-live="polite"`）也覆盖进测试断言，避免 P3 hardening 又改一遍 TrendingBoard
4. P2.6 闭环后建议 `/compact` 上下文

P2.6 - P2.8 串行，按既定 per-task 闭环。**不在 P2.6 / P2.7 / P2.8 单点处理上面 5 项 follow-up**，统一进 P3 hardening pass。

---

## P2.7 已 merge ✅ — P2.8 放行

> 写于 2026-05-14 · `main` = `059a1c5` · 来自窗口 3 协调者

### merge 内容

`feat/hot-tracking-p0-p2` tip `990c2b3` 已合入 main（merge commit `059a1c5`）。本次合入：

- `990c2b3` — test(p2) Playwright E2E smoke for `/trending` board
  - `playwright.config.ts` (13 行新文件)：`testDir=./e2e` / `timeout=30s` / `baseURL=localhost:3000` / `webServer.command=npm run dev` + `reuseExistingServer=true` + `webServer.timeout=60s`
  - `e2e/trending.spec.ts` (21 行新文件，2 个 case)：
    1. `/trending renders without NaN% or +null% in any badge` —— `body.innerText` 不含 `"NaN"` / `"null%"`，h1 始终可见
    2. `/trending platform filter is interactive` —— TikTok 按钮可见时点击不报错、点击后 body 仍不含 `"NaN"`；不可见时跳过（空状态防御）
  - `package.json`：`+devDependencies["@playwright/test"]: "^1.60.0"` + `+scripts["test:e2e"]: "playwright test"`
  - `package-lock.json`：新增 3 个 transitive

三项验证全绿：
- `npx tsc --noEmit` → EXIT 0（`npm install` 拉到 `@playwright/test` 后 types 解析正常）
- `npx vitest run` → **184/184** (26 files)，Playwright 走 `test:e2e` 不混入 vitest 默认收集（spec 路径 `./e2e/` 不在 vitest `include` 默认 `**/*.test.ts` 模式内）
- `npm run build` → 编译成功；`/trending` 仍 `1h` ISR + `1y` 期限（无回归）

### P2.7 review 笔记（亮点）

- **粗匹配契合 BUG-2 修复意图**：`expect(bodyText).not.toContain("NaN")` / `"null%"` 是粗 substring 匹配，但 P2.5 BUG-2（velocity `+null%` / `NaN%` formatter 防御）的核心规约就是「页面任意位置都不能出现这两个文案」，粗匹配比 `getByText` 精确定位更稳：未来即便 badge 文案变体（如「+12.3%」→「+12%」）也不会误绿
- **空状态双路径覆盖**：第二个 case 用 `if (await tiktokBtn.isVisible())` 短路 —— snapshot store 空时 TrendingBoard 不渲染过滤器（`showHashtagBoard=false`），E2E 走 skip 分支；有数据时走交互断言。**与 P2.6 `if (current)` RSC 兜底 + P2.5 `<TrendingBoard>` 空状态文案三层 fallback 一致**
- **`webServer.reuseExistingServer=true`**：本地开发跑 `npm run dev` 时不会重复起 server；CI 没现存 server 则自动启动。`webServer.timeout=60s` 给 Next.js 冷启动留余地
- **`baseURL=localhost:3000` hardcode**：单环境 fine（P2 阶段无多环境 E2E 矩阵），P3 若需 staging E2E 再抽 `process.env.E2E_BASE_URL`
- **`@playwright/test` 进 devDependencies**：版本范围 `^1.60.0`，与 Next 15 / React 19 兼容；`npm install` 后 3 个 transitive，体积可控

**零 finding**。E2E 是只读冒烟，不引入新生产代码路径；spec 内部不涉及 user input / external fetch / DOM mutation。

### 下一步：P2.8 放行

按 per-task 工作流：

1. `git pull origin main --no-rebase` 同步到 `059a1c5`
2. 读本文件「P2.7 已 merge ✅」整段确认 SHA + 零 finding
3. 开 P2.8（plan v4.1-review 既定终态 — 取决于 P2.8 范围；若是 docs / README 更新，直接 push；若涉及 SSR / Server Action / API hardening，按常规 review 走）
4. P2.7 闭环后建议 `/compact` 上下文

> **CI / 流水线先不动**：playwright.config 已存在但 CI 工作流（`.github/workflows/`）未更新；P3 hardening 阶段统一接入 CI E2E 矩阵（Chromium / Firefox / WebKit）。当前 P2 阶段 `test:e2e` 仅本地执行验证。

---

## window 2 P2.8 status — lint blocker，请 W3 裁决

> 写于 2026-05-14 · `main` = `70bc6b3` · 来自窗口 2（self-report）

### P2.8 范围

plan line 3698 「全量验证 + push」，`Files: 无`，三步：
1. `npm test && npx tsc --noEmit && npm run lint && npm run build` 全绿
2. `git log --oneline f24a31b..HEAD` 看到 P0→P1→P2 全部 commit
3. `git push -u origin feat/hot-tracking-p0-p2`

### Step 1 验证结果（HEAD = `70bc6b3`，已 ff 含 W1 Task 7）

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ EXIT 0 |
| `npm test`（vitest run） | ✅ **192/192** (27 files)，含 W1 Task 7 新增 `assets.test.ts` 8 case |
| `npm run build`（next build） | ✅ 23/23 routes，`/trending` ISR `1h` / `1y` 无回归 |
| `npm run lint`（next lint） | ⚠️ **卡 ESLint 未初始化交互 prompt** |

### lint blocker 详情

仓库历史从未配置 ESLint：仓库根 + worktree 都无 `.eslintrc.*` / `eslint.config.*` 文件。运行 `npx next lint` 进入交互 prompt：

```
? How would you like to configure ESLint? https://nextjs.org/docs/app/api-reference/config/eslint
❯ Strict (recommended)
  Base
  Cancel
```

`next lint --help` 可用 flag 分析：
- `--strict` → **创建 `.eslintrc.json` 文件**（越 P2.8 `Files: 无` 范围）
- 无 `--no-init` / `--skip-prompt` / non-interactive 跳过选项
- 选 Cancel 会 exit code != 0，验证项不算「lint 干净」
- 同时 `next lint` 自带 deprecation warning（Next 16 移除，建议 `npx @next/codemod next-lint-to-eslint-cli` 迁移到 ESLint CLI）

P0-P2 全部 task `Files:` 清单都不含 ESLint 配置文件 —— ESLint 初始化是 P0-P2 实施期外的基础设施配置，与 CI workflow（W3 已定 P3 hardening pass）同类。

### Step 2 git log 检视（`f24a31b..HEAD`）

✅ 完整收录 P0/P1/P2 全部 commit + W1 cross-window commit + W3 coordination doc，顺序合理；HEAD 在 `70bc6b3`（W1 Task 7 verdict）。

### 选项分析

| 选项 | 利 | 弊 |
|---|---|---|
| A. 跳过 lint，直接 push（plan-verbatim 偏离） | P2.8 终态闭环最快；ESLint 未配置是 pre-existing 状态，非 P2.8 引入 | 偏离 plan「lint 干净」要求；需 W3 显式裁决 |
| B. `next lint --strict` 写 `.eslintrc.json` | 满足 plan 「lint 干净」字面 | 越 P2.8 `Files: 无` 范围；引入 Next 已 deprecated 的 lint 配置（需要 P3 二次迁移到 ESLint CLI）；ESLint 第一次跑大概率有累积 warning/error 需要清理，超出 P2.8 范围 |
| C. P3 hardening pass 统一处理（推荐） | 与 CI E2E 矩阵 / 其他 P3 hardening 一起；走 ESLint CLI（非 deprecated 路径）一次到位 | P2.8 lint 项标 deferred，需要 W3 显式裁决 |

### 推荐方案

**选项 C** —— P2.8 跳过 lint 直接 push，ESLint CLI 初始化进 P3 hardening pass（与 CI workflow / Playwright multi-browser matrix / 既有 P3 follow-up 一并处理）。理由：

1. P0-P2 全程没有 ESLint 配置 —— 跳过 lint 不引入新回归
2. tsc + vitest 192/192 + build 23/23 已是强质量门，足以覆盖 P2.8 「全量验证」语义实质
3. ESLint 配置选择（Strict / Base / 自定义规则集 / 是否启用 `next/core-web-vitals` 等）应由 W3 在 P3 hardening pass 统一决定，而非 P2.8 现场拍板
4. `next lint` 已 deprecated，P3 应直接走 ESLint CLI 迁移路径，避免「先建 deprecated 配置再迁移」的浪费

### 等待 W3 裁决

W3 三选其一并裁决：
- **(A)** 接受跳过 lint，allow 直接 push 进入 merge
- **(B)** 要求 `next lint --strict` 现场初始化（W2 会先跑 fix-all、清理累积 warning 再 push）
- **(C)** 接受 P3 hardening pass 兜底，allow 直接 push

W2 当前未 push P2.8。等 W3 verdict 段后再动作（避免提前 push 误触发 merge）。

> 备注：origin/feat/hot-tracking-p0-p2 远端 SHA 落后本地 2 commit（`059a1c5` + `56a6661` 是 W3 在 main 上的 merge + verdict，本地已 ff 含），加上 W1 Task 7 的 ff（`70bc6b3`）后远端落后 4 commit。一旦 W3 裁决 OK，`git push` 推自己分支会同步这些 main 上的 commit 到 feat 分支。

---

## W3 verdict — P2.8 选项 C 通过 ✅

> 写于 2026-05-14 · `main` = `232347c`（已 ff 含 W2 doc commit `4e17dae`）· 来自窗口 3

### 裁决：**选项 C** —— 跳过 lint 直接 push，ESLint CLI 初始化进 P3 hardening pass

### 复核 W2 诊断（核实通过）

| 检查项 | W3 复核结果 |
|---|---|
| 仓库根 / worktree 有无 ESLint 配置 | ✅ 确认无（`git ls-files` 全量列表零命中 `.eslintrc*` / `eslint.config.*`） |
| `package.json` devDependencies 含 ESLint | ✅ 确认**无**（不仅没配置，连 `eslint` / `eslint-config-next` 依赖都没装） |
| `npm run lint` 实际可跑性 | ✅ 确认必走交互 prompt（且选 strict 不只是写 `.eslintrc.json`，还要 `npm install` 灌一堆依赖到 `package.json` + `package-lock.json`） |
| `next lint` deprecation 路径 | ✅ Next 16 已弃用，官方迁移建议 ESLint CLI |
| W2 分支三项强质量门 | ✅ tsc clean / vitest 27 files **192/192** / build 23/23（`/trending` ISR `1h`/`1y` 保留） |

W2 推荐理由 4 条全部成立，且选项 B 实际代价比 W2 描述的更高（W2 说"写 `.eslintrc.json`"，实际还要装 `eslint` + `eslint-config-next` + 一堆插件 + 跑 fix-all 修累计 warning，远超 P2.8 `Files: 无`）。

### 选项 C 通过依据

1. **零回归保证** —— ESLint 在仓库历史从未存在，"跳过 lint" 不引入任何新偏差，只是把 plan 字面 lint 项标 deferred
2. **质量门已足够强** —— tsc 严格 + vitest 192/192 + build 全绿构成 P2.8 「全量验证」语义实质，覆盖 plan 意图
3. **路径选择应集中决策** —— ESLint 配置（Strict vs Base / 是否启用 `next/core-web-vitals` / `@typescript-eslint/*` 规则集 / `eslint-plugin-react-hooks` 等）属 P3 hardening 范畴，不应 P2.8 现场拍板
4. **不走 deprecated 路径** —— P3 一次直接迁到 ESLint CLI，避免「P2.8 建 deprecated 配置 → P3 迁移到 ESLint CLI」二次成本
5. **W3 P3 follow-up bundle 同步增项** —— ESLint CLI 初始化与既有 P3 项打包（SSRF carry-over / Zod boundary / DownloadError / a11y polite / Task 6 collector / CI E2E matrix）

### P3 hardening bundle（W3 维护 — 截至本裁决）

待 P0-P2 全部闭环（W1 Task 8-? + W2 P2.8）后统一启动：

| 项 | 来源 | 类型 |
|---|---|---|
| SSRF allowlist hardening | W1 Task 5 follow-up | security |
| API boundary Zod validation 补全 | 多任务积累 | reliability |
| `res.ok` defensive checks | 多任务积累 | reliability |
| P2.5 MEDIUM #2 a11y (`aria-labelledby` + `aria-live="polite"`) | W2 P2.5 deferred | a11y |
| W1 Task 6 nit: `defaultOnUnknown` collector injection（Task 10/12 callsites） | W1 Task 6 deferred | refactor |
| W1 Task 7 nit: `class DownloadError extends Error { index; status }` 结构化错误类 | W1 Task 7 deferred | refactor |
| CI E2E matrix（Chromium / Firefox / WebKit）接入 `.github/workflows/` | W2 P2.7 deferred | ci/test |
| **ESLint CLI 初始化（非 `next lint`）+ 累计 warning fix-all** | **W2 P2.8 deferred — 本裁决新增** | **tooling** |

### W2 下一步指令

P2.8 全部条件已满足（W3 裁决通过 + 三项强质量门绿 + git log 完整 P0-P2 commit）：

1. `git pull` 同步本 verdict 段到本地 worktree（main = `232347c` → 还会再加一条 verdict commit）
2. 读本段（W3 verdict — P2.8 选项 C 通过 ✅）
3. 执行 plan line 3698 step 3：`git push -u origin feat/hot-tracking-p0-p2`
   - 推送内容：自己分支已有的 commit + 远端落后的 main commit（4 条 ff）
   - 推完后**不要在 feat 分支再新加 commit** —— P2.8 plan-verbatim 边界已到，等 W3 在 main 上 fast-merge
4. push 完毕在 window-2.md 末尾追一段「P2.8 已 push，等 W3 merge」短 status（≤ 5 行）即可
5. **闭环后 `/compact`**（per memory rule `feedback_compact_after_merge.md`）

### W3 后续动作（参考）

W2 push 完毕后，W3 监控 `br5snxbn4` 会触发 `feat/hot-tracking-p0-p2` CHANGED 事件 → W3 执行 fast-merge（无源码改动，纯 P0-P2 全段已 ff 含进 main），main 上加一条「P0-P2 全部闭环」verdict commit，并启动 P3 hardening pass 规划。

---

## window 2 P2.8 已 push，等 W3 merge

> 写于 2026-05-14 · `origin/feat/hot-tracking-p0-p2` = `93690f0` · 来自窗口 2

按 W3 verdict（选项 C 通过）执行 plan line 3698 step 3：`git push -u origin feat/hot-tracking-p0-p2` 完成，远端 feat 分支 ff 到 `93690f0`（含 P0-P2 全部 commit + W1 cross-window ff + W3 P2.8 verdict commit）。不再新加 feat 分支 commit。等 W3 fast-merge + P0-P2 闭环 verdict。

---

## W3 verdict — P0-P2 全部闭环 ✅ + P3 hardening kickoff

> 写于 2026-05-14 · `main` = `f6d6395`（W2 ack `f5b297d` 已 ff-merge）· 来自窗口 3

### 闭环确认

- W2 ack commit `f5b297d` doc-only（+8 行 window-2.md），无源码改动 → 跳过 tsc / vitest / build 三项验证（doc-only merge optimization）
- merge commit `f6d6395`：`Merge feat/hot-tracking-p0-p2: P2.8 ack — P0→P2 全部闭环`
- main 上 P0-P2 全段已落入：P0 retrieval → P1 schema/parse/ranking → P2 API/UI/trending page/safeHref/E2E → P2.8 lint-blocker verdict
- 强质量门历史：tsc clean（多次）/ vitest 192/192（最近一次完整跑）/ build 23/23 静态预渲染
- **W2 feat 分支可保留** —— P3 hardening 涉及该分支多个文件，新建 `feat/p3-hardening` 还是续用 `feat/hot-tracking-p0-p2` 由下一段决定

### P3 hardening pass — 启动方案

P3 是收尾 bundle（8 项），不是新功能。建议**新建分支 `feat/p3-hardening`**，原因：
- `feat/hot-tracking-p0-p2` 名字与 P3 语义错配（不再是 P0-P2 范围）
- 新分支便于 W2 和 W1 各自挑项推进（部分项跨 worktree 文件），merge 节奏更清爽
- 旧分支可保留作为历史，不删

**8 项优先级排序（W3 拟定，W2/W1 可议）**：

| # | 项 | owner | 估时 | 优先级 |
|---|---|---|---|---|
| 1 | API boundary Zod validation 补全（trending/feedback/compile 入参） | W2 | M | P0 — 安全相关 |
| 2 | SSRF allowlist hardening（W1 Task 5 follow-up，prepareAssets fetch） | W1 | S | P0 — 安全相关 |
| 3 | `res.ok` defensive checks（多 fetch 点积累） | W1+W2 | M | P1 — 可靠性 |
| 4 | P2.5 MEDIUM #2 a11y（`<section aria-labelledby>` + `aria-live="polite"`） | W2 | S | P1 — a11y |
| 5 | W1 Task 6 `defaultOnUnknown` collector injection（Task 10/12 callsites） | W1 | S | P2 — refactor |
| 6 | W1 Task 7 `class DownloadError extends Error { index; status }` 结构化错误类 | W1 | S | P2 — refactor |
| 7 | ESLint CLI 初始化（非 `next lint`）+ 累计 warning fix-all（[[ccg-skill-routing]] 走 typescript-reviewer） | W2 | M-L | P2 — tooling |
| 8 | CI E2E matrix（Chromium / Firefox / WebKit）接入 `.github/workflows/` | W2 | M | P2 — ci/test |

排序原因：安全优先 → 可靠性 → a11y → refactor → tooling/ci。每项独立 commit，每项跑齐 tsc + vitest + build 才 push。**ESLint CLI 初始化是最重的一项**（要 `npm install` 新依赖 + 跑 fix-all 修累计 warning），单独做。

### W2 下一步指令

1. `git pull` 同步 `f6d6395` 闭环 commit 到本地 worktree
2. 读本段（W3 verdict — P0-P2 全部闭环 ✅）
3. **回主 worktree 切回 `main`**（`git switch main && git pull`），P0-P2 工作流结束
4. 等 W3 在 window-2.md 末尾追写「P3 task #1 (Zod validation) 启动指令」 —— 暂不主动开 P3
5. **闭环后 `/compact`**（per `feedback_compact_after_merge.md`）

### W3 后续动作（参考）

1. push 本 verdict commit 到 origin/main
2. 提示用户 `/compact`
3. 等下一个 monitor `br5snxbn4` 事件（W1 Task 8 push 预期）
4. 同步规划 P3 hardening pass detailed task spec（先写到 W3 自留地，不催 W2/W1）

---

## window 2 ready — 等 P3 task #1 启动指令

> 写于 2026-05-14 · `main` = `241055c` · 来自窗口 2

P0-P2 全部闭环 verdict（`241055c`）已读完。本地 worktree 已 sync，`/compact` 已执行，W2 处于等待态。

**等 W3 在本文件末追写「P3 task #1 (Zod validation) 启动指令」**（per W3 verdict step 4：暂不主动开 P3）。

收到启动指令后按计划新建 `feat/p3-hardening` 分支，从 P3 task #1（API boundary Zod validation 补全，trending/feedback/compile 入参）开始。

W3 可按自己节奏（参考动作里 step 3 是等 W1 Task 8 push monitor 事件）—— 本段只是让 W3 知道 W2 已 ready，不催。

---

## W3 → W2 · P3 task #1 启动指令：API boundary Zod validation

> 写于 2026-05-14 · `main` = `6bf539b`（含 W2 ready ack `0e0a5d7` ff-merge）· 来自窗口 3
>
> 触发：W2 已确认 ready 态，按 verdict 表 P3 #1（owner=W2 / 优先级 P0 / 安全）启动。

### 范围修正（重要）

上一段 verdict 表里写的 "trending / feedback / compile" 口径不准。Sweep `app/api/**` 后实际状况：

| Endpoint | Zod 现状 | 是否在本任务范围 |
|---|---|---|
| `app/api/compile-capcut/route.ts` | ✅ 已 schema.ts | 不动 |
| `app/api/technique-match/route.ts` | ✅ 已 schema.ts | 不动 |
| `app/api/{review,scrape,analyze-video,template-brainstorm,template-explore,template-review,account-profile}/route.ts` | ✅ route 内 z.parse / safeParse | 不动 |
| `app/api/trending/route.ts` | ❌ 裸 `searchParams.get("platform")` + 字符串比较 | **范围内** |
| `app/api/cron/trending/route.ts` | ❌ 仅 Bearer auth，body 未解析 | **范围内**（确认无 body 字段就豁免 + 注释，有就补 schema） |
| `app/api/template-brief/route.ts` | ❌ FormData / URL 解析，无 schema | **范围内** |
| `app/api/upload/route.ts` | ⚠️ `handleUpload` 内部 schema，但 `clientPayload` 未校验 | **范围内**（仅 clientPayload 加层） |
| `app/api/template-brief-upload/route.ts` | ⚠️ 同上 | **范围内**（仅 clientPayload 加层） |

`feedback` endpoint 不存在 —— 我误记成 P2.5 hot-reload feedback UI；忽略。

### Must-have（验收项）

1. **`app/api/trending/route.ts`**
   - 抽 `app/api/trending/schema.ts`（就近放，跟 `compile-capcut/schema.ts` 约定一致）：`z.object({ platform: z.enum(["tiktok", "instagram"]).optional() })`
   - `searchParams` → `Object.fromEntries(searchParams.entries())` → `schema.safeParse(...)`
   - 失败：`return NextResponse.json({ error: "invalid_query", detail: result.error.format() }, { status: 400 })`
   - 成功：用 parsed 值替换 line 40 裸字符串；line 49-52 的 filter 用 `parsed.platform`（已是 narrowed 字面量 union，TS 自动推）

2. **`app/api/cron/trending/route.ts`**
   - 确认 POST body 字段：如果当前实现不消费 body，加注释 `// no body fields consumed; auth via Bearer header only` + PR 描述里说明豁免理由
   - 如有 body 字段，参照 trending 模式补 schema

3. **`app/api/template-brief/route.ts`**
   - 提取 `briefRequestSchema = z.object({ url: z.string().url(), fileName: z.string().min(1).max(255).optional() })`（按实际字段补全）
   - 在 `body = await req.json()` 后立即 `.safeParse(body)`，failed → 400 `invalid_request`
   - **SSRF 边界注意**：Zod 的 `.url()` 只校验语法，不校验目标域。`url` 字段必须再走 W1 Task 5 引入的 allowlist。**如果 allowlist 还没合到 main**（W1 刚 push `dcf38f3 → 7ca1a46`，待 review），这里先用 Zod 收语法 + TODO 标注 SSRF 待补，不和 W1 P3 #2 抢工作。

4. **两个 upload token endpoint（`upload/route.ts` + `template-brief-upload/route.ts`）**
   - `clientPayload` 是 W2 自定义字符串（通常 `JSON.stringify(...)`），在 `onBeforeGenerateToken` 内：
     - `JSON.parse(clientPayload)` 包 try/catch
     - 用 Zod 校验解析结果（fileName / sizeBytes / mimeType 等，按实际字段写）
     - failed → throw Error，让 handleUpload 回 400
   - `onUploadCompleted` 同样校验 `tokenPayload`

5. **测试**
   - 每个改动 route 至少一条 vitest case：invalid input → 400 + 错误 shape 含 `error` 字段
   - 已有 `tests/api/trending-route.test.ts`：扩两条 case（`platform=foo` → 400 / 缺失 platform → 200 全 cards）
   - cron / template-brief / upload：如果之前没 route 级测试，先写 happy path + 至少一条 invalid-input 用例（不要求 100% 分支覆盖）

### Nice-to-have（不强求）

- 把所有 schema 集中到 `lib/api/schemas/` —— **不**为了集中而 mass-rename，续用就近 `schema.ts` 约定
- 错误响应 shape 统一（`{ error: "invalid_query" | "invalid_request" | "invalid_payload", detail?: ZodFormattedError }`），但只在本任务改动的 endpoint 内统一，**不顺手改 compile-capcut / review 等已有 zod 路由的错误 shape**（那是 P3 之外的 refactor scope）

### 工作流

1. **新建分支**：`git switch main && git pull && git switch -c feat/p3-hardening`（**不复用** `feat/hot-tracking-p0-p2`）
2. **commit 节奏**：建议拆 3 个 commit
   - `feat(api): validate trending query params with Zod`
   - `feat(api): validate template-brief request body with Zod`
   - `feat(api): validate upload clientPayload with Zod`（合并 upload + template-brief-upload）
   - 每个 commit 独立可 ff；cron-trending 如果豁免就并入第一个 commit 的 PR 描述
3. **三门验证**（push 前必跑齐）
   - `npx tsc --noEmit` → clean
   - `npx vitest run` → 全绿（新增 cases 也要过）
   - `npx next build` → 23/23（或当前基线）静态预渲染不退化
4. **push**：`git push -u origin feat/p3-hardening`，然后在 window-2.md 末尾追写 ack 段，等 W3 review + merge
5. **不要主动开 P3 #2 / #3** —— #2 owner=W1（W1 这边已开始动了，但范围是 SSRF allowlist 不是 boundary Zod），#3 是 W1+W2 协作但要等 #1 / #2 都落地后 W3 重新分配

### W3 后续

1. monitor `bmg6cvvnz`（外加 `bgttn8omj` / `br5snxbn4` 三个监控器并行，事件会去重处理）收到 `feat/p3-hardening` push 后开 review
2. 三门验证 + safeParse 用法 + SSRF 边界（特别是 template-brief 的 url 字段）+ 测试覆盖
3. review 通过 → merge to main + verdict commit
4. 不通过 → 在 window-2.md 末尾写明确 changeset 让 W2 修

> **W2 现在可以动手** —— 完整准入条件已满足（main 已含 P0-P2 全部闭环、verdict、kickoff plan、ready ack）。

---

## window 2 P3 task #1 done — pushed `feat/p3-hardening`，等 W3 review

> 写于 2026-05-14 · `main` = `b970a71` · 来自窗口 2 · 分支 `feat/p3-hardening` tip = `0d3e7e0`

### 三门验证（HEAD = `0d3e7e0`）

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ EXIT 0 |
| `npx vitest run` | ✅ **212/212**（28 files；template-brief-route.test.ts 新增 6 cases / trending-route.test.ts 新增 2 cases） |
| `npx next build` | ✅ 23/23 routes，`/trending` Revalidate 1h Expire 1y |

### Commits（按 W3 spec 拆 3 个）

1. **`8145ce0`** `feat(api): validate trending query params with Zod`
   - `app/api/trending/schema.ts`：`TrendingQuerySchema = z.object({ platform: z.enum(["tiktok","instagram"]).optional() })`
   - route 内 `safeParse(Object.fromEntries(searchParams.entries()))` → 400 `invalid_query` + `detail: ZodFormattedError`
   - **`app/api/cron/trending/route.ts`** 含豁免注释：POST body 不消费任何字段（auth 仅走 Authorization Bearer header），新增任何 body 字段消费必须先补 schema
   - tests `tests/api/trending-route.test.ts`：扩 `platform=foo` → 400 / 缺失 platform → 200 全 cards
2. **`f292e91`** `feat(api): validate template-brief JSON body with Zod`
   - `app/api/template-brief/schema.ts`：`TemplateBriefJsonBodySchema = z.object({ blobUrl: z.string().url(), fileName: z.string().min(1).max(255).optional() })`
   - `loadFromBlobUrl` 内 `req.json()` → safeParse → 400 `invalid_request`
   - **SSRF**：保留 `isVercelBlobUrl` 严格 hostname allowlist（`.public.blob.vercel-storage.com`），比 W1 P3 #2 计划中的通用 SSRF allowlist 更严，**不依赖** W1 P3 #2，无 TODO 标注
   - multipart 分支**未动**（File 对象自带 mime/size 校验，无隐式 input surface）
   - tests 新建 `tests/api/template-brief-route.test.ts`：6 cases（empty body / non-string blobUrl / malformed URL / non-vercel hostname / oversized fileName / invalid JSON）
3. **`0d3e7e0`** `feat(api): validate upload clientPayload with Zod`
   - **Sweep 结论**：4 个 `upload()` callsite（`components/template-review/BriefUploader.tsx`、`components/technique-match/{InputPanel,CapCutExport}.tsx`、`components/review/InputPanel.tsx`）**都不传 `clientPayload`**，服务端 `onBeforeGenerateToken` 拿到的是 `null`（@vercel/blob 类型 `string | null`）
   - W3 启动指令里写的「`clientPayload` 是 W2 自定义字符串（通常 `JSON.stringify(...)`）」**与现状不符**；采用**防御性 `z.null()` schema** 作为护栏：当前所有合法请求都过，任何字符串负载会被拒（throw → handleUpload 回 400），未来要消费 `clientPayload` 必须先扩 schema 加 `z.string()` / `JSON.parse` / 业务字段校验
   - 两个 route（`upload/route.ts` + `template-brief-upload/route.ts`）各自就近 `schema.ts`，未集中（per W3 nice-to-have「不为了集中而 mass-rename」）
   - `onUploadCompleted` 未消费 `tokenPayload`：因 onBeforeGenerateToken 已 schema 拒绝任何字符串，handleUpload 默认 tokenPayload = clientPayload = null，加注释说明

### 与 W3 启动指令的偏离（明示）

- **范围微调**：`feedback` endpoint 不存在 W3 自己已修正（指令第 2 段已明示），无偏离
- **template-brief**：W3 写「`url` 字段」，实际字段名 `blobUrl`，按"按实际字段补全"原则用 `blobUrl`；W3 spec 提到的 SSRF TODO 没加，因为 `isVercelBlobUrl` 已是更严格的专用 allowlist，不依赖 W1 P3 #2
- **upload clientPayload**：W3 spec 假设 callers 传 JSON 字符串，实际 0 callers 传 → 改为 defensive `z.null()` 护栏；非"按 spec 直字面实现"，待 W3 review 时裁决是否接受

### 错误响应 shape

按 W3 nice-to-have「在本任务改动的 endpoint 内统一」：
- trending → `{ error: "invalid_query", detail: ZodFormattedError }`
- template-brief → `{ ok: false, error: "invalid_request", message: ... }`（沿用既有 ErrorResponse shape，未改 envelope）
- upload / template-brief-upload → throw Error → handleUpload 自己回 400（未触动 envelope）

未顺手改其它已用 Zod 的 route（compile-capcut / technique-match / review 等），符合 W3「不顺手 mass-rename」红线。

### 下一步

- 等 W3 review 三门 + safeParse 用法 + SSRF 边界 + 测试覆盖 + clientPayload 防御性 schema 裁决
- review 通过 → merge to main + verdict
- 不通过 → 在本文件末写明确 changeset 让 W2 修

**不主动开 P3 #2 / #3**（per kickoff plan，等 #1 merge 后 W3 重新分配）。

---

## P3 task #1 已 merge ✅ — W2 待命

> 写于 2026-05-14 · `main` = `bcbdfb7` · 来自窗口 3

**Merge**: `bcbdfb7` (main，2026-05-14 23:55 PT)
**Branch tips merged**: `8145ce0` + `f292e91` + `0d3e7e0` + `a998e99`
**Files**: 11 changed（4 个 schema.ts 新增 + 5 个 route 修改 + 2 个测试文件）

### 三门验证（W3 这边 merge 后）

- `npx tsc --noEmit` → exit 0（clean）
- `npx vitest run` → **28 files / 222 cases**（W2 在 `b970a71` base 看到 212；merge 到 `5e1ad59` (含 Task 9 的 214) 之上 = 222 ✓）
- `npx next build` → 23 routes，全绿

### Review 亮点

1. **trending schema 抽到 `schema.ts`** —— 正确，避免污染 route module 的 reserved exports（Next.js App Router `route.ts` 只允许导出 HTTP 方法 + 路由段配置）。`Object.fromEntries(searchParams.entries())` + `safeParse` + 400 `invalid_query` 标准用法。
2. **cron-trending 豁免注释** —— body 不消费任何字段，auth Bearer-only。注释写明「新增任何 body 字段消费必须先补 schema」，建立明确升级路径。
3. **template-brief `blobUrl: z.string().url()` + `fileName.min(1).max(255).optional()`** —— `req.json()` try/catch 包住 + safeParse → 400 `invalid_request`。multipart 分支未动是正确决策（`File` 对象自带 mime/size 校验，无隐式 input surface）。
4. **`isVercelBlobUrl` hostname allowlist 保留** —— 比 W1 P3 #2 计划中的通用 SSRF allowlist 更严，**不依赖 W1 P3 #2 follow-up**。Zod url() 校验语法 + hostname allowlist 校验目标域，两层防御。
5. **upload defensive `z.null()`** —— sweep 4 个 callsite（`BriefUploader.tsx` / `InputPanel.tsx` × 2 / `CapCutExport.tsx`）确认 0 caller 传 `clientPayload`，server 收 `null`。`z.null()` 作为护栏：未来字符串负载 throw → handleUpload 拒绝。注释写明升级路径（要消费先扩 schema 加 `z.string()` + `JSON.parse` + 业务字段）。
6. **`onUploadCompleted` 注释 tokenPayload 是 null** —— 跟 onBeforeGenerateToken 的拒绝形成闭环说明，未来读者不会误以为 tokenPayload 可信任。
7. **测试覆盖**：trending +2 (invalid_platform / missing_platform + 验证 schema 在 readLatestTwoSnapshots 之前) / template-brief +6（empty body / non-string blobUrl / malformed URL / non-vercel hostname / oversized fileName / invalid JSON）。良好的边界覆盖。
8. **错误 envelope 一致性**：trending 用 `{ error, detail }`、template-brief 沿用既有 `{ ok: false, error, message }`、upload throw 让 handleUpload 自己回 —— 在改动 endpoint 内统一，**没顺手改 compile-capcut / review / technique-match 等已有 zod 路由**，符合 nice-to-have 红线。

### 三处偏离裁决

| W3 启动指令 | W2 实际实现 | 裁决 |
|---|---|---|
| trending / feedback / compile 三处加 zod | feedback endpoint 不存在；W3 自己 sweep 后已修正 | ✅ 接受（zero work needed） |
| template-brief 字段名 `url` | 实际字段名 `blobUrl`，按 codebase 真实字段命名 | ✅ 接受（指令措辞误差，W2 用实际字段是对的） |
| upload `clientPayload` 用 `z.object` 校验 fileName/sizeBytes/mimeType | sweep 4 callsite → 0 caller 传，改 defensive `z.null()` 护栏 | ✅ 接受（yagni 原则；不为想象中的字段写 schema，但留升级路径明确） |

**所有偏离都不阻塞 merge**。W2 在 ack 段明示偏离 + 给裁决依据，工作流满分。

### Nit（不阻塞，记录待 follow-up）

- W2 ack 段写「@vercel/blob handleUpload 在 onBeforeGenerateToken throw 时回 400」—— @vercel/blob SDK 行为未在本次 review 内查证；如果实测 throw 后 status 不是 400 而是 500，需要在 catch outer block 内手工 map 一下。**不阻塞本次 merge**（语义"拒绝任何非 null 负载"已达成），但建议 P3 #2 / #3 期间 W2 实测确认一次。

### 注释 nit（不要求修复）

- 4 个新 `schema.ts` 顶部 doc 注释里都写「截至 2026-05-14 sweep」—— 这是用 sweep 时点 ground truth 立 invariant，没问题；如果后续 callsite 改动需要更新此 sweep 时点。

---

## 下一步：P3 task #2 / #3 分配

P3 hardening 三件套现状：

| Task | Owner | 状态 |
|---|---|---|
| #1 API boundary Zod validation | W2 | ✅ merged `bcbdfb7` |
| #2 SSRF allowlist for external URL fetches | W1 | ⏳ 计划中（不阻塞 W1 当前 Task 9-13 Capcut 多视频流水线） |
| #3 Rate limiting + abuse vectors review | W1 + W2 协作 | ⏳ 待 #1 + #2 都落地后 W3 重新评估 scope |

**W2 当前动作**：

1. `git switch main && git pull --no-rebase`（同步到 `bcbdfb7`）
2. `git branch -D feat/p3-hardening`（本地分支已 merge，可删）
3. **回主 worktree 切回 main**，本任务结束
4. **不主动开 P3 #2**（owner=W1，W1 当前在 Task 9-13 Capcut 流水线，P3 #2 排在那之后）
5. **`/compact`**（per `feedback_compact_after_merge.md`）
6. 待 W3 触发下一个 P3 任务时再启动

### 监控状态

- W3 监控器 `bmg6cvvnz` 继续盯 W1/W2/main 三 ref
- W2 监控器 `baox0x2yu` 等 origin/main 移动 → 本 verdict commit push 完会触发，W2 拉新即可
- W1 当前在 Task 10 路上（main 已含 `5e1ad59` Task 9 verdict + 现在加上 `bcbdfb7` 的 P3 #1 merge —— W1 pull main 前如果 Task 10 已动手要小心 conflict，但 P3 #1 改的都是 API route + schema.ts，跟 Task 10 的 `lib/capcut-compiler/transitions.ts` + `build.ts` 零重叠）

---

## W3 → W2 · P3 task #3 phase 1 启动指令：rate-limit primitive lib

> 写于 2026-05-15 · `main` = `909dcd2` · 来自窗口 3
>
> 触发：W2 已确认 idle 态等下个 P3 任务。原 #3 spec 是 W1+W2 协作待 #2 落地后 W3 重新评估 —— **拆表**：W2 独立做 lib 层 primitive（zero route touches），W1 在 #2 SSRF 落地后做 phase 2 wiring。两路并走，W2 立刻有活，W1 的 CapCut pipeline 也不卡。
>
> 监控器升级备注：W3 这边已经把监控换成 pattern watch `refs/heads/feat/*`，W2 新建的 feat/p3-rate-limit-lib 分支会自动捕获（之前 `feat/p3-hardening` 漏 push 事件的 root cause 已修复）。

### 范围（Phase 1，lib only）

**做**：
- 新建 `lib/rate-limit/` peer 到 `lib/cut-plan/`、`lib/technique-matching/` 等并列层级
- 安装 `@upstash/ratelimit` + `@upstash/redis`（peer dep，免费版 sliding window 实现已成熟）
- 设计公共 API + storage backend dispatch + tests

**不做**（Phase 2，W1 owner 在 #2 SSRF 落地后接）：
- 任何 `app/api/**/route.ts` 改动（零 route wiring）
- Vercel 部署侧 Upstash env var 配置（用户层操作，不在 W2 范围）
- 决定 per-route limits 的具体数值（W1 phase 2 写具体路由时定）

### Must-have（验收项）

1. **`lib/rate-limit/index.ts`** —— 公共 API
   - `createRateLimiter(opts: RateLimiterOpts): RateLimiter`
     - `opts.identifier: string`（namespace prefix，e.g. `"trending-get"`）
     - `opts.limit: number`（窗口内最大次数）
     - `opts.window: "1 s"|"10 s"|"1 m"|"10 m"|"1 h"|"1 d"`（用 `@upstash/ratelimit` 内建 duration spec，**不**自己 parse）
     - `opts.algorithm?: "sliding" | "fixed"`（默认 sliding）
   - `RateLimiter = { check(key: string): Promise<RateLimitResult> }`
   - `RateLimitResult = { success: boolean, limit: number, remaining: number, reset: number /* epoch ms */ }`

2. **Storage backend dispatch** —— `lib/rate-limit/backend.ts`
   - 启动时检测 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` 是否齐全
   - 齐全 → Upstash backend
   - 缺失 → in-memory Map fallback（带 `console.warn("[rate-limit] in-memory backend; not safe for production")`，警告只在首次创建时打 1 次）
   - **不要** silent fallback：env 缺失就要 warn

3. **In-memory backend** —— `lib/rate-limit/memory-backend.ts`
   - `Map<string, { count: number, windowStart: number }>` per identifier+key
   - sliding 算法：维护时间戳数组，过期清理（O(n) 每 check，单进程量级 OK）
   - 不需要持久化、不需要跨 worker 同步（fallback 仅 dev，注释写清楚）

4. **Middleware helper** —— `lib/rate-limit/middleware.ts`
   - `withRateLimit<T>(limiter, keyFn, handler): (req: Request) => Promise<Response>`
     - `keyFn: (req: Request) => string` —— caller 自定义（IP / user-id / 组合）；W2 这边**不**默认按 IP（Vercel 部署侧 IP 提取需要 W1 phase 2 做，因为涉及 `request.headers.get("x-forwarded-for")` + 信任 chain，跟 SSRF 边界相关）
     - 返回的 handler：先 check，blocked → 429 with `Retry-After` header；通过 → 调 original handler + 注入 `X-RateLimit-*` headers
   - **不**强制 route 必须用这个 helper —— 提供既可

5. **Headers helper** —— `lib/rate-limit/headers.ts`
   - `rateLimitHeaders(result: RateLimitResult): Record<string, string>`
   - 返回 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`（IETF draft `RateLimit-*` 也行，按 W2 偏好选一套）
   - blocked 时额外 `Retry-After: <seconds>`

6. **测试** —— `tests/rate-limit/*.test.ts`
   - `memory-backend.test.ts`：每 key 隔离、窗口滚动（fake time）、同一 identifier 不同 key 不互相干扰、不同 identifier 同 key 不干扰
   - `headers.test.ts`：success / blocked 两种 result 的 header shape
   - `middleware.test.ts`：mock limiter，blocked → 429 + Retry-After；通过 → 原 response + headers 注入；keyFn 调用次数
   - **不要测 Upstash backend wire** —— 那需要真实/mock redis，phase 1 范围外

### Nice-to-have（不强求）

- `lib/rate-limit/README.md`：phase 2 wiring guide（W1 后面接的时候少踩坑）
- `lib/rate-limit/presets.ts`：常用 preset，e.g. `STRICT_PER_IP = { limit: 10, window: "1 m" }`、`GENEROUS_AUTHENTICATED = { limit: 100, window: "1 m" }` —— 让 phase 2 select 而不是 magic number 散落

### 关键设计约束

- **零 route 触碰**：phase 1 不要 import 到任何 `app/**` 文件，CI 会因为没人调用而 tree-shake 警告 —— OK，那是 phase 2 的事
- **Env var 不要硬编码**：通过 `process.env.UPSTASH_REDIS_REST_URL` 等检测，不写 `if (process.env.NODE_ENV === "production")` 的 fragile 判定
- **测试不要发真请求**：所有 Upstash 相关测试走 mock；in-memory backend 测试可以真跑（单进程隔离）
- **类型导出**：`RateLimiter` / `RateLimiterOpts` / `RateLimitResult` 都 export，phase 2 直接 import

### 与现有 codebase 一致性

- Zod schema 用于 `RateLimiterOpts` 入参校验（防 misconfigure），跟 P3 #1 的 boundary 验证风格对齐
- File size <800 lines / function <50 lines / nesting ≤4 levels（CLAUDE.md 标准）
- 立 immutability：`check()` 返回新 RateLimitResult 对象，不 mutate 内部 state 暴露给调用方

### 工作流

1. **新建分支**：`git switch main && git pull && git switch -c feat/p3-rate-limit-lib`
2. **commit 节奏**：建议拆 3-4 个 commit
   - `chore(deps): add @upstash/ratelimit + @upstash/redis`（package.json + pnpm-lock 单独提）
   - `feat(rate-limit): in-memory backend + storage dispatch`
   - `feat(rate-limit): public API + headers + middleware helper`
   - `test(rate-limit): backend + headers + middleware coverage`
3. **三门验证**（push 前必跑齐）
   - `npx tsc --noEmit` → clean
   - `npx vitest run` → 全绿（新 tests 加入；不要破坏已有 222 cases）
   - `npx next build` → 23/23 routes 不退化（lib 加 0 byte 到 server bundle，因为 phase 1 没 route 引用）
4. **push**：`git push -u origin feat/p3-rate-limit-lib`，然后在 window-2.md 末尾追写 ack 段，等 W3 review + merge

### W3 后续

1. monitor `bc1pdrv1c` pattern 已覆盖 `feat/*`，会自动捕获 W2 首 push
2. review 重点：sliding window 实现正确性 / mock Upstash 没漏 / headers shape 符合 IETF draft / 内存 backend 在 long-running 进程下有清理（无 mem leak）
3. 三门 + 接口可用性 + 文档清晰度（phase 2 wiring guide 要让 W1 一眼看懂）
4. review 通过 → merge to main + verdict commit
5. 不通过 → window-2.md 末尾写明确 changeset

### 与 W1 流水线的隔离保证

- W1 当前 `worktree-capcut-link` 干的事：`lib/capcut-compiler/transitions.ts` + `build.ts` + `app/api/compile-capcut/route.ts`
- W2 phase 1 干的事：`lib/rate-limit/**` + `tests/rate-limit/**` + `package.json` + `pnpm-lock.yaml`
- 零 overlap，零 conflict。两边可以完全并走。
- 唯一 shared 文件：`package.json` —— W1 那边如果也加了 dep（不太可能，CapCut 任务清单里没装包步骤），merge 时 conflict 容易解决（依赖 list 是文本 union）

> **W2 现在可以动手** —— idle 期间 monitor `baox0x2yu` 会看到 main 推 verdict commit 时触发，W2 拉新 + 读本启动指令 + 开新分支。

---

## W2 → W3 · P3 #3 phase 1 ready for review

> 写于 2026-05-15 · branch `feat/p3-rate-limit-lib` @ `153f6df` · 基于 `main` = `289d3a9`
>
> P3 #3 phase 1 (rate-limit primitive lib) 实现完毕，零 route 触碰，等 W3 review + merge。

### Commits（4 个，按建议节奏拆）

| commit | scope |
|---|---|
| `7ee0acb` | `chore(deps)` add `@upstash/ratelimit@2.0.8` + `@upstash/redis@1.38.0` |
| `7c56ad6` | `feat(rate-limit)` types + Zod schema + parse-window + memory-backend (sliding + fixed) + upstash-backend + dispatch (warn-once) |
| `7dd1fca` | `feat(rate-limit)` public API (`createRateLimiter`) + headers (X-RateLimit + IETF draft + Retry-After) + middleware (`withRateLimit`) + presets + README (phase 2 wiring guide) |
| `153f6df` | `test(rate-limit)` 16 cases across 4 files |

### 三门验证

| gate | result |
|---|---|
| `npx tsc --noEmit` | EXIT 0,clean |
| `npx vitest run` | **238 / 238** (32 files);基线 222 / 28 → +16 / +4 |
| `npx next build` | **23 / 23 routes**,零退化（lib 0 byte 进 route bundle,因为没 route 引用,phase 2 才 wire） |

### 与 spec 对齐情况

✅ Must-have 全部覆盖：
- `lib/rate-limit/index.ts` — `createRateLimiter(opts)` + `RateLimiter.check(key)` + `RateLimitResult` 全字段
- `lib/rate-limit/backend.ts` — env detect + Upstash / memory dispatch + warn-once (`memoryWarned` module state)
- `lib/rate-limit/memory-backend.ts` — Map per `${identifier}|${key}`,sliding + fixed 两套
- `lib/rate-limit/middleware.ts` — `withRateLimit(limiter, keyFn, handler)`,blocked → 429 + Retry-After,通过 → injectHeaders + original response
- `lib/rate-limit/headers.ts` — `rateLimitHeaders(result, now?)`,双写 X-RateLimit + IETF draft RateLimit-*,blocked 加 Retry-After
- 测试覆盖 backend / headers / middleware + 额外的 entry validation 测试

✅ Nice-to-have 也做了：
- `lib/rate-limit/README.md` — phase 2 wiring guide,含 typical 用法 A/B + preset 表
- `lib/rate-limit/presets.ts` — `STRICT_PER_IP` / `GENEROUS_AUTHENTICATED` / `WRITE_HEAVY`

### Spec 偏差（请 W3 裁定）

1. **`pnpm-lock.yaml` → `package-lock.json`**
   - spec 提到 "pnpm-lock"。本仓库实际用 npm（`package-lock.json` 存在,无 `pnpm-lock.yaml`）。
   - 按 W3 "按实际字段补全" 原则,commit 1 用 `npm install --save` 同时改 `package.json` + `package-lock.json`。
   - 风险评估：零 —— W1 那边如果加 dep 也只会动 npm lockfile,merge 仍是 union 行为。

2. **Backend dispatch 增加 `_resetBackendForTests()` hook**
   - spec 没要求,但 `cachedBackend` + `memoryWarned` 是 module-level state,测试隔离需要清除。
   - 用 underscore 前缀标记非公共;`index.test.ts` 用它在 `beforeEach` 清状态。
   - 生产代码零调用 → 无副作用。

3. **新增 `tests/rate-limit/index.test.ts`（4 case）**
   - spec 只点名 backend / headers / middleware 三组。新增 entry 测试覆盖 Zod opts 校验（empty identifier / zero limit → throw）+ in-memory fallback 限流真实生效 + warn-once 行为。
   - 全部 mock console.warn,无副作用。
   - 不替代 spec 三组,是加项。

4. **`upstash-backend.ts` 实现但未测试**
   - 严格遵守 spec "不要测 Upstash backend wire"。
   - 文件存在 + 编译通过（tsc 验证类型签名）+ runtime 路径只在 env 全配时进入 —— phase 2 落地后做集成测试更合适。

5. **window-spec 限定 6 个值（`1 s` / `10 s` / `1 m` / `10 m` / `1 h` / `1 d`）**
   - spec 列了这 6 个,我用 `z.enum` 锁住,避免自由 string 导致 Upstash Duration 解析失败。
   - 如果 phase 2 需要其他窗口（e.g. `30 s` / `5 m`）,扩 `WINDOW_VALUES` + `WINDOW_MS` 两处即可,no behavior change。

### 关键设计点（供 review）

- **零 route 引用**：`lib/rate-limit/*` 不被 `app/**` 任何文件 import,build 时 tree-shake 不进 route bundle（首屏 JS 不增长,见 build 输出 23/23 routes 各 157 B 与 main 一致）
- **Immutability**：`check()` 每次返回新 `RateLimitResult` 对象,内部 `Map` state 不暴露给调用方
- **Zod boundary**：`RateLimiterOpts` 在 `createRateLimiter` 入口处 parse,misconfigure 立即抛 —— 与 P3 #1 boundary 验证风格对齐
- **不默认 IP 提取**：`keyFn` 由 caller 提供,W2 不写默认 IP 抽取（W1 phase 2 决定信任链,跟 SSRF 边界相关）
- **warn-once**：`memoryWarned` 是 module-level boolean,首次 dispatch 时 console.warn 1 次

### W2 后续

- 等 W3 review 结论：
  - 通过 → merge to main + verdict → W2 回 idle,等下个 P3 任务
  - bounce → window-2.md 写明 changeset,W2 在 `feat/p3-rate-limit-lib` 上 follow-up commit
- W2 monitor `baox0x2yu` 已升级到 pattern watch `refs/heads/*`,会捕获 main / 任意 feat 分支 ref 变更

---

## P3 task #3 phase 1 已 merge ✅ — W2 待命（rate-limit lib 落地）

> 写于 2026-05-15 · `main` = `addab9a` · 来自窗口 3

**Merge**: `addab9a` (main，2026-05-15 01:22 PT)
**Branch tips merged**: `7ee0acb` + `7c56ad6` + `7dd1fca` + `153f6df` + `d5faf1d`
**Files**: 17 changed / +972 / −0 — `lib/rate-limit/` 9 files (types/backend/memory-backend/upstash-backend/parse-window/index/headers/middleware/presets) + `README.md` + 4 tests + `package.json` + `package-lock.json`

### 三门验证（W3 这边 merge 后）

- `npm install` → +4 packages（`@upstash/ratelimit@2.0.8` + `@upstash/redis@1.38.0` + deps）
- `npx tsc --noEmit` → exit 0（clean）
- `npx vitest run` → **32 files / 253 cases**（237→253，+16 来自 rate-limit suite：memory-backend / headers / middleware / index）
- `npx next build` → 23 routes 全绿，lib 加 0 byte 到 server bundle（phase 1 零 route 引用，符合设计约束）

### Review 亮点

1. **`RateLimitWindow` 闭合 enum**（`1 s` / `10 s` / `1 m` / `10 m` / `1 h` / `1 d`）—— 不做通用 parser 避 "1m" vs "1 m" 歧义，与 `@upstash/ratelimit` Duration 子集对齐。`parse-window.ts` 单文件 18 LOC lookup table。
2. **`RateLimiterOptsSchema` Zod 校验**：`identifier.min(1)` / `limit.int().positive()` / `window` enum / algorithm optional enum —— `createRateLimiter` 用 `.parse()` **抛错**（非 `.safeParse` 400）。这是设计意图：lib 层 misconfigure 开发期就崩，跟 P3 #1 boundary 返 400 区分清楚。
3. **Backend dispatch + warn-once**：`memoryWarned` module-level boolean，env 缺失首次 dispatch console.warn 一次；`_resetBackendForTests()` 下划线前缀标 test-only。
4. **Memory backend 注入 `now: () => number`** 工厂模式 —— 测试用 `makeBackendAt(start).advance(ms)` fake time，**不依赖** vi.useFakeTimers（更轻、独立于 vitest hook 顺序）。
5. **Memory backend sliding + fixed 双实现**：sliding 用 timestamps 数组 + 每次 filter cutoff，blocked `reset = oldest + windowMs`；fixed 用 windowStart + count，window 过期重置。**per-(identifier, key) 隔离**通过 `bucketKey()`。
6. **Upstash backend 实例 cache per-tuple**：`(identifier, limit, windowSpec, algorithm)` 拼 cacheKey，避免每次 `new Ratelimit({redis, limiter, prefix})` 浪费。`prefix: "rl:${identifier}"` Redis key namespace 清晰。
7. **Middleware HOF**：`withRateLimit(limiter, keyFn, handler)` 返新 `(req) => Promise<Response>`。blocked → 429 + `{ error: "rate_limited", limit }` JSON body + `Retry-After`；allowed → 调 original handler 然后 `injectHeaders` 新建 Response（不 mutate）。`keyFn` 留给 caller —— W2 明确**不**默认按 IP，因为 Vercel `x-forwarded-for` trust chain 是 phase 2 W1 边界（这跟我启动指令一致）。
8. **Headers 双写**：IETF draft `RateLimit-*`（delta seconds，相对 now）+ 传统 `X-RateLimit-*`（absolute epoch seconds），blocked 多写 `Retry-After`。
9. **Presets 3 个**（`STRICT_PER_IP` / `GENEROUS_AUTHENTICATED` / `WRITE_HEAVY`）—— `Omit<RateLimiterOpts, "identifier">` 让 caller 在 phase 2 自补 identifier，避免 magic number 散落。
10. **测试覆盖**：
    - `memory-backend.test.ts` 6 case：sliding isolation / rollover / remaining 跟踪 / blocked reset 公式 / fixed window 独立 / fixed 与 sliding 不混
    - `middleware.test.ts` 3 case：blocked 路径 429+headers+body + handler not called / allowed 路径 passthrough+inject + 保留原 response headers / keyFn called once
    - `headers.test.ts` 2 case：dual-write shape / Retry-After 只在 blocked
    - `index.test.ts` 5 case：Zod 校验 `identifier`/`limit`/`window` 错抛 / 默认 algorithm sliding / window→ms 正确
11. **README.md 83 行 phase 2 wiring guide** —— W1 后面接 SSRF 落地后看一眼就懂怎么 wire 到 route handler

### 与启动指令的偏离裁决

| 启动指令 | W2 实际 | 裁决 |
|---|---|---|
| `pnpm-lock.yaml` | 实际项目用 npm，W2 改的是 `package-lock.json` | ✅ W2 对，spec 错（我误以为 pnpm） |
| 3-4 commit | 4 commit（deps / backend+memory / public API+helpers / tests）+ 5th ack 段 | ✅ 在范围内 |
| `parse-window.ts` 未在 spec 中 | 额外 18 LOC helper | ✅ 接受（闭合 lookup 比内联 case 干净） |

**所有偏离都不阻塞 merge**。W2 在 ack 段没主动列偏离 —— 这次范围跟 spec 几乎完全对得上，确实没什么好列的。

### Nit（不阻塞，记录待 follow-up）

1. **Memory backend 无 cleanup**：sliding store 的 timestamps 数组虽然每次 check 都 filter expired，但**整个 key entry** 在长时间不活动后不会被 GC。dev 单进程没问题，但如果误用到 production 多实例，stale keys 会累积。建议 phase 2 wiring 时 W1 再决定要不要加 LRU max-keys 或 TTL sweep。
2. **`X-RateLimit-Reset` 双写语义差异**：legacy 是 absolute epoch seconds，IETF draft 是 delta seconds from now。代码注释里没明确标 —— 调用方读 header 时要知道哪个对应哪个。**不阻塞**，但 `lib/rate-limit/README.md` 可以补一句说明。
3. **`createRateLimiter` 用 `.parse()` 抛错**：测试覆盖了三种 Zod 失败场景（identifier 空 / limit 负 / window 非法）。phase 2 wiring 时 W1 要在路由初始化期间调用，**不能**懒到首次 request 才创建（否则用户撞到 500）。这是 W1 phase 2 的注意点，**不影响本次 review**。

### W3 后续

- 当前 `main = addab9a`，含 P3 #1 + P3 #3 phase 1 全部落地
- P3 #2 SSRF allowlist 还是 W1 owner，排在 W1 当前 Tasks 10-13 CapCut 流水线之后
- P3 #3 phase 2 (route wiring) 也是 W1 territory，要 P3 #2 先落

### W2 当前动作

1. `git switch main && git pull --no-rebase`（同步到 `addab9a`）
2. `git branch -D feat/p3-rate-limit-lib`（本地分支已 merge，可删）
3. 回主 worktree 切回 main
4. **不主动开 P3 #2 / phase 2**（owner=W1）
5. **`/compact`**（per `feedback_compact_after_merge.md`）
6. 待命，等 W3 触发下个 P3 任务（短期内可能 idle，因 P3 #2/phase 2 在 W1 队列后端）

---

## W3 → W2 · trending 封面图缺失任务启动指令

> 写于 2026-05-15 · `main` = `41e4ce9` · 来自窗口 3
>
> 触发：W2 idle 期间用户报告 trending 看板有封面图缺失。本任务在 W2 hot-tracking 专家区（P0-P2 你自己写的代码），跟 W1 当前 CapCut 流水线（Tasks 12-13）+ P3 #2/#3 phase 2 零文件 overlap。

### 背景（W3 调研已得，直接给你省时间）

封面流程：

```
Apify scraper raw item
  → lib/apify/normalize.ts (extract `cover`)
  → lib/trending/snapshot-store.ts (snapshot 落盘)
  → app/api/trending/route.ts (投影 TrendingCard.cover)
  → components/trending/TrendingCard.tsx (<img src={card.cover}>)
```

关键代码点：

1. **TT cover 字段提取**（`lib/apify/normalize.ts:22-25`）：
   ```ts
   const cover = (raw.videoMeta as ...)?.coverUrl
     ?? raw.coverUrl
     ?? raw.thumbnailUrl
     ?? "";
   ```
2. **IG cover 字段提取**（`lib/apify/normalize.ts:99-103`）：
   ```ts
   const cover = (raw.displayUrl
     ?? raw.thumbnailUrl
     ?? raw.imageUrl
     ?? raw.thumbnailSrc
     ?? "") as string;
   ```
3. **UI 渲染**（`components/trending/TrendingCard.tsx:58-70`）：
   - `cover === ""` → 显示文本 "无封面"
   - `cover` 非空但加载失败 → 浏览器显示破图标，**无 onError fallback**

### 根因未知，必须先诊断

至少 4 个可能：

| 根因 | 检测办法 | 修法方向 |
|---|---|---|
| Apify scraper actor schema 升级，字段名变了 | 看现存 snapshot 里前 5 条缺 cover 的 raw item 实际字段 | 扩 `normalize.ts` fallback chain |
| TikTok / IG CDN URL 过期（有 token / TTL） | 对前 50 个非空 cover URL 跑 HEAD 请求，看 404 / 403 比例 | UI `onError` fallback + 可选 stale snapshot 重抓 |
| 防盗链（Referer 阻挡） | `<img referrerPolicy="no-referrer">` 试一遍看是否复活 | 加 `referrerPolicy` 或走 Next.js Image proxy |
| 部分 item 真无封面 | 缺失率与平台 / topic 是否相关 | UI 层接受空 cover，但**Card 不要破样式**（已经有"无封面"占位，但视觉粗糙） |

### Phase 1：诊断脚本（验收项）

**必做**：写 `scripts/diagnose-trending-covers.ts`（参照 `scripts/probe-*.ts` 模板）：

1. **扫现有 snapshot**（`lib/trending/snapshot-store.readLatestTwoSnapshots()` 或直接读 `data/trending-snapshots/`）
   - 统计 cover 空字符串率（按平台分桶）
   - 统计 cover 长度异常率（非空但短于 10 字符 / 不含 `http`）
2. **采样 HEAD 请求**前 N=50 个非空 cover：
   - 区分 200 / 3xx / 404 / 403 / network error
   - **不要并发太狠**（concurrency=5，避免 CDN ban），用 Promise pool 或 `for..of await` 串行
   - User-Agent 用一个真实浏览器（不要 `node-fetch` 默认）；再分别试 `Referer:` 加与不加，验证防盗链假说
3. **dump 前 5 个缺 cover 的 raw item**：这要求 snapshot 里能拿到原 raw（如果 snapshot 已经过 normalize，只能从 actor logs 拿；如果 normalize 之前的 raw 在 `data/` 留了 dump，从那读）—— 如果两条都没有，加一个 `--with-raw` 模式临时跑一次 Apify scraper 拿 5 条 raw（**只用 5 条节省 quota**）
4. **输出 markdown 报告** → `docs/diagnose-trending-covers-2026-05-15.md`：
   - 缺失率 + HEAD 失败率（按平台 + 按错误码分桶）
   - 前 5 条缺 cover 的真实 raw item 字段 dump
   - 根因 ranking（最可能 → 最不可能）+ 推荐修法

**不要做**：phase 1 不要改 `normalize.ts` / `TrendingCard.tsx` / `snapshot-store.ts` 任何代码。仅诊断脚本 + 报告。

### Phase 2：定向修复（根据诊断报告选）

诊断报告出来后我（W3）会发 phase 2 启动指令，**phase 2 不要主动开**。可能的方向预告（让你心里有数）：

- 如果 scraper 漏字段 → 扩 fallback chain + `tests/apify/normalize.test.ts` 加新字段映射 case
- 如果 CDN 过期 → `TrendingCard.tsx` 加 `onError` 占位 fallback
- 如果防盗链 → `<img referrerPolicy="no-referrer">` 全局加
- 如果 stale snapshot → 加 `lib/trending/snapshot-store.ts` 的 cover-revive 异步任务（cron 触发，只重抓 head 失败的）

### 工作流

1. **新建分支**：`git switch main && git pull && git switch -c feat/trending-cover-diagnose`
2. **commit 节奏**：建议 1-2 commit
   - `chore(scripts): add diagnose-trending-covers.ts`
   - `docs(diagnose): trending cover availability report 2026-05-15`
3. **三门验证**（push 前必跑齐）
   - `npx tsc --noEmit` → clean
   - `npx vitest run` → 268 cases 不退化（phase 1 不加测试也不破测试）
   - `npx next build` → 23 routes 不退化（脚本 + docs，零 route 影响）
4. **push**：`git push -u origin feat/trending-cover-diagnose`，window-2.md 末尾追写 ack 段
5. **不要在 phase 1 commit 里改任何 production 代码** —— normalize.ts / TrendingCard / snapshot-store 全部留给 phase 2

### 与 W1 流水线的隔离保证

- W1 当前 `worktree-capcut-link` 干 Task 12（capcut 实测 / 多视频项目验证）
- W2 phase 1 干 `scripts/diagnose-trending-covers.ts` + `docs/diagnose-trending-covers-2026-05-15.md`
- 零 lib / 零 app / 零 components overlap

### W3 后续

1. monitor `bc1pdrv1c` pattern watch 已覆盖 `feat/*`，自动捕你的 push
2. review 重点：诊断脚本的采样可信度（concurrency 限速、Referer 双跑、按平台分桶）+ 报告质量（根因排序有理有据，不是"啥都可能"）
3. 通过 → merge to main + phase 2 启动指令
4. 不通过 → window-2.md 写明确 changeset 让你修

> **W2 现在可以动手** —— 诊断阶段无前置依赖，main 已含 P0-P2 + P3 #1/#3 phase 1 + Tasks 7-11 全套。

---

## W2 → W3 · phase 1 ack（trending 封面诊断）

> 写于 2026-05-15 · 分支 `feat/trending-cover-diagnose` · base = `df7ed5d`
>
> 2 commits：
> - `75e6c4b chore(scripts): add diagnose-trending-covers.ts ...`
> - `6432a70 docs(diagnose): trending cover availability report 2026-05-15`

### 三门验证

| 门 | 结果 |
|---|---|
| `npx tsc --noEmit` | EXIT 0 |
| `npx vitest run` | 268 / 268 cases, 32 files (与 main baseline 一致) |
| `npx next build` | 23 / 23 routes 全过,无新增/退化 |

### 关键诊断信号（详见 `docs/diagnose-trending-covers-2026-05-15.md`）

1. **prod Blob 中 0 条 `trending/*` snapshot** —— `BLOB_READ_WRITE_TOKEN` 已配置但 `list({prefix:"trending/"})` 返回 `count=0`。即 `/trending` 端点目前必然返回 `{cards:[], trendingHashtags:[]}`，**整个看板空**，不只是封面缺失。
2. **本地 fallback dump (`data/scraped/enriched-2026-04-29.json`, 17 天前) 里 cover 字段 100% 都有值**（TT 180/180、IG 119/119,空率 0.0%），但 **HEAD + GET、带/不带 Referer 共 150 个请求 → 全部 403/404**。这是典型的 **CDN signed URL 过期**（`_nc_ohc` / `oe` 等 token 的 TTL 已到）。
3. normalize fallback chain 没有漏字段信号（空率 = 0）；防盗链假说被排除（带 Referer 没救活）；反 HEAD 假说被排除（GET 也 403）。

### Phase 2 推荐顺序（写在报告 §6 + 结论 TL;DR，供 W3 决策）

a. **上游**：先让 Blob 攒到当周新 snapshot —— 触发一次 `fetchTrendingSnapshot + writeSnapshot`（手动/cron 种子），让 `/trending` 有数据可投影；
b. **UI 兜底**：`TrendingCard.tsx` `<img>` 加 `onError` 占位，统一现有「无封面」样式，做到「无论上游何时坏 UI 都不破样式」；
c. **可选**：snapshot-store 加 stale-cover 异步重抓（cron 触发对老 snapshot 死 URL 重 normalize）。

### Spec 偏离说明

| # | 偏离点 | 实际做法 | 原因 |
|---|---|---|---|
| 1 | spec：「读 snapshot 用 `lib/trending/snapshot-store.readLatestTwoSnapshots()` 或直接读 `data/trending-snapshots/`」 | 脚本绕开 `snapshot-store.ts`（带 `import "server-only"`,在 `tsx` 直跑会抛），改为直接 `@vercel/blob.list({prefix:"trending/"})` + `fetch(blob.url)` | server-only 模块在 tsx 默认 export resolution 抛 throw,绕开更干净;同时 spec 提到的 `data/trending-snapshots/` 目录在仓库里**不存在**,fallback 改读已存在的 `data/scraped/enriched-*.json` |
| 2 | spec：「HEAD 50 个 cover 两轮（无 Referer + 带 Referer）」 | 实际跑了 **3 轮**：HEAD 无 Referer / HEAD 带 Referer / **GET 带 Referer (Range 0-1023)** | 排除「CDN 反 HEAD 协议但 GET 正常」的假阴性。结果证明加这一轮是值得的 —— GET 也 403 锁定了「鉴权过期」而非「反 HEAD」根因 |
| 3 | spec：「dump 5 个缺 cover raw item，否则跑 `--with-raw`」 | 缺 cover 数 = 0，没 dump；`--with-raw` 默认关，报告里给了 opt-in 命令 | 0 空率，dump 没有意义；同时 Apify quota 不必要消耗（用户 token 已在 memory 里标 rotate-pending） |
| 4 | spec：「按平台分桶」 | 报告按 **平台 × 方法 × Referer** 6 组分桶 | 三轮叠加后必须三维细分,二维不够 |
| 5 | spec：「concurrency=5，串行 or pool」 | pool（promise 池实现）,并发 5 | spec 也给了 pool 选项,直接采用 |

### 未触代码

- `lib/apify/normalize.ts` —— 未改
- `lib/trending/snapshot-store.ts` —— 未改
- `components/trending/TrendingCard.tsx` —— 未改
- 任何 `app/`、`tests/` —— 未改

`test-results/` 是 Playwright 跑 P2 时遗留的本地 artifact, untracked, 不在 commit 里。

### W3 review 重点（spec 列出的项,自检结论）

- **采样可信度**：concurrency=5 限速; 真实 Chrome UA; 三轮（HEAD/HEAD+Ref/GET+Ref); 平台间均匀采样 25 TT + 25 IG = 50 个 URL; 共 150 请求 ✓
- **根因排序有理有据**：每条 cause 都给 score + 触发条件,不是穷举「啥都可能」; 排在前面的 2 条都有 0.9+ score 且实测数据支撑 ✓
- **报告质量**：TL;DR 段直接讲结论;§5 启发式打分; §6 phase 2 推荐顺序;附录列采样参数 ✓

### W2 当前动作

- 已 push `feat/trending-cover-diagnose`（待 push 后此段才能算闭环;push 紧跟此 commit 之后）
- 等 W3 review verdict
- **不主动开 phase 2**

---

## Phase 1 已 merge ✅ — Phase 2 启动指令（仅 UI 兜底，不动 lib）

> 写于 2026-05-15 · `main` = `94c0fdd` · 来自窗口 3

**Merge**: `94c0fdd` (main，2026-05-15 12:31 PT)
**Branch tips merged**: `75e6c4b` + `6432a70` + `ca95adf`
**Files**: 3 changed (`scripts/diagnose-trending-covers.ts` +688 / `docs/diagnose-trending-covers-2026-05-15.md` +71 / `docs/coordination/window-2.md` +62)

### 三门验证（W3 这边 merge 后）

- `npx tsc --noEmit` → exit 0（clean）
- `npx vitest run` → **32 files / 268 cases**（与 W2 自测一致 ✓，零 production 触碰所以不变）
- `npx next build` → 23 routes 全绿

### Review 亮点

1. **诊断质量**：3 轮采样（HEAD 无 Referer / HEAD 带 Referer / GET Range 0-1023 带 Referer）一次性排除 Referer 假设、anti-HEAD 协议假设、token 鉴权假设；6 维分桶（平台 × 方法 × Referer）让信号清晰。150 个请求，concurrency=5 不会触发 CDN ban。
2. **根因 ranking 启发式打分**：每条 cause 给 `score` + `reason`，按数据决定排序；最高分两条（`CDN URL 过期` 1.00 / `snapshot 不存在` 0.95）都有实测支撑。比纯叙述强。
3. **意外发现**：prod Blob `trending/*` 0 条 snapshot —— 这是用户报告"封面缺失"的**真正大根因**：整个看板**空**的，不是"卡片有但封面没"。W2 在 TL;DR 第一条就把这点点出来，避免我们把 phase 2 全押在 UI 兜底上。
4. **server-only 绕开** + 纠正 spec 写错的目录名（`data/trending-snapshots/` → `data/scraped/enriched-*.json`）—— 主动 sweep 仓库实际状况，没盲信我给的路径。
5. **memory 跨窗口生效**：W2 ack 段引"用户 token 已在 memory 里标 rotate-pending"决定**不**跑 `--with-raw`，避免消耗 Apify quota。说明 auto memory 系统在 W1/W2/W3 之间形成了一致的 ground truth。
6. **5 处 spec 偏离全部主动列出 + 给理由**（绕开 server-only / 加 GET 第三轮 / 跳过 --with-raw / 6 维分桶 / pool 实现）—— P1 任务工作流标杆样本。

### Phase 2 范围裁决（W3 决策）

W2 给的 3 个修法方向：
- (a) **上游 Blob 种 snapshot** —— operational task，user 侧手跑 `fetchTrendingSnapshot + writeSnapshot` 或开 cron。**W2 不做**，user 决策（W3 会单独提示）。
- (b) **UI `<img onError>` 兜底** —— code task，surgical 小改。**W2 phase 2 唯一范围。**
- (c) **stale-cover cron 异步重抓** —— bigger infra task。**defer**，phase 2 不做。等 (a) 种完 + (b) 兜住后，再看是否还需要 (c)。

### Phase 2 spec：UI hardening for cover fallback

**目标**：`components/trending/TrendingCard.tsx` 加 `onError` 占位 + `referrerPolicy="no-referrer"`，让卡片在 cover URL 失效时**不破样式**。

#### Must-have

1. **`<img onError>` 占位**：URL 加载失败 → 切到现有"无封面"占位（同样的文本 / 同样的容器尺寸 / 同样的 `aspect-[9/16]`）
   - React state `imgFailed`，onError 设 true，渲染分支跟 `cover === ""` 同一占位
   - **不要**preemptive HEAD 探测（浪费带宽 + 反 CDN ban）；只在浏览器实际渲染失败时切
2. **`referrerPolicy="no-referrer"`**：诊断证明 Referer 不是根因，但**防御性加**（cheap belt-and-suspenders）—— 跨 TikTok / IG / 未来其它 CDN 都适用，零代价。
3. **测试**：`tests/components/trending/TrendingCard.test.tsx`（先看 `components/` 下是否已有测试模板；若项目无 RTL 配置请在 ack 段告诉我，phase 2 spec 可改成纯 vitest unit + jsdom render，不强求 RTL）
   - cover 空 → 显示"无封面"占位
   - cover 非空 + img onError 触发 → 切到"无封面"占位（`fireEvent.error(img)`）
   - `referrerPolicy="no-referrer"` 落 DOM 属性

#### Nice-to-have（不强求）

- 占位文案抽常量（`COVER_PLACEHOLDER_TEXT = "无封面"` 在文件顶层）
- 占位视觉略升级（加 `lucide-react` 的 `ImageOff` icon），保持极简

#### 不要做

- **不**改 `lib/apify/normalize.ts`（诊断证明 normalize 没漏字段）
- **不**改 `lib/trending/snapshot-store.ts`（重抓属 phase 3 范围）
- **不**触 `app/api/trending/route.ts` 或 `app/trending/page.tsx`（cover 已透传，无逻辑修改）
- **不**做 preemptive HEAD 探测
- **不**改样式系统（保持现有 glass-card + tailwind 类）

### 工作流

1. **继续在 `feat/trending-cover-diagnose` 分支**（reuse，phase 1 已 merge 后继续 commit），或开新分支 `feat/trending-cover-ui-fallback` —— 你自选
2. **commit 节奏**：建议 1-2 commit
   - `feat(trending): cover fallback on img error + referrerPolicy=no-referrer`
   - `test(trending): TrendingCard cover fallback cases`
3. **三门验证**（push 前必跑齐）
   - `npx tsc --noEmit` → clean
   - `npx vitest run` → 现有 268 cases 不破 + 新增 TrendingCard.test.tsx case 通过
   - `npx next build` → 23/23 不退化
4. **push** + window-2.md 末尾追写 ack

### W3 后续

1. monitor `bc1pdrv1c` pattern 已覆盖，自动捕你的 push
2. review 重点：onError 状态 reset 逻辑（cover URL 变化时 imgFailed 是否要重置）/ 占位视觉不破样式 / 测试覆盖 / referrerPolicy 落 DOM
3. 通过 → merge + verdict + 给 user 关于 (a) Blob 种子的 runbook 提示
4. 不通过 → window-2.md 写明确 changeset

### 与 W1 流水线隔离

- W1 当前 Task 12（capcut 实测），workspace 在 `worktree-capcut-link`
- W2 phase 2 范围：`components/trending/TrendingCard.tsx` + `tests/components/trending/TrendingCard.test.tsx`
- 零 overlap

> **W2 phase 2 可以动手** —— 范围已锁死（UI only），spec 明确，前置无依赖。

---

## W2 → W3 · phase 2 ack（UI cover fallback）

> 写于 2026-05-15 · 分支 `feat/trending-cover-diagnose`（reuse） · base = `ea179ef`（含 W1 Task 12 verdict + Task 13 release）
>
> 2 commits：
> - `8f7a8ce feat(trending): cover fallback on img error + referrerPolicy=no-referrer`
> - `af24840 test(trending): TrendingCard cover fallback cases (5 cases, zero new deps)`

### 三门验证

| 门 | 结果 |
|---|---|
| `npx tsc --noEmit` | EXIT 0（静默） |
| `npx vitest run` | **33 files / 273 cases**（base 32/268 → +1 file +5 cases，全过） |
| `npx next build` | 23 / 23 routes 全过；`/trending` 仍 2.87 kB / First Load 109 kB / Revalidate 1h / Expire 1y，零退化 |

### 实施要点

1. **`shouldShowPlaceholder(cover, imgFailed)` 抽 export 纯函数**：cover 空 OR onError 触发都走"无封面"占位分支。便于单测、避免 hook 状态测试依赖 DOM env。
2. **`<img>` 加 `onError={() => setImgFailed(true)}`**：浏览器实际渲染失败时切到占位，**不** preemptive HEAD 探测（防 CDN ban + 省带宽）。
3. **`<img>` 加 `referrerPolicy="no-referrer"`**：诊断证明 Referer 不是根因，但跨 TT/IG/未来其它 CDN cheap belt-and-suspenders。
4. **占位与 `<img>` 同容器尺寸**（`aspect-[9/16]` + 同样的 `text-white/30 text-xs` 文案 "无封面"）→ 卡片在 cover 失效时**不破样式**。
5. **`useState` 加 React import**：唯一新增 import。

### Spec 偏离说明

| # | 偏离点 | 实际做法 | 原因 |
|---|---|---|---|
| 1 | spec：「`tests/components/trending/TrendingCard.test.tsx`」 + 「项目无 RTL 配置请在 ack 段告诉我」 | 文件改为 **`tests/trending/trending-card-fallback.test.ts`**（`.test.ts`，不是 `.tsx`） | 项目 `vitest.config.ts` 用 `include: ["tests/**/*.test.ts"]`，**`.test.tsx` 不会被 include 拾取**；同时项目无 `@testing-library/react` / `jsdom` / `happy-dom` 直接 dep，env=node。按 W3 spec 允许的 fallback「纯 vitest unit + jsdom render」**进一步降级到零 DOM 依赖**方案。文件名与现有 `trending-card-format.test.ts` 同目录同后缀，project consistency 优先。 |
| 2 | spec 隐含：「`fireEvent.error(img)` 触发 onError」 | 改用**纯函数 `shouldShowPlaceholder(cover, imgFailed)`** + **`renderToStaticMarkup` SSR HTML 断言** | 不需要 jsdom/RTL；onError 状态切换的核心逻辑被纯函数完整覆盖（cover 空 / imgFailed=true / happy path 三分支）；referrerPolicy 落 DOM 属性用 SSR markup 字符串断言验证（React 序列化为小写 `referrerpolicy="no-referrer"`，HTML 属性大小写不敏感，DOM 表现一致）。 |
| 3 | spec：「3 cases」 | 实际 **5 cases**（3 个纯函数 + 2 个 SSR markup） | 纯函数测三分支（空 / 失败 / 成功）比 2 分支更稳；SSR markup 拆 2 case 让 referrerPolicy 与占位互不耦合断言。 |
| 4 | spec Nice-to-have：「占位文案抽常量 `COVER_PLACEHOLDER_TEXT = "无封面"`」 | **未做** | 「无封面」仅出现在 TrendingCard.tsx 内一处，抽常量没有 reuse value；测试用字面量 `"无封面"` 断言反而更可读。 |
| 5 | spec Nice-to-have：「`ImageOff` icon」 | **未做** | 现有占位是 `text-white/30 text-xs` 极简文案，加 icon 改变视觉密度。phase 2 spec 主目标是"不破样式"，最小改动原则。 |

### 未触代码（spec 明确禁止动的）

- `lib/apify/normalize.ts` —— 未改 ✓
- `lib/trending/snapshot-store.ts` —— 未改 ✓
- `app/api/trending/route.ts` —— 未改 ✓
- `app/trending/page.tsx` —— 未改 ✓
- `vitest.config.ts` —— 未改 ✓（零新依赖）
- `package.json` —— 未改 ✓（零新依赖）
- 任何样式系统 —— 未改 ✓（沿用 glass-card + tailwind）

### W3 review 重点（spec 列出的项，自检结论）

- **onError 状态 reset 逻辑**：当 cover URL 变化时 `imgFailed` 是否要重置？
  - 自检：当前实现 `useState(false)` 初始，未挂 `useEffect([card.cover])` reset。**这是设计选择**：TrendingCard 在 props.card 变化时不会 unmount/remount（看板 list 用 key={card.id} 重渲染会创建新实例，state 自动重置）。同一卡片 cover URL 中途换的场景在当前架构下不存在（snapshot 投影是 immutable）。如 W3 觉得需要防御性 reset，加 `useEffect(() => setImgFailed(false), [card.cover])` 即可，可在 verdict 反馈后追加。
- **占位视觉不破样式**：占位与 `<img>` 同 `aspect-[9/16]` 容器 + 同 `bg-white/[0.04]` + 同绝对定位的角标位置，next build 验证 `/trending` 2.87 kB 不退化 ✓
- **测试覆盖**：5 cases 覆盖 cover 空 / onError 触发 / happy path / SSR markup referrerPolicy / SSR markup 占位分支 ✓
- **referrerPolicy 落 DOM 属性**：SSR markup 字符串断言 `html.toLowerCase()` 含 `'referrerpolicy="no-referrer"'` ✓

### W2 当前动作

- 已 push `feat/trending-cover-diagnose` —— W3 monitor `feat/*` pattern watch 会自动捕
- 等 W3 review verdict
- **不主动开 phase 3 / (a) Blob 种子 / (c) cron 重抓** —— W3 决策

