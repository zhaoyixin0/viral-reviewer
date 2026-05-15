# viral-reviewer · Claude Code 项目约定

## gstack

本项目实际会用到的 gstack skill 子集（直接对接当前痛点）：

| Skill | 用途 |
|---|---|
| `/browse` | **替代** `mcp__claude-in-chrome__*` 跑浏览器烟测（多视频上传 / Gemini 并行 / partial-failure / N-card 渲染等 UI 验证）。**禁用** `mcp__claude-in-chrome__*` 任何工具。 |
| `/canary` | Vercel 部署后 smoke test 关键路由（`/trending` / `/technique-match` / `/template-review`） |
| `/benchmark` | Core Web Vitals baseline + 性能退化检测（`/trending` 有 1h revalidate + 1y expire 缓存策略，值得 baseline） |
| `/cso` | 安全审计一键扫（P3 hardening pass 期间用：Zod boundary / SSRF / rate-limit / OWASP） |
| `/codex` | 第二 LLM 独立 review（assemblyTimeline sanitization、fitScale 数学等复杂 logic 配合 W3 单视角 review） |
| `/investigate` | 排查偶发 bug（之前的 Stage 2 fails loses Stage 1 data 类问题） |
| `/freeze`, `/guard` | 多窗口 git worktree 协作时锁 W3 worktree，防止误编辑 W1/W2 的文件 |

其它 27 个 gstack skill（`/office-hours` / `/plan-ceo-review` / `/design-*` / `/ship` / `/land-and-deploy` / `/setup-gbrain` 等）全局 `~/.claude/CLAUDE.md` 已列，本项目按需手动调用，但日常默认不走（与现有 W3 协调工作流冲突或不适用本项目）。
