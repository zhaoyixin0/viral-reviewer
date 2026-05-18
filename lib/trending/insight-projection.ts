import type {
  TrendingInsight,
  BgmInsight,
  EventInsight,
  HashtagInsight,
  VelocityInsight,
} from "./insight-schema";

/**
 * Board-facing projection of TrendingInsight (L3+ plan §5.4).
 *
 * Trims internal-only fields (sampleVideoIds / hitVideoIds), applies platform
 * filter to hashtagTab (HashtagInsight is TT-sourced — IG mode → empty), and
 * synthesizes per-technique / per-BGM trend tags from velocity.* deltas so the
 * UI does not need to recompute classification.
 *
 * v1 老快照场景 (snapshot.insight === undefined) → 返 null,RSC / route layer
 * 透传 null 给前端,前端只渲 videos tab (T5 降级)。
 *
 * Deliberate duplication: `aggregateTechniqueShares` mirrors `combineDistributions`
 * in lib/trending/aggregate.ts:117 (W4 T2 owned). Importing across ownership
 * boundary 会需要 W4 修改 export — 守 ownership lock 保留 dup + cross-ref。
 * **任一边改公式时必须同步另一边**否则 trendtag (velocity 算) 与 share
 * (projection 算) 会基于不同口径。reviewer HIGH #2 ack,W3 spot review 时
 * 若决定 refactor 可移到共享 util。
 */

/** 必须等于 aggregate.ts:20 `BGM_TOP_LIMIT`,否则 bgmTab 长度跟 aggregate 出口对不齐。 */
const BGM_TAB_LIMIT = 10;
/**
 * Stable→rising/falling threshold for technique WoW share delta.
 * 5pp = aggregate.ts:22 `TREND_THRESHOLD` 的语义对齐:同量级 noise floor。
 */
const TECHNIQUE_TREND_THRESHOLD = 0.05;

export type TechniqueTrend = "rising" | "stable" | "falling" | "new";
export type BgmTrend = "rising" | "stable" | "falling" | "new";
/** EventInsight 只跟踪本周存在 / 上周存在,没有 rising/falling 概念。 */
export type EventTrend = "new" | "stable" | "ended";

export type HashtagTabEntry = {
  name: string;
  videoCount: number;
  techniqueDistribution: Record<string, number>;
  avgDensity: number;
  topVideoIds: string[];
};

export type TechniqueTabEntry = {
  technique: string;
  share: number;
  trend: TechniqueTrend;
};

export type BgmTabEntry = {
  name: string;
  hitCount: number;
  /**
   * Three-valued: `true` = Gemini 标 trending; `false` = Gemini 显式标非 trending;
   * `null` = Gemini 标过非 trending (W4 sentinel); `undefined` = 未标。
   * UI 渲染时若需"是否 trending"角标,应用 `entry.trending === true`,
   * 别用 `if (entry.trending)` 否则会吞掉 false / null 的否定信号。
   */
  trending?: boolean | null;
  trend?: BgmTrend;
};

export type EventTabEntry = {
  name: string;
  displayName: string;
  matchedHashtags: string[];
  matchedVideoCount: number;
};

/**
 * Inline-narrowed velocityTab type. Don't expose raw `VelocityInsight` directly
 * — `eventWoW[].trend` uses `EventTrend` (new|stable|ended) not the bgm/technique
 * trend enum, so transparent passthrough would let consumers accidentally switch
 * on the wrong union.
 */
export type BoardVelocityTab = {
  techniqueWoW: Record<string, number>;
  bgmWoW: Array<{ name: string; trend: BgmTrend; deltaHits: number }>;
  eventWoW: Array<{ name: string; trend: EventTrend }>;
};

export type BoardInsightDTO = {
  hashtagTab: HashtagTabEntry[];
  techniqueTab: TechniqueTabEntry[];
  bgmTab: BgmTabEntry[];
  eventTab: EventTabEntry[];
  velocityTab: BoardVelocityTab;
};

export type BoardPlatform = "tiktok" | "instagram" | "all";

export function projectInsightForBoard(
  insight: TrendingInsight | undefined,
  platform: BoardPlatform,
): BoardInsightDTO | null {
  if (!insight) return null;
  return {
    hashtagTab: projectHashtagTab(insight.hashtagInsights, platform),
    techniqueTab: projectTechniqueTab(insight.hashtagInsights, insight.velocity),
    bgmTab: projectBgmTab(insight.bgmInsights, insight.velocity),
    eventTab: projectEventTab(insight.eventInsights),
    velocityTab: projectVelocityTab(insight.velocity),
  };
}

function projectHashtagTab(
  hashtagInsights: HashtagInsight[],
  platform: BoardPlatform,
): HashtagTabEntry[] {
  // HashtagInsight 全部源自 TikTok trendingHashtags (lib/trending/aggregate.ts:224)
  // IG 不参与 hashtag 维度,直接返空让前端隐藏该 tab 入口。
  if (platform === "instagram") return [];
  return hashtagInsights.map((h) => ({
    name: h.name,
    videoCount: h.videoCount,
    techniqueDistribution: { ...h.techniqueDistribution },
    avgDensity: h.avgDensity,
    topVideoIds: [...h.topVideoIds],
  }));
}

function projectTechniqueTab(
  hashtagInsights: HashtagInsight[],
  velocity: VelocityInsight,
): TechniqueTabEntry[] {
  const share = aggregateTechniqueShares(hashtagInsights);
  return Object.entries(share)
    .map(([technique, s]) => ({
      technique,
      share: s,
      trend: classifyTechniqueTrend(technique, velocity.techniqueWoW),
    }))
    .sort((a, b) => b.share - a.share);
}

/**
 * Weight per-hashtag technique distribution by videoCount → global share map.
 * **KEEP IN SYNC** with `combineDistributions` in aggregate.ts:117 — see file-level
 * note on deliberate cross-boundary duplication.
 */
function aggregateTechniqueShares(
  hashtagInsights: HashtagInsight[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  let weightSum = 0;
  for (const h of hashtagInsights) {
    weightSum += h.videoCount;
    for (const [tag, s] of Object.entries(h.techniqueDistribution)) {
      totals[tag] = (totals[tag] ?? 0) + s * h.videoCount;
    }
  }
  if (weightSum === 0) return {};
  const out: Record<string, number> = {};
  for (const [tag, sum] of Object.entries(totals)) out[tag] = sum / weightSum;
  return out;
}

function classifyTechniqueTrend(
  technique: string,
  techniqueWoW: Record<string, number>,
): TechniqueTrend {
  // 空 map = aggregate.ts:152 emit 的 "no prev snapshot" 信号 → 所有 technique 当 new。
  if (Object.keys(techniqueWoW).length === 0) return "new";
  const delta = techniqueWoW[technique];
  // Defensive fallback: aggregate.ts:167-168 对 cur∪prev 全 key 写 delta,
  // 正常路径下本周新出现 technique 也会有 delta=正值,不会走到 undefined。
  // 这一分支只 cover 未来 partial-update 路径。
  if (delta === undefined) return "new";
  if (delta > TECHNIQUE_TREND_THRESHOLD) return "rising";
  if (delta < -TECHNIQUE_TREND_THRESHOLD) return "falling";
  return "stable";
}

function projectBgmTab(
  bgmInsights: BgmInsight[],
  velocity: VelocityInsight,
): BgmTabEntry[] {
  const trendByName = new Map(velocity.bgmWoW.map((w) => [w.name, w.trend]));
  return bgmInsights.slice(0, BGM_TAB_LIMIT).map((b) => {
    const trend = trendByName.get(b.name);
    return {
      name: b.name,
      hitCount: b.hitCount,
      ...(b.trending !== undefined ? { trending: b.trending } : {}),
      ...(trend !== undefined ? { trend } : {}),
    };
  });
}

function projectEventTab(eventInsights: EventInsight[]): EventTabEntry[] {
  // sampleVideoIds 不入 board DTO (前端只展示聚合数,详情走专属页面 / 未来 deep dive)。
  return eventInsights.map((e) => ({
    name: e.name,
    displayName: e.displayName,
    matchedHashtags: [...e.matchedHashtags],
    matchedVideoCount: e.matchedVideoCount,
  }));
}

/**
 * Shallow-clone velocity into the narrowed BoardVelocityTab shape (HIGH #1 fix).
 * 浅拷贝 arrays/record 防 RSC route handler 多次调用 projectInsightForBoard 时
 * 跨调用共享底层引用导致 mutation 污染 (违反 CLAUDE.md 不可变约定)。
 */
function projectVelocityTab(velocity: VelocityInsight): BoardVelocityTab {
  return {
    techniqueWoW: { ...velocity.techniqueWoW },
    bgmWoW: velocity.bgmWoW.map((w) => ({
      name: w.name,
      trend: w.trend,
      deltaHits: w.deltaHits,
    })),
    eventWoW: velocity.eventWoW.map((w) => ({
      name: w.name,
      trend: w.trend,
    })),
  };
}
