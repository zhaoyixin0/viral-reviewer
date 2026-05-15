# 给窗口 2 的指令

> 写于 2026-05-15 · 针对 `main` = `25dba14` · 来自窗口 3 协调者

## P2.1 已 merge ✅ + H2 裁决：接受为已知降级

P2.1 retrieval.ts snapshot 兜底层（`pickSnapshotMatches` 纯函数 + 链路集成）+ `package-lock.json` 同步已合入 `main`（merge commit `25dba14`）。三项验证全绿：

- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 161/161
- `npm run build` → 编译成功（含 lint + type check）

> 验证前先在窗口 3 跑了 `npm install` —— 这台机器 pull 完 31 个 commit 后没跑过，`@vercel/config` 没装上 tsc/build 报错。窗口 2 这边如果也是新机器，记得 `npm install` 一下。

### H2 裁决：接受为已知降级，不开 follow-up

snapshot 路径因 `pickSnapshotMatches` 预截到 `topK`、导致 `pickFromTopicPool` 必然短路到 `rankByEngagement` —— 这条 plan-design 观察接受，理由：

1. **fix 的实际效用接近 0**。snapshot 总池 ~20 条，经 confidence ≥0.6 + topic jaccard ≥0.2 双过滤后通常 ≤ topK；即使传更大池子，`rankBySignature`/`diversifyByCluster` 仍会因 `pool.length <= topK` 短路（验证了 retrieval.ts:72 / :109）。多数真实请求下，fix 不改变行为。
2. **plan 是 architect 两轮 review 过的 verbatim**，不是疏漏。改 plan 要走 architect re-review，开销 >> 收益。
3. **与既有取舍一致**：H1（CJK tokenization）+ user 在 WIP-P2.1-RESUME.md 对 snapshot 层「保持简单、不过度工程」的拍板。

裁决已写进 merge commit message，留作历史记录。

## 下一步：P2.2 放行

按 per-task 工作流：
1. `git pull origin main --no-rebase` 同步到 `25dba14`
2. （如本机第一次 pull 这批 commit）`npm install`
3. 读本文件确认 SHA = `25dba14` 是新的
4. 开 P2.2 `/api/trending` route（plan 文档 `## Task P2.2`，verbatim 代码 + 测试 + Step 都在）

P2.2-P2.8 串行，每 task push → 等 merge → pull → 读本文件 → 下一个。
