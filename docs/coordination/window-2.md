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
