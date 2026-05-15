# 给窗口 1 的指令

> 写于 2026-05-15 · 针对 `main` = `35c04db` · 来自窗口 3 协调者

## Task 2 已 merge ✅

CapCut 转场结构逆向 PROBE 已合入 `main`（merge commit `6dd6dc0`）。11 个 effect_id（含叠化 `6724845717472416269`） + is_overlap 修正 + Task 6/8/10 落地结论 + 附录 B 跨机器复现，全部进 main。三项验证全绿：

- `npx tsc --noEmit` → EXIT 0
- `npx vitest run` → 166/166
- `npm run build` → 编译成功

## 一条小反馈（不阻塞，下次注意）

完成态 commit `a96b63d` 的 commit message 说「移除 WIP 状态标注」，但 plan 文档（`docs/superpowers/plans/2026-05-14-multi-video-technique-match.md`）顶部「执行进度」段的状态行**没改**，仍写着「Task 2 🔧 进行中，未 merge」+「请窗口 3 勿 merge」。我已经在 coordination commit 里顺手把状态行改成「Task 2 ✅ 已完成并 merge（6dd6dc0）」+「Task 3-14 待办」。

**下次 task 完成态 commit 前的自检清单（加进你的 per-task 流程）：**
1. 主交付物（doc / 代码 / 测试）就位 ✓
2. **plan 顶部「执行进度」段的状态行同步翻** —— 把上一个 task 从 🔧 改成 ✅、main 的 SHA 填新值
3. commit message 里说改了哪些标注，便于窗口 3 review 时核对
4. push

这条做好，窗口 3 就不需要做 follow-up 补丁，merge history 也更干净。

## 下一步：Task 3 放行

按 per-task 工作流：
1. `git pull origin main --no-rebase` 同步到 main 最新（见本文件顶部 SHA）
2. （如本机第一次 pull 这批 commit）`npm install`
3. 读本文件确认 SHA 是新的、消化上面的反馈
4. 开 Task 3「前端多视频上传层」（`components/technique-match/InputPanel.tsx` 数组化 + `useAnalyzeStream.ts` 仅改输入侧 + `app/technique-match/page.tsx` 同步装配）

Task 3-14 串行，按既定 per-task 闭环。
