import type { TrendingSnapshot } from "@/lib/trending/types";
import { renderTemplate } from "./insight-template";

/**
 * InsightBannerData — payload rendered above /technique-match verdict.
 *
 * Forward shape: fields are stable; bullets length 0..3, actionable is a
 * single Chinese paragraph. T6 C1 ships only the deterministic `template`
 * strategy. The `llm` strategy (Haiku) lands in C2 with template fallback.
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
  /** Default "template". "llm" is shipped in T6 C2. */
  strategy?: BannerStrategy;
};

/**
 * Sentinel thrown by `generateBanner` when an unimplemented strategy is
 * requested. C2 will replace this throw with an actual LLM call (Haiku) plus
 * fallback to the template strategy. Exported so C4 wiring / callers can
 * distinguish "not implemented yet" from arbitrary runtime crashes.
 */
export class BannerStrategyNotImplementedError extends Error {
  readonly code = "BANNER_STRATEGY_NOT_IMPLEMENTED" as const;
  readonly strategy: BannerStrategy;
  constructor(strategy: BannerStrategy) {
    super(`generateBanner: strategy='${strategy}' not yet implemented`);
    this.name = "BannerStrategyNotImplementedError";
    this.strategy = strategy;
  }
}

/**
 * Entry. Returns null when the snapshot has no v2 insight (v1 legacy snapshot
 * or no snapshot at all) — caller renders nothing in that case.
 */
export async function generateBanner(
  input: GenerateBannerInput,
): Promise<InsightBannerData | null> {
  const snapshot = input.snapshot;
  if (!snapshot?.insight) return null;

  const strategy = input.strategy ?? "template";

  if (strategy === "template") {
    return renderTemplate({
      userFormat: input.userFormat,
      userTopic: input.userTopic,
      insight: snapshot.insight,
      week: snapshot.week,
    });
  }

  throw new BannerStrategyNotImplementedError(strategy);
}
