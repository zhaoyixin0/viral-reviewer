import type { CutPlan } from "@/lib/cut-plan/schema";
import type { ViralVideo } from "@/lib/review-engine/types";
import { normalizeTag } from "@/lib/technique-index/extract-tags";
import {
  emptyInsight,
  type BgmInsight,
  type EventInsight,
  type HashtagInsight,
  type TrendingInsight,
  type VelocityInsight,
} from "./insight-schema";
import type { TrendingHashtag } from "./types";

/**
 * Aggregate layer (T2 C4, plan §3.3). Pure: no I/O, no LLM, no side effects.
 * Event detection is factored to event-detector.ts (C5); callers (T3) pass
 * the pre-detected EventInsight[] so this stays sync + deterministic.
 */

const BGM_TOP_LIMIT = 10;
const TOP_VIDEOS_PER_HASHTAG = 3;
const TREND_THRESHOLD = 0.05;
/**
 * W3 C8 P1b (plan §11 R4 noise mitigation): events with too few matched videos
 * are likely false positives from either the keyword dictionary OR the LLM
 * overlay. Filter at the aggregate exit so BOTH strategies share the cutoff —
 * filtering inside event-detector would let the LLM path bypass it.
 */
const MIN_EVENT_MATCHED_VIDEO_COUNT = 3;

export type EnrichedPlan = { video: ViralVideo; cutPlan: CutPlan };

export type AggregateInput = {
  enrichedPlans: EnrichedPlan[];
  trendingHashtags: TrendingHashtag[];
  eventInsights: EventInsight[];
  previousInsight?: TrendingInsight | null;
  week: string;
  capturedAt?: string;
};

function planTechniqueTags(plan: CutPlan): string[] {
  const out: string[] = [];
  for (const m of plan.dimensions.camera.dominantMovements) {
    const t = normalizeTag(m);
    if (t) out.push(t);
  }
  for (const t of plan.dimensions.camera.transitionPatterns) {
    const n = normalizeTag(t);
    if (n) out.push(n);
  }
  return out;
}

function normalizeDistribution(tags: string[]): Record<string, number> {
  if (tags.length === 0) return {};
  const counts: Record<string, number> = {};
  for (const t of tags) counts[t] = (counts[t] ?? 0) + 1;
  const out: Record<string, number> = {};
  for (const [tag, n] of Object.entries(counts)) out[tag] = n / tags.length;
  return out;
}

function buildHashtagInsight(
  hashtag: TrendingHashtag,
  enrichedPlans: EnrichedPlan[],
): HashtagInsight {
  const matching = enrichedPlans.filter(
    (p) => p.video.trendingContext?.hashtag === hashtag.name,
  );
  const allTags: string[] = [];
  let densitySum = 0;
  for (const p of matching) {
    for (const t of planTechniqueTags(p.cutPlan)) allTags.push(t);
    densitySum += p.cutPlan.density.overall;
  }
  return {
    name: hashtag.name,
    videoCount: matching.length,
    techniqueDistribution: normalizeDistribution(allTags),
    avgDensity: matching.length > 0 ? densitySum / matching.length : 0,
    topVideoIds: [...matching]
      .sort((a, b) => b.video.views - a.video.views)
      .slice(0, TOP_VIDEOS_PER_HASHTAG)
      .map((p) => p.video.id),
  };
}

function buildBgmInsights(enrichedPlans: EnrichedPlan[]): BgmInsight[] {
  type Acc = { hitCount: number; hitVideoIds: string[]; trending: boolean | null };
  const map = new Map<string, Acc>();
  for (const p of enrichedPlans) {
    const name = p.cutPlan.bgm?.name?.trim();
    if (!name) continue;
    const existing = map.get(name);
    if (existing) {
      existing.hitCount += 1;
      existing.hitVideoIds.push(p.video.id);
      if (existing.trending === null && p.cutPlan.bgm?.trending !== undefined) {
        existing.trending = p.cutPlan.bgm.trending ?? null;
      }
    } else {
      map.set(name, {
        hitCount: 1,
        hitVideoIds: [p.video.id],
        trending: p.cutPlan.bgm?.trending ?? null,
      });
    }
  }
  return Array.from(map.entries())
    .map(([name, acc]) => ({ name, ...acc }))
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, BGM_TOP_LIMIT);
}

/** Weight technique shares by per-hashtag videoCount → global share map. */
function combineDistributions(
  hashtagInsights: HashtagInsight[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  let weightSum = 0;
  for (const h of hashtagInsights) {
    weightSum += h.videoCount;
    for (const [tag, share] of Object.entries(h.techniqueDistribution)) {
      totals[tag] = (totals[tag] ?? 0) + share * h.videoCount;
    }
  }
  if (weightSum === 0) return {};
  const out: Record<string, number> = {};
  for (const [tag, sum] of Object.entries(totals)) out[tag] = sum / weightSum;
  return out;
}

function classifyBgmTrend(
  current: number,
  prev: number | undefined,
): { trend: "new" | "rising" | "stable" | "falling"; delta: number } {
  if (prev === undefined) return { trend: "new", delta: current };
  const delta = current - prev;
  const threshold = Math.max(1, prev * TREND_THRESHOLD);
  if (delta > threshold) return { trend: "rising", delta };
  if (-delta > threshold) return { trend: "falling", delta };
  return { trend: "stable", delta };
}

function buildVelocity(
  hashtagInsights: HashtagInsight[],
  bgmInsights: BgmInsight[],
  eventInsights: EventInsight[],
  previousInsight: TrendingInsight | null,
): VelocityInsight {
  if (!previousInsight) {
    return {
      techniqueWoW: {},
      bgmWoW: bgmInsights.map((b) => ({
        name: b.name,
        trend: "new" as const,
        deltaHits: b.hitCount,
      })),
      eventWoW: eventInsights.map((e) => ({ name: e.name, trend: "new" as const })),
    };
  }

  const cur = combineDistributions(hashtagInsights);
  const prev = combineDistributions(previousInsight.hashtagInsights);
  const techniqueWoW: Record<string, number> = {};
  for (const key of new Set([...Object.keys(cur), ...Object.keys(prev)])) {
    techniqueWoW[key] = (cur[key] ?? 0) - (prev[key] ?? 0);
  }

  const prevBgm = new Map(previousInsight.bgmInsights.map((b) => [b.name, b.hitCount]));
  const bgmWoW = bgmInsights.map((b) => {
    const { trend, delta } = classifyBgmTrend(b.hitCount, prevBgm.get(b.name));
    return { name: b.name, trend, deltaHits: delta };
  });

  const prevEvents = new Set(previousInsight.eventInsights.map((e) => e.name));
  const currentEvents = new Set(eventInsights.map((e) => e.name));
  const eventWoW: VelocityInsight["eventWoW"] = [];
  for (const name of new Set([...currentEvents, ...prevEvents])) {
    if (currentEvents.has(name) && !prevEvents.has(name)) {
      eventWoW.push({ name, trend: "new" });
    } else if (currentEvents.has(name) && prevEvents.has(name)) {
      eventWoW.push({ name, trend: "stable" });
    } else {
      eventWoW.push({ name, trend: "ended" });
    }
  }

  return { techniqueWoW, bgmWoW, eventWoW };
}

/**
 * Public entry. Returns emptyInsight(week) when there is nothing to aggregate
 * (no plans AND no hashtags AND no events) so callers can skip null checks.
 */
export function aggregate(input: AggregateInput): TrendingInsight {
  const {
    enrichedPlans,
    trendingHashtags,
    eventInsights,
    previousInsight = null,
    week,
    capturedAt = new Date().toISOString(),
  } = input;

  // W3 C8 P1b: filter low-confidence events at the public exit. Run BEFORE
  // the empty-input short-circuit so a caller passing only spurious 1-match
  // events still gets emptyInsight (not an insight with empty arrays).
  // Velocity sees the filtered set, so a "new" tag only fires on events that
  // would actually surface to the UI.
  const filteredEventInsights = eventInsights.filter(
    (e) => e.matchedVideoCount >= MIN_EVENT_MATCHED_VIDEO_COUNT,
  );

  if (
    enrichedPlans.length === 0 &&
    trendingHashtags.length === 0 &&
    filteredEventInsights.length === 0
  ) {
    return { ...emptyInsight(week), capturedAt };
  }

  const hashtagInsights = trendingHashtags.map((h) =>
    buildHashtagInsight(h, enrichedPlans),
  );
  const bgmInsights = buildBgmInsights(enrichedPlans);
  const velocity = buildVelocity(
    hashtagInsights,
    bgmInsights,
    filteredEventInsights,
    previousInsight,
  );

  return {
    week,
    capturedAt,
    hashtagInsights,
    bgmInsights,
    eventInsights: filteredEventInsights,
    velocity,
    totalEnriched: enrichedPlans.length,
  };
}
