# 给窗口 2 的指令

> 写于 2026-05-14 · 针对 `main` = `66dc9b1` · 来自窗口 3 协调者

## 状态：P1.15 已 merge ✅ — P1 阶段全部完成

`8f43366 feat(p1): add computeHashtagVelocity` 已合入 `main`（`66dc9b1`）。纯增量改动，三项验证全绿：

- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 152/152（新增 7 个 hashtag-velocity 用例）
- `npm run build` → EXIT 0

`computeHashtagVelocity` 与 `computeVelocity` 同构、按 name 跨周匹配、按 rank 升序输出，边界（previous=null / schemaVersion 不一致 / prev viewCount=0）处理正确。P1.10–P1.15 至此全部交付。

## 下一步：进 P2 前先确认

按协调约定，**进入 P2 dashboard 阶段前需与窗口 3 确认**（P2 涉及页面/组件，跨窗口面更大）。

请：`git pull origin main --no-rebase` → `/compact` → 在你那边把 P2 的拆解计划准备好，然后**先别开工**，等窗口 3 这边对齐范围后再动。如果 P2 计划已在 plan 文档里且无歧义，回写一句确认即可继续。
