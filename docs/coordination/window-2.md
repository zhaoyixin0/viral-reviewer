# 窗口 2 → 窗口 3 回执

> 写于 2026-05-15 · 针对 `main` = `374a67a` · 来自窗口 2

## P2.3 完成 ✅ + 一个 HIGH security finding 待协调者裁决

P2.3（`TrendingCard.tsx` + `formatVelocityBadge` 纯函数测试）已实施，按 plan 双 commit：

- `8bbf852` chore: enable React automatic JSX runtime for vitest (oxc transformer) — 见下「附带修复」
- `feacf38` feat(p2): TrendingCard renders trendingContext line for TikTok trending videos

验证：全量 171 测试 PASS（+5）、`tsc --noEmit` 干净。双 review：spec-compliance **PASS**（逐字对齐 plan，无任何偏离）；code-quality **BLOCK**（1 个 HIGH，详见下）。

### 附带修复 `8bbf852`（不在 P2.3 plan 内）

plan Step 1 测试 `import { formatVelocityBadge } from "@/components/trending/TrendingCard"` —— 这是首个 vitest 引用 `.tsx` 文件的测试。vite 8 / vitest 4 在 `tsconfig.jsx: "preserve"`（Next.js 编译需要）下默认不会转 JSX，跑测试时报「parse error … make sure to not set jsx to preserve」。最小修复：vitest.config.ts 加 `oxc: { jsx: { runtime: "automatic" } }`（vite 8 已把 esbuild 标 deprecated，转 oxc transformer）。只影响 vitest，不影响 Next.js prod build。**这不是 P2.3 范围**，是 plan 基础设施层面遗漏，单提一个 `chore:` commit 便于审。

### code-quality review 的 HIGH —— 需要协调者裁决

**HIGH: `<a href={card.url}>` 缺 URL scheme 校验，`javascript:` URI XSS 风险**

plan Step 3 verbatim 写 `<a href={card.url} target="_blank" rel="noopener noreferrer">`。`card.url` 来自 Apify scraped 数据（TikTok / IG 拉取后写 Vercel Blob，没有 scheme 校验），用户点击卡片若 url 是 `javascript:void(...)` 等，React 不阻断、浏览器会执行。这是真 XSS，不是 graceful degradation。

- **影响**：高。生产看板所有 card 受影响（不局限 P2.3，P2.5 `TrendingBoard` 列表也只调本组件）。攻击面是 Apify scraped data 信任链 —— 一旦 Apify 返回恶意 url（或上游被注入），点击即触发。
- **最小 fix**（一行 guard，不引依赖）：
  ```tsx
  function safeHref(url: string): string | undefined {
    return /^https?:\/\//.test(url) ? url : undefined;
  }
  <a href={safeHref(card.url)} ...>
  ```
  外加一条测试 `safeHref("javascript:alert(1)")` → undefined。
- **我没有单方面改**（fix 偏离 plan verbatim，超出窗口 2 权限，逻辑同 P2.1 H2 处理）。
- **建议**（按严重度排序）：
  - **倾向**：① 本 PR 合并前就做 fix —— 把 `safeHref` 加进 TrendingCard.tsx + 一条测试，再做一次 review、push（这是 XSS 不是优化，不适合 follow-up）；
  - 备选 ② 接受 + 立即开 follow-up task 在 P2.4/P2.5 之前补；
  - 不建议 ③ 接受为已知降级（与 P2.1 H2 同类处理 ——XSS 严重度高于 H2 的 ranking 退化，不适用）。

如选 ①，请回复指令，我直接补 fix（最小改动、不偏离 plan 其余部分）。

### 后续

窗口 2 按 per-task 闭环：已 push `feat/hot-tracking-p0-p2`，监控 `origin/main` 等裁决/merge。merge 后 `git pull origin main --no-rebase` → 读本文件看裁决 → 才开 P2.4。
