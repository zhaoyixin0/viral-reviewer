# 给窗口 2 的指令

> 写于 2026-05-15 · 针对 `main` = `35c04db` · 来自窗口 3 协调者

## P2.3 暂不 merge — XSS HIGH 必须先 fix（裁决：你的 ①）

`feat/hot-tracking-p0-p2` tip `df457a4` 暂留 origin、不进 main。原因：

**`<a href={card.url}>` 缺 URL scheme guard，`javascript:` URI XSS 是真的实施缺陷，不适用 graceful degradation 取舍**（与 P2.1 H2 性质不同 —— H2 是排序退化、影响等级噪音，本条是真 security vuln，渲染层一个 `javascript:` URI 就 RCE 等级）。`card.url` 来自 Apify scraped 数据、上游不可信，渲染边界必须自带 scheme guard。

附带的 `8bbf852` chore（vitest oxc JSX runtime）可接受 —— vitest 4 / vite 8 在 `tsconfig.jsx: preserve` 下确实需要这个，最小化、仅影响 test runner、不影响 prod build，透明标 chore 也 OK。

### 请按你的 ①（最小 fix + 一条测试）实施

新建一个 fix commit，**不要 amend `feacf38`、也不要 rebase 历史**，新增即可：

```ts
// components/trending/TrendingCard.tsx 顶部，formatVelocityBadge 之前
/**
 * 防御 javascript:/data: URI 等非 http(s) scheme 走进 <a href>。
 * card.url 来自 Apify scraped 数据,上游不可信 —— 渲染边界必须自带 scheme guard。
 * 非 http(s) → 返回 undefined,React 会 omit href 属性,a 标签退化为不可点击文本。
 */
export function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}
```

```tsx
// 渲染处:
<a
  href={safeHref(card.url)}
  target="_blank"
  rel="noopener noreferrer"
  className="..."
>
```

测试加在 `tests/trending/trending-card-format.test.ts`（已存在），新增一个 describe block：

```ts
import { safeHref } from "@/components/trending/TrendingCard";

describe("safeHref", () => {
  it("returns the url unchanged for http/https schemes", () => {
    expect(safeHref("https://www.tiktok.com/@u/video/123")).toBe("https://www.tiktok.com/@u/video/123");
    expect(safeHref("http://example.com")).toBe("http://example.com");
  });
  it("returns undefined for javascript: URIs", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeUndefined();
  });
  it("returns undefined for data: / file: / vbscript: / about: / mailto: / ftp:", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHref("vbscript:msgbox")).toBeUndefined();
    expect(safeHref("file:///etc/passwd")).toBeUndefined();
    expect(safeHref("about:blank")).toBeUndefined();
    expect(safeHref("mailto:a@b.com")).toBeUndefined();
    expect(safeHref("ftp://example.com")).toBeUndefined();
  });
  it("returns undefined for empty / whitespace url (defensive)", () => {
    expect(safeHref("")).toBeUndefined();
    expect(safeHref("   javascript:alert(1)")).toBeUndefined();
  });
});
```

> 注意第四组：前导空白会绕过 `^https?:` 锚定 —— `^https?:\/\//i.test("  javascript:...")` 也返回 false，所以测试通过。但 React 渲染时若 url 是 `"  https://..."`（带前导空白），`safeHref` 也会返回 undefined。这是过度严格但**更安全**的副作用，可接受。如想保留合法带空白 URL，可改为 `url.trim()` 后再 test —— 你定，但**绝不在 regex 里放 `\s*` 给恶意空白 + javascript: 留口子**。

### 验证 + 推送

完成后跑：
```
npx tsc --noEmit
npx vitest run
npm run build
```

三项全绿 → `git add -A && git commit -m "fix(p2): safeHref guard against non-http(s) schemes in TrendingCard"` → `git push origin feat/hot-tracking-p0-p2`。

push 后**不必再回写本文件**，我收到 monitor 事件会自己 review + merge。届时一并把这条 XSS 修复 + 之前的 `8bbf852` / `feacf38` / `df457a4` 一起合入 main。

### 关于 commit `df457a4`（XSS escalation 文档）

merge 时正常并入即可 —— 它是有效的历史记录（窗口 2 标 HIGH 上报 + 窗口 3 拍板 ①），不需要 revert。

## 不动 P2.4

P2.3 没 merge 进 main 之前先不开 P2.4。等 fix push + merge 通知（本文件下次更新）后再启动。
