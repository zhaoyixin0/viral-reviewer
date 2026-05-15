# 窗口 2 → 窗口 3 回执

> 写于 2026-05-14 · 针对 `main` = `52219d1` · 来自窗口 2

## P2.1 完成 ✅ + 一个 HIGH review finding 待协调者裁决

P2.1（`retrieval.ts` snapshot 兜底层）已实施，按 plan 双 commit checkpoint：

- `77e7c7e` feat(p2): add pickSnapshotMatches pure function — checkpoint 1
- `340da2c` feat(p2): insert trending-snapshot fallback layer — checkpoint 2
- `0d2c26c` chore: sync package-lock.json — 见下「附带修复」

验证：全量 161 测试 PASS、`tsc --noEmit` 干净。双 review：spec-compliance **PASS**（逐字对齐 plan，唯一偏离是 WIP-P2.1-RESUME.md 里用户已授权的测试用例 1 同字序改动）；code-quality **WARNING**（详见下）。

### 附带修复 `0d2c26c`（不在 P2.1 plan 内）

P1.14 把 `@vercel/config` 加进 `package.json` 但 `package-lock.json` 没同步它的依赖树，导致 worktree `tsc` 报 `Cannot find module '@vercel/config/v1'`。已 `npm install` 补全并单独 commit。**这不是 P2.1 范围**，是 P1.14 遗留漂移，单提一个 `chore:` 便于审。

### code-quality review 的 HIGH —— 需要协调者/architect 裁决

**H2（plan 设计疏漏，非实现 bug）：`videoSignature` 在 snapshot 路径结构性失效。**
plan Step 9 verbatim 是 `pickFromTopicPool(snapMatches, videoSignature, topK)`，但 `snapMatches = pickSnapshotMatches(current.videos, canonicalTopic, topK)` 已预截断到 ≤ topK，导致 `rankBySignature`/`diversifyByCluster` 必然短路到 `rankByEngagement` —— snapshot 路径永远拿不到 signature 多样化排序。`local`/`cache`/`live` 路径的池子可能 > topK 所以不受影响，snapshot 是唯一一条结构性失效的。
- 影响：低。snapshot 总池 ~20 条，按 topic 过滤后实际很少 > topK=5；snapshot 路径仍返回有效的 engagement 排序样本，属优雅降级不是 break。
- 我**没有**单方面改（修法是给 `pickSnapshotMatches` 传 `topK*N`，引入魔数 + 偏离 architect 两轮 review 过的 plan verbatim，超出窗口 2 权限）。
- 建议协调者裁决：① 接受现状、记为已知降级；或 ② 开 follow-up task 改 plan call site。倾向 ①（与 H1 同类，用户在 WIP-P2.1-RESUME.md 已对 snapshot 层「保持简单、不过度工程」拍过板）。

**H1**：`tokens()` 对连续中文 topic 退化为精确相等匹配，"模糊匹配"对 CJK 名不副实 —— **这条 WIP-P2.1-RESUME.md「关键决策」里用户已拍板**（Step 3 verbatim 保留、不加 CJK 分词，理由：topic 由共享归一化机制产出、与 local 层精确相等一致）。已知取舍，不动。

MEDIUM 项（异常路径无测试、`previous` 未消费、`console.error` 裸 unknown）均为 plan verbatim 范围外或全文件既有惯例，未处理。

### 后续

窗口 2 按 per-task 闭环：已 push `feat/hot-tracking-p0-p2`，监控 `origin/main` 等 merge。merge 后 `git pull origin main --no-rebase` → 读本文件看有无新指令 → 才开 P2.2。
