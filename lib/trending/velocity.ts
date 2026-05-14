import type { ViralVideo } from "@/lib/review-engine/types";
import {
  TRENDING_SCHEMA_VERSION,
  type TrendingSnapshot,
  type TrendingVideoWithVelocity,
  type TrendTag,
} from "./types";

/** 周环比变化超过这个比例才算 rising / falling,否则 stable。 */
const TREND_THRESHOLD = 0.05;

function sortedByViews(videos: ViralVideo[]): ViralVideo[] {
  return [...videos].sort((a, b) => b.views - a.views);
}

function classifyTrend(weekOverWeek: number | null, isNew: boolean): TrendTag {
  if (isNew) return "new";
  if (weekOverWeek === null) return "stable"; // 在上周出现过但无法算环比(prevViews=0)
  if (weekOverWeek > TREND_THRESHOLD) return "rising";
  if (weekOverWeek < -TREND_THRESHOLD) return "falling";
  return "stable";
}

/**
 * 对比相邻两周快照,给本周每条视频算 velocity / rank / trend。
 * 纯函数,无副作用 —— 注入 current + previous,返回带 velocity 的新数组。
 *
 * 边界:previous 为 null,或 previous.schemaVersion 与当前版本不一致
 * → 当作"无上周快照" → 本周全部标 NEW(weekOverWeek=null,rank.previous=null)。
 */
export function computeVelocity(
  current: TrendingSnapshot,
  previous: TrendingSnapshot | null,
): TrendingVideoWithVelocity[] {
  const curSorted = sortedByViews(current.videos);

  const usePrevious =
    previous !== null && previous.schemaVersion === TRENDING_SCHEMA_VERSION;

  const prevByIdViews = new Map<string, number>();
  const prevRankById = new Map<string, number>();
  if (usePrevious) {
    const prevSorted = sortedByViews(previous!.videos);
    prevSorted.forEach((v, i) => {
      prevByIdViews.set(v.id, v.views);
      prevRankById.set(v.id, i);
    });
  }

  return curSorted.map((v, currentRank) => {
    const inPrevious = prevByIdViews.has(v.id);
    const prevViews = prevByIdViews.get(v.id);
    const prevRank = prevRankById.has(v.id) ? prevRankById.get(v.id)! : null;

    const weekOverWeek =
      inPrevious && prevViews !== undefined && prevViews > 0
        ? (v.views - prevViews) / prevViews
        : null;

    return {
      ...v,
      velocity: {
        weekOverWeek,
        rank: { current: currentRank, previous: prevRank },
        trend: classifyTrend(weekOverWeek, !inPrevious),
      },
    };
  });
}
