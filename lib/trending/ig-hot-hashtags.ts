/**
 * IG 趋势的"代理信号"—— 人工维护的当前热门 hashtag 列表。
 *
 * 为什么是代理而非真 Explore:Apify Store 无干净的 IG Explore/trending actor,
 * IG Explore feed 对匿名访问封闭(见 spec H2)。折中:cron 抓这组 hashtag 下的
 * 高播放 reels 当作 IG 趋势代理。看板 UI 上与 TikTok 真趋势区分标注。
 *
 * 维护:每 4-8 周人工 review 一次,换掉过气标签。改动只需编辑这个数组。
 * 最后更新:2026-05-13
 */
export const IG_HOT_HASHTAGS: string[] = [
  "reels",
  "trending",
  "viralreels",
  "explorepage",
  "fyp",
  "transitionreel",
  "grwm",
  "dayinmylife",
];
