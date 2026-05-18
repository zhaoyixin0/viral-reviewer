import type { ViralVideo } from "@/lib/review-engine/types";
import {
  SUPPORTED_SCHEMA_VERSIONS,
  type TrendingHashtag,
  type TrendingHashtagWithVelocity,
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
 * 边界:previous 为 null,或 previous.schemaVersion 不在 SUPPORTED_SCHEMA_VERSIONS
 * 窗口内 → 当作"无上周快照" → 本周全部标 NEW(weekOverWeek=null,rank.previous=null)。
 * L3+ v2 升级时窗口已扩到 [1, 2],v1 旧快照仍能参与对比(spec §3.5)。
 */
export function computeVelocity(
  current: TrendingSnapshot,
  previous: TrendingSnapshot | null,
): TrendingVideoWithVelocity[] {
  const curSorted = sortedByViews(current.videos);

  const usePrevious =
    previous !== null &&
    typeof previous.schemaVersion === "number" &&
    SUPPORTED_SCHEMA_VERSIONS.includes(previous.schemaVersion);

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

/**
 * v4.1:hashtag 级 velocity —— 与 computeVelocity 同构,比较对象换成
 * trendingHashtags,按 name 跨周匹配。趋势 hashtag 榜有跨周连续性,这是 v4
 * 两阶段下真正能做周环比的对象(见 spec 2.8 H2)。输出按当周 rank 升序。
 * 边界:previous 为 null / schemaVersion 不一致 → 全标 new。
 */
export function computeHashtagVelocity(
  current: TrendingSnapshot,
  previous: TrendingSnapshot | null,
): TrendingHashtagWithVelocity[] {
  const curSorted = [...current.trendingHashtags].sort(
    (a, b) => a.rank - b.rank,
  );

  const usePrevious =
    previous !== null &&
    typeof previous.schemaVersion === "number" &&
    SUPPORTED_SCHEMA_VERSIONS.includes(previous.schemaVersion);

  const prevByName = new Map<string, TrendingHashtag>();
  if (usePrevious) {
    for (const h of previous!.trendingHashtags) prevByName.set(h.name, h);
  }

  return curSorted.map((h) => {
    const prev = prevByName.get(h.name);
    const inPrevious = prev !== undefined;
    const weekOverWeek =
      inPrevious && prev!.viewCount > 0
        ? (h.viewCount - prev!.viewCount) / prev!.viewCount
        : null;
    return {
      ...h,
      velocity: {
        weekOverWeek,
        rank: { current: h.rank, previous: inPrevious ? prev!.rank : null },
        trend: classifyTrend(weekOverWeek, !inPrevious),
      },
    };
  });
}
