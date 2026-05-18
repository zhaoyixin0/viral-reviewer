import type { TrendingInsight } from "@/lib/trending/insight-schema";
import type { TrendingSnapshot } from "@/lib/trending/types";

import { findBestHashtag } from "./hashtag-match";
import { generateBannerLlm } from "./insight-llm";
import { renderTemplate } from "./insight-template";

/**
 * InsightBannerData — payload rendered above /technique-match verdict.
 *
 * Forward shape: fields are stable; bullets length 0..3, actionable is a
 * single Chinese paragraph. T6 C1 ships the deterministic `template`
 * strategy; T6 C2 lands the `llm` strategy with template fallback on any
 * LLM failure (memory: stage2-failure-loses-stage1.md).
 */
export type InsightBannerData = {
  /** Snapshot week the banner reflects (e.g. "2026-W20"). */
  week: string;
  headline: string;
  bullets: string[];
  actionable: string;
  /**
   * Equal to `week` for the template strategy. Kept as a distinct field so
   * future strategies (e.g. LLM blending current + prior week) can attribute
   * facts back to a specific source week without breaking the contract.
   */
  sourceWeek: string;
  /** Sample video IDs from the chosen hashtag insight, capped at 3 items. */
  sampleVideoIds: string[];
};

export type BannerStrategy = "template" | "llm";

export type GenerateBannerInput = {
  userFormat: string;
  userTopic?: string | undefined;
  snapshot: TrendingSnapshot | null;
  /** Default "template". "llm" shipped in T6 C2 with fallback. */
  strategy?: BannerStrategy;
};

/**
 * Entry. Returns null when the snapshot has no v2 insight (v1 legacy snapshot
 * or no snapshot at all) — caller renders nothing in that case.
 *
 * For strategy="llm", any LLM failure (null return from generateBannerLlm)
 * falls back to renderTemplate so the data path is never broken.
 */
export async function generateBanner(
  input: GenerateBannerInput,
): Promise<InsightBannerData | null> {
  const snapshot = input.snapshot;
  if (!snapshot?.insight) return null;
  const insight = snapshot.insight;
  const strategy = input.strategy ?? "template";

  const templateInput = {
    userFormat: input.userFormat,
    userTopic: input.userTopic,
    insight,
    week: snapshot.week,
  };

  switch (strategy) {
    case "template":
      return renderTemplate(templateInput);
    case "llm": {
      const sampleVideoIds = pickSampleVideoIds(insight, input.userTopic);
      let llm: InsightBannerData | null = null;
      try {
        llm = await generateBannerLlm({
          userFormat: input.userFormat,
          userTopic: input.userTopic,
          insight,
          week: snapshot.week,
          sampleVideoIds,
        });
      } catch {
        // Defense in depth — generateBannerLlm contract returns null on
        // failure, but errors must not leak past this caller (memory:
        // stage2-failure-loses-stage1).
        llm = null;
      }
      if (llm) return llm;
      return renderTemplate(templateInput);
    }
    default: {
      // Exhaustiveness guard — TypeScript error if BannerStrategy expands.
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}

/**
 * Deterministic — picks 0..3 video IDs from the best-matching hashtag insight
 * so the LLM path produces identical sampleVideoIds to the template path.
 * Selection logic shared with renderTemplate via lib/insight/hashtag-match.
 */
function pickSampleVideoIds(
  insight: TrendingInsight,
  userTopic: string | undefined,
): string[] {
  const best = findBestHashtag(insight.hashtagInsights, userTopic);
  return best?.topVideoIds.slice(0, 3) ?? [];
}
