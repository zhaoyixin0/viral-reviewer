# Session Logs

每个文件是一次 Claude Code 工作 session 的完整结案（按 save-session skill 格式）。

## 怎么 resume 一个 session

### 在新电脑 / 新 Claude Code 实例中：

**最简单**：跟 Claude 说

> 读 `docs/sessions/2026-04-30-viral-rev1-session.md` 和 `PLAN.md`，我们继续 Phase 1。

**完整恢复**（包括 memory）：参考 `../ONBOARDING.md` Step 5。

### 如果你装了 Claude Code 的 resume-session skill：

```bash
# Mac/Linux
mkdir -p ~/.claude/session-data
cp docs/sessions/2026-04-30-viral-rev1-session.md ~/.claude/session-data/2026-04-30-viral-rev1-session.tmp

# 然后在 Claude Code 里说：
/resume-session
```

## 当前最新 session

- [`2026-04-30-viral-rev1-session.md`](./2026-04-30-viral-rev1-session.md) — viral-reviewer 双轨架构搭建，v1 上线 + v2 阶段 1 上线，Phase 1/2/3/4 待建
