import type {
  BgmInsight,
  EventInsight,
  HashtagInsight,
  TrendingInsight,
} from "@/lib/trending/insight-schema";
import type { InsightBannerData } from "./generate-banner";

/**
 * Deterministic template strategy for InsightBanner.
 *
 * Pure, no I/O — < 50 ms per call. Picks best matching hashtag insight
 * (fuzzy match on userTopic, else top-1), extracts top-2 techniques + top BGM
 * + top event, fills a fixed Chinese template. Returns InsightBannerData with
 * possibly-empty bullets when the insight has no per-dimension data, but
 * always returns a value (never null) — generator's null gate sits one layer
 * up in generate-banner.ts.
 */

export type TemplateRenderInput = {
  userFormat: string;
  userTopic?: string | undefined;
  insight: TrendingInsight;
  week: string;
};

type TechniqueShare = { name: string; share: number };

export function renderTemplate(input: TemplateRenderInput): InsightBannerData {
  const bestHashtag = findBestHashtag(
    input.insight.hashtagInsights,
    input.userTopic,
  );
  const techniques = pickTopTechniques(bestHashtag);
  const bgm = input.insight.bgmInsights[0] ?? null;
  const event = input.insight.eventInsights[0] ?? null;

  return {
    week: input.week,
    headline: composeHeadline(bestHashtag, input.userTopic, input.userFormat),
    bullets: composeBullets(techniques, bgm, event),
    actionable: composeActionable(input.userFormat, techniques, bgm, event),
    sourceWeek: input.week,
    sampleVideoIds: bestHashtag?.topVideoIds.slice(0, 3) ?? [],
  };
}

const MIN_FUZZY_LENGTH = 3;

function findBestHashtag(
  insights: readonly HashtagInsight[],
  userTopic: string | undefined,
): HashtagInsight | null {
  if (insights.length === 0) return null;
  if (userTopic) {
    const lower = userTopic.toLowerCase();
    // Asymmetric fuzzy match: forward direction always (name contains topic),
    // reverse (topic contains name) only when the hashtag name is long enough
    // to avoid false positives like name="go" matching topic="ego" or
    // name="or" matching topic="tutorial".
    const hit = insights.find((h) => {
      const name = h.name.toLowerCase();
      if (name.includes(lower)) return true;
      return name.length >= MIN_FUZZY_LENGTH && lower.includes(name);
    });
    if (hit) return hit;
  }
  return insights[0] ?? null;
}

function pickTopTechniques(h: HashtagInsight | null): TechniqueShare[] {
  if (!h) return [];
  return Object.entries(h.techniqueDistribution)
    .map(([name, share]) => ({ name, share }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 2);
}

function pct(n: number): string {
  // Schema validates share in 0..1, but cap defensively so a writer bug
  // upstream can never render "120%" to a user.
  const clamped = Math.max(0, Math.min(1, n));
  return `${Math.round(clamped * 100)}%`;
}

function composeHeadline(
  h: HashtagInsight | null,
  userTopic: string | undefined,
  userFormat: string,
): string {
  const tag = h?.name ?? userTopic ?? userFormat;
  return `结合本周 [${tag} 赛道] 趋势`;
}

function composeBullets(
  techniques: readonly TechniqueShare[],
  bgm: BgmInsight | null,
  event: EventInsight | null,
): string[] {
  const items: string[] = [];
  const t1 = techniques[0];
  if (t1) {
    const t2 = techniques[1];
    const techStr = t2
      ? `剪辑手法:${t1.name} 占 ${pct(t1.share)} + ${t2.name} 占 ${pct(t2.share)}`
      : `剪辑手法:${t1.name} 占 ${pct(t1.share)}`;
    items.push(techStr);
  }
  if (bgm) {
    items.push(`BGM Top1:"${bgm.name}"(命中 ${bgm.hitCount} 视频)`);
  }
  if (event) {
    items.push(`热点事件:${event.displayName}`);
  }
  return items;
}

function composeActionable(
  userFormat: string,
  techniques: readonly TechniqueShare[],
  bgm: BgmInsight | null,
  event: EventInsight | null,
): string {
  const parts: string[] = [];
  const t1 = techniques[0];
  if (t1) {
    parts.push(`${userFormat} 优先尝试 ${t1.name}(本周占比 ${pct(t1.share)})`);
  }
  if (bgm) {
    parts.push(`配 BGM "${bgm.name}" 蹭热度`);
  }
  if (event) {
    parts.push(`如题材契合 ${event.displayName},抓住热点窗口`);
  }
  if (parts.length === 0) {
    return `本周暂无显著趋势,按你的 ${userFormat} 常用手法剪即可`;
  }
  return parts.join(";") + "。";
}
