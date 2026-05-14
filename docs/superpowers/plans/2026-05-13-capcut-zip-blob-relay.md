# CapCut Zip Blob Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/analyze` 页的 "下载 CapCut 项目 zip" 在任意视频大小下都能稳定下载，绕开 Vercel function 4.5MB response body 限制。

**Architecture:** Server function 生成 zip 后写到 Vercel Blob，返回小 JSON `{url, filename}`。前端拿 URL 后用 `<a download>` 直接从 Blob CDN 下载（CDN 没 size limit）。

**Tech Stack:** Next.js App Router + `@vercel/blob@2.3.3` (已在 deps) + Vercel Serverless function。

**Root cause refresher**：
- Vercel Serverless function response body 上限 4.5MB（Edge 硬限制，跟 Plan 无关）
- 当前 `/api/compile-capcut` 把整个 zip（含 mp4，通常 10-100MB）作为 response body 直接返回
- Edge 截断 → client 看到 `ERR_EMPTY_RESPONSE` 或卡在下载
- 间歇性成功是因为 DEFLATE 压缩 mp4 偶尔正好压到 < 4.5MB

**Out of scope（已知 backlog，本期不做）**：
- 上传到 Blob 的 zip 永久驻留 → 加 cron 清理 30 天前的文件
- 流式生成 zip 边写边传（更复杂，本期不需要）
- 客户端打包 zip（mp4 已在 client，但 BGM 在 Blob，分析数据要从 server 拿，复杂度高）

---

### Task 1: Server 改 — zip 写 Blob 返回 URL

**Files:**
- Modify: `app/api/compile-capcut/route.ts:1-15` (add import) + `:120-129` (replace response block)

- [ ] **Step 1.1: 加 `@vercel/blob` import**

修改 `app/api/compile-capcut/route.ts` 文件顶部 imports（line 1-13），在 `import { NextRequest } from "next/server";` 之后插入一行：

```ts
import { put } from "@vercel/blob";
```

最终 line 1-2 应该是：
```ts
import { NextRequest } from "next/server";
import { put } from "@vercel/blob";
```

- [ ] **Step 1.2: 替换 response block**

定位 `app/api/compile-capcut/route.ts` line 120-129 的现有代码：

```ts
    const safeName = projectName.replace(/[^\w\-\.]+/g, "-");

    return new Response(Buffer.from(zipBytes), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${safeName}.zip"`,
        "cache-control": "no-store",
      },
    });
```

整段替换成：

```ts
    const safeName = projectName.replace(/[^\w\-\.]+/g, "-");

    // 不能把 zip 直接作为 response body 返回 — Vercel function response
    // 上限 4.5MB，含 mp4 的 zip 必然超限。改成写 Blob + 返回 URL 让
    // 客户端直接从 CDN 下载（没 size limit）。
    const blob = await put(
      `capcut-exports/${safeName}-${Date.now()}.zip`,
      Buffer.from(zipBytes),
      {
        access: "public",
        contentType: "application/zip",
        addRandomSuffix: false,
      },
    );

    return Response.json({
      url: blob.url,
      filename: `${safeName}.zip`,
      sizeBytes: zipBytes.byteLength,
    });
```

- [ ] **Step 1.3: 检查 Vercel build 类型**

本地 npm install 还没通 — 跑不了 `tsc --noEmit`。依赖 Vercel build 在 push 后做 typecheck（next build 内嵌 tsc）。

Mental check：
- `put()` 返回 `Promise<PutBlobResult>`，含 `url: string`、`pathname: string`、`contentType: string` 等
- `Response.json(value, init?)` 是 Next.js 标准 API，返回 `application/json` Response
- `zipBytes` 是 `Uint8Array`（JSZip 输出），`Buffer.from(zipBytes)` 转 Buffer 给 put 用

---

### Task 2: 客户端改 — 拿 JSON URL + a[download] 触发下载

**Files:**
- Modify: `components/technique-match/CapCutExport.tsx:87-95` (replace download flow)

- [ ] **Step 2.1: 替换 res.blob() / URL.createObjectURL 流程**

定位 `components/technique-match/CapCutExport.tsx` line 87-95 现有代码：

```tsx
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(projectName.trim() || fallbackName).replace(/[^\w\-\.]+/g, "-")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
```

整段替换为：

```tsx
      // server 把 zip 写 Blob 返回 URL，前端从 CDN 直接下载（绕开 4.5MB function limit）
      const { url, filename } = (await res.json()) as {
        url: string;
        filename: string;
      };
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      // 部分浏览器对 cross-origin URL 忽略 download attribute → 退化到 navigate
      // 加 target=_blank 避免 navigate 走当前 tab
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
```

注意：删了 `URL.createObjectURL` / `URL.revokeObjectURL`（不再有本地 blob 对象需要释放）。

- [ ] **Step 2.2: 验证 error path 兼容**

现有 line 82-85：

```tsx
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message ?? `编译失败 (${res.status})`);
      }
```

这块**不需要改** — 错误路径仍然返回 JSON `{error, message}`，跟 Step 2.1 改后的成功路径一致都是 `res.json()`。

---

### Task 3: Deploy + Production 实测

- [ ] **Step 3.1: Commit + push**

```bash
git add app/api/compile-capcut/route.ts components/technique-match/CapCutExport.tsx
git commit -m "fix(capcut): relay zip via Vercel Blob to bypass 4.5MB function response limit

Server-side: write zip to @vercel/blob put() instead of returning Buffer.
Returns small JSON {url, filename, sizeBytes}.

Client-side: parse JSON, trigger download via <a href=url download=filename>
target=_blank to handle cross-origin attribute quirks across browsers.

Root cause: Vercel Serverless function response body is capped at ~4.5MB
by the Edge layer (independent of plan). zip with embedded mp4 routinely
exceeds this, causing Edge to truncate the body and clients to see
ERR_EMPTY_RESPONSE or stuck downloads. Compression of already-encoded
mp4 (H.264) doesn't help meaningfully.

Blob URLs have no size limit (Blob is CDN-backed direct download).

Out of scope: cron cleanup of accumulated capcut-exports/ zips (backlog)."
git push origin main
```

- [ ] **Step 3.2: 等 Vercel deploy 完成**

```bash
# 拿最新 commit sha
git rev-parse HEAD

# 等 deployment status = success
until [ "$(curl -s https://api.github.com/repos/zhaoyixin0/viral-reviewer/deployments/$(curl -s https://api.github.com/repos/zhaoyixin0/viral-reviewer/deployments?per_page=1 | python -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")/statuses | python -c "import sys,json; print(json.load(sys.stdin)[0]['state'])")" = "success" ]; do sleep 10; done
echo "DEPLOY_READY"
```

或者更简单：等 2-3 分钟看 deployment API 一次。

- [ ] **Step 3.3: 用户实测**

让 user 跑：
1. 打开 https://viral-reviewer.vercel.app/analyze（**新 deploy 后**）
2. 上传同一段视频（之前撞 EMPTY_RESPONSE 的）
3. 等分析完成，点 "下载 CapCut 项目 zip"
4. 预期：弹出**正常浏览器下载**（不是卡住），文件名 `viral-reviewer-<format>-<date>.zip`
5. 重复 3 次 — 必须 **3/3 全成功**（不再间歇性 fail）
6. 同时上传一段**短视频**（< 10s）测一次确认小文件也 work

- [ ] **Step 3.4: vercel logs 二次验证 response size**

```bash
vercel logs --since 10m --no-follow --limit 50 --no-branch --json > /tmp/vlogs-after.json
grep "compile-capcut" /tmp/vlogs-after.json
```

预期：每条 compile-capcut invocation status = 200，**且 client 端不再撞 EMPTY_RESPONSE**。新版 response body 是 JSON `{url, filename, sizeBytes}` < 1KB，根本不会撞 4.5MB limit。

---

### Task 4: Memory + Handover 更新

**Files:**
- Create: `C:/Users/Admin/.claude/projects/C--Users-Admin-Desktop-help-you-viral/memory/feedback_vercel_4_5mb_limit.md`
- Modify: `C:/Users/Admin/.claude/projects/C--Users-Admin-Desktop-help-you-viral/memory/MEMORY.md` (add index entry)
- Modify: `docs/HANDOVER-2026-05-13.md` 或新建 `docs/HANDOVER-2026-05-14.md`

- [ ] **Step 4.1: 创建 feedback memory 记录 4.5MB 决策**

写入 `~/.claude/projects/C--Users-Admin-Desktop-help-you-viral/memory/feedback_vercel_4_5mb_limit.md`：

```markdown
---
name: Vercel function response body 4.5MB 上限
description: 任何 server function 返回大文件必须走 Blob 中转，response body 不能直接塞 mp4/zip
type: feedback
originSessionId: 1bde1864-7990-4c58-a89b-9bd90cc5fe1e
---
Vercel Serverless Function response body 上限约 4.5MB（Edge 硬限制，跟 Plan 无关）。
超过 → Edge 截断 → client 看到 `ERR_EMPTY_RESPONSE` 或卡死下载。
间歇性成功 = 实际 body 在 limit 上下浮动。

**Why:** 2026-05-13 调试 `/analyze` 的 CapCut zip 下载偶发失败，user 3 次重试 2 次 fail 1 次成功。
Vercel logs 显示 server status 都是 200，但 client 接收 body 时被截断。

**How to apply:**
- 任何返回大 binary（mp4 / zip / pdf / image）的 server function → 写 Vercel Blob → 返回 URL
- `@vercel/blob` 的 `put()` 已在 deps，参考 `app/api/compile-capcut/route.ts` 实现
- 客户端拿 URL 后 `<a href download>` 触发 CDN 直接下载，没 size limit
- Form upload 类反向操作走 `@vercel/blob/client` upload + `/api/upload` 签 token（已有）
- 长期：考虑给 capcut-exports/ 加 cron 清理避免 Blob 占用无限增长
```

- [ ] **Step 4.2: 更新 MEMORY.md 索引**

在 `MEMORY.md` 加一行：

```markdown
- [Vercel 4.5MB Response Body Limit](feedback_vercel_4_5mb_limit.md) — 大 binary response 必须走 Blob 中转
```

- [ ] **Step 4.3: 决定是否写新 handover**

如果当前会话还有更多改动要做（剪辑相关 bug 等），可以等会话结束统一写 5/14 handover；如果今天只做这一件事，直接在 5/13 handover 末尾加一行：

```markdown
## 5/13 EOD 补丁

- `ec88b2d` fix(capcut): path 改 materials/<file> 让 CapCut auto-link
- `<新 commit>` fix(capcut): zip 通过 Blob 中转绕过 4.5MB response limit
```

- [ ] **Step 4.4: Commit memory + handover 改动**

```bash
git add docs/HANDOVER-2026-05-13.md  # if modified
git commit -m "docs: handover note for capcut zip Blob relay fix"
git push origin main
```

memory 文件**不进 git**（在 `~/.claude/projects/...` 不在 repo）— 只需写文件即可。

---

## Self-Review

### Spec coverage

| 需求 | 实现 task |
|---|---|
| zip 下载不再撞 4.5MB 限制 | Task 1 (server) + Task 2 (client) |
| 跨视频 size 全工作 | Task 3 (实测 + 短视频对照) |
| 决策记录便于将来 reuse | Task 4 (memory + handover) |

### Placeholder scan

完整代码块都给了实际内容。Task 3 Step 3.3 是"让 user 跑"（必须手动），不是 placeholder 是实际验证。Task 4 Step 4.3 给了"是否写新 handover"的判断逻辑而非 hand-wave "适当处理"。

### Type consistency

- Task 1 返回 `{url, filename, sizeBytes}` — Task 2 解构 `{url, filename}`，未用 sizeBytes 但 schema 兼容
- `put()` 返回类型来自 `@vercel/blob` 包，TS 自带 .d.ts，IDE 会自动提示
- 错误路径仍是 `{error, message}`，未改动

### 已知风险

1. **`a.target = "_blank"` 行为**：部分浏览器把 download attribute 当成 hint，cross-origin URL 时可能在新 tab 打开而不是直接下载。**Mitigation**：URL pathname 含 `.zip` 后缀，主流浏览器（Chrome/Edge/Firefox）会自动识别为下载。如果某 user 撞到"在新 tab 打开"，让他右键 → "另存为"是 fallback。
2. **Blob 文件无 TTL**：每次 export 写一个新 zip，永久驻留。当前 Vercel Blob 免费额度 ~5GB，按 10MB/zip 算 500 次 export。本期不修，列入 backlog。
3. **CSP / CORS**：Blob URL host 是 `*.public.blob.vercel-storage.com`，cross-origin。Next.js 默认无 CSP，user 浏览器不会阻 cross-origin download。
4. **R 方案 v2 (commit `ec88b2d`) 验证**：本 plan 跟 R 方案是独立的两个 fix。本 plan 修下载稳定性，R 方案 v2 修 CapCut 打开后的 link 死锁。两个互不依赖，但 user 测试 R 方案 v2 必须先能稳定下载到 zip（本 plan 解决）。

---

## Execution Handoff

Plan 已保存到 `docs/superpowers/plans/2026-05-13-capcut-zip-blob-relay.md`。

执行方式两选：

1. **Subagent-Driven**（推荐）— 每个 task fresh subagent，task 间 review
2. **Inline Execution** — 当前 session 顺序执行，checkpoint review

我个人倾向 **Inline** — 总工作量小（改两个文件 + commit + push + user 实测），没必要 spawn subagent。但听你的。
