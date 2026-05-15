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

# 窗口 2 回报 — 2026-05-15

## P2.4 实施完成（verbatim plan line 3303-3343）

**Commit:** `e588875` — `feat(p2): add PlatformFilter client component`

**实现：** `components/trending/PlatformFilter.tsx`，按 plan line 3303-3343 完整 verbatim 复刻（37 行），包含 `"use client"` directive、`Platform` 联合类型、`OPTIONS` 数组、`PlatformFilter` 组件 + `Platform` 类型导出。

**验证：**
- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 175/175 passed（无回归；plan 明确 "纯 UI client component,无独立单测,交互行为在 P2.7 E2E 覆盖"）

**双 review 结果：**
- **haiku（spec compliance）→ PASS。** byte-level 完全匹配 plan verbatim。
- **sonnet（code quality）→ FAIL。** 标 HIGH a11y finding（见下）。

## 上报：sonnet HIGH a11y finding（aria-pressed 缺失）

**Finding：** `<button>` 充当单选切换器，但没有 `aria-pressed` 属性暴露选中状态。屏幕阅读器只能读出按钮标签，无法感知"当前选中 TikTok / 全部 / Instagram"。WCAG 2.1 §4.1.2 要求交互控件暴露其状态。

**对比 P2.3 XSS 的性质差异：**
- P2.3 XSS：渲染层 `javascript:` URI → RCE 等级 security vuln → 必须 in-PR fix。
- P2.4 aria-pressed：a11y quality 缺失 → 影响视觉障碍用户使用，不是 RCE / security。修复成本极低（每个 button 加 `aria-pressed={value === opt.value}` 一行）。

**plan v4.1 verbatim 不含 aria-pressed**，无法判断是 plan 作者 oversight 还是项目无 WCAG AA 合规要求，所以不单方面改 verbatim 实现。

**给窗口 3 的三个选项（推荐 ①）：**

### ① 最小 in-PR fix —— 加 `aria-pressed`（推荐）

新建 fix commit，**不动 verbatim 函数结构 / className / OPTIONS / 导出签名**，只给 `<button>` 加一个属性：

```tsx
<button
  key={opt.value}
  onClick={() => onChange(opt.value)}
  aria-pressed={value === opt.value}
  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
    value === opt.value
      ? "bg-white/10 text-white"
      : "text-white/50 hover:text-white/80"
  }`}
>
```

P2.7 E2E 验证（plan 既定路径）。不需要新增单测。

### ② 按 plan verbatim 不动，开 follow-up issue

接受 plan v4.1 当前 spec，把 a11y 收口留到独立任务（不在 hot-tracking P0-P2 scope）。

### ③ 改 `role="radiogroup"` / `role="radio"` + `aria-checked`

语义更标准但改动更大（容器要加 `role`、`<button>` → `role="radio"` 行为差异、键盘 arrow-key 导航）。我倾向不上 —— 平台切换三档，aria-pressed 已足够。

**我的倾向：** ①。零风险、一行属性、不偏离 verbatim 主体。

附带 sonnet 还提到 **MEDIUM type="button"**（非 form 上下文 `<button>` 默认 type 在父链有 `<form>` 时会触发 submit，trending dashboard 上下文里目前无 form，但加上更鲁棒）。同样升给 W3 一并定，①+ MEDIUM fix 是否合并到一个 commit 还是分两次。

## P2.5 待开关

按 per-task 工作流，等 W3 在本文件下次更新里裁决 P2.4 a11y finding（及 fix 后 merge 通知）后再启动 P2.5。
