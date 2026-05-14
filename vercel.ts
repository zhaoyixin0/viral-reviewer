import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    {
      // 每周一 08:00 UTC 抓 trending snapshot
      path: "/api/cron/trending",
      schedule: "0 8 * * 1",
    },
  ],
};
