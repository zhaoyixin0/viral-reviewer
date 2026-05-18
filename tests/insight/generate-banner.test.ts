import { describe, expect, it } from "vitest";
import {
  BannerStrategyNotImplementedError,
  generateBanner,
} from "@/lib/insight/generate-banner";
import type { TrendingInsight } from "@/lib/trending/insight-schema";
import type { TrendingSnapshot } from "@/lib/trending/types";

function mkSnapshot(insight?: TrendingInsight): TrendingSnapshot {
  const base: TrendingSnapshot = {
    schemaVersion: 2,
    week: "2026-W20",
    capturedAt: "2026-05-17T00:00:00Z",
    trendingHashtags: [],
    videos: [],
    meta: {
      tiktok: {
        source: "trends-actor",
        actorRun: "x",
        rawCount: 0,
        enrichedCount: 0,
        ok: true,
      },
      instagram: {
        source: "hashtag-proxy",
        actorRun: "y",
        rawCount: 0,
        enrichedCount: 0,
        ok: true,
      },
      partial: false,
    },
  };
  return insight !== undefined ? { ...base, insight } : base;
}

function mkInsight(overrides: Partial<TrendingInsight> = {}): TrendingInsight {
  return {
    week: "2026-W20",
    capturedAt: "2026-05-17T00:00:00Z",
    hashtagInsights: [],
    bgmInsights: [],
    eventInsights: [],
    velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
    totalEnriched: 0,
    ...overrides,
  };
}

describe("generateBanner", () => {
  it("snapshot=null → null", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: null,
    });
    expect(result).toBeNull();
  });

  it("snapshot.insight=undefined(v1 老快照)→ null", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: mkSnapshot(),
    });
    expect(result).toBeNull();
  });

  it("strategy='template' + 有 insight → 委托 renderTemplate,返回 banner", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: mkSnapshot(
        mkInsight({
          hashtagInsights: [
            {
              name: "travel",
              videoCount: 3,
              techniqueDistribution: { jumpcut: 0.5 },
              avgDensity: 5,
              topVideoIds: ["v1"],
            },
          ],
          totalEnriched: 3,
        }),
      ),
      strategy: "template",
    });
    expect(result).not.toBeNull();
    expect(result?.headline).toContain("travel");
    expect(result?.sourceWeek).toBe("2026-W20");
  });

  it("默认 strategy(未传)走 template path", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      snapshot: mkSnapshot(
        mkInsight({
          hashtagInsights: [
            {
              name: "fitness",
              videoCount: 2,
              techniqueDistribution: {},
              avgDensity: 0,
              topVideoIds: [],
            },
          ],
        }),
      ),
    });
    expect(result?.headline).toContain("fitness");
  });

  it("strategy='llm' 在 C1 抛 BannerStrategyNotImplementedError(C2 ships)", async () => {
    await expect(
      generateBanner({
        userFormat: "vlog",
        snapshot: mkSnapshot(mkInsight()),
        strategy: "llm",
      }),
    ).rejects.toThrow(BannerStrategyNotImplementedError);

    // Also assert structured shape so C4 wiring can branch on .code
    try {
      await generateBanner({
        userFormat: "vlog",
        snapshot: mkSnapshot(mkInsight()),
        strategy: "llm",
      });
    } catch (e) {
      expect(e).toBeInstanceOf(BannerStrategyNotImplementedError);
      const err = e as BannerStrategyNotImplementedError;
      expect(err.code).toBe("BANNER_STRATEGY_NOT_IMPLEMENTED");
      expect(err.strategy).toBe("llm");
    }
  });

  it("userTopic 透传到 renderTemplate(命中 hashtag)", async () => {
    const result = await generateBanner({
      userFormat: "vlog",
      userTopic: "travel",
      snapshot: mkSnapshot(
        mkInsight({
          hashtagInsights: [
            {
              name: "travelvlog",
              videoCount: 5,
              techniqueDistribution: {},
              avgDensity: 0,
              topVideoIds: [],
            },
            {
              name: "fitness",
              videoCount: 3,
              techniqueDistribution: {},
              avgDensity: 0,
              topVideoIds: [],
            },
          ],
        }),
      ),
    });
    expect(result?.headline).toContain("travelvlog");
  });
});
