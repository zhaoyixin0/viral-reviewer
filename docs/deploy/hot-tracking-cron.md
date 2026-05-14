# Hot Tracking — Cron 部署验证

**验证日期:** 2026-05-13
**部署套餐:** Hobby(个人账户 `zhaoyixin0`,默认 Hobby tier)

## 现状

⚠️ **viral-reviewer 目前尚未部署到 Vercel** —— `vercel projects ls` 在账户下无任何 project。
Cron 套餐验证 + env var 配置是「首次部署后」才能完成的 deploy-time gate,
当前无法 check;P1.2-P1.14 的代码实现不依赖它,可先做。

## Cron 可用性

- [ ] 套餐支持 cron —— Hobby tier 支持 cron job(上限 2 个),触发频率上限「每天一次」
- [ ] 周度 schedule `0 8 * * 1` 被允许 —— 周度频率低于每天,理论上在 Hobby 限制内,**首次部署后实测确认**

## 降级方案(套餐不支持 cron 时)

用 GitHub Actions cron 每周 POST 到 `/api/cron/trending`,
带 `Authorization: Bearer ${ADMIN_TRIGGER_SECRET}` 头。
workflow 文件:`.github/workflows/trending-cron.yml`(套餐不支持时再建)。

## Env Vars(首次部署 / `vercel link` 后配置)

- [ ] `CRON_SECRET` —— Vercel Cron 自动注入(创建 cron 后确认存在)
- [ ] `ADMIN_TRIGGER_SECRET` —— 需手动配置(production + preview + 本地 .env.local);
      建议值:`openssl rand -hex 32` 的输出
- [ ] `BLOB_READ_WRITE_TOKEN` —— 部署后需在 Vercel 配置(现有 topic-cache 也依赖它)
- [ ] `APIFY_TOKEN` —— 部署后需在 Vercel 配置
- [ ] `ANTHROPIC_API_KEY` —— 部署后需在 Vercel 配置

## 待办(部署时)

1. `vercel link` 关联仓库到 Vercel project
2. `vercel deploy` 首次部署
3. 在 Vercel Dashboard / CLI 配置上述 env vars
4. 确认 cron job 创建成功(`vercel.ts` 的 schedule 生效)
5. 回填本文件的 checkbox
