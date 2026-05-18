import { describe, expect, it } from "vitest";
import type { CutPlan } from "@/lib/cut-plan/schema";
import type { ViralVideo } from "@/lib/review-engine/types";
import { aggregate, type EnrichedPlan } from "@/lib/trending/aggregate";
import type { TrendingInsight } from "@/lib/trending/insight-schema";
import type { TrendingHashtag } from "@/lib/trending/types";

function vid(
  id: string,
  hashtag: string | undefined,
  views: number,
  platform: "tiktok" | "instagram" = "tiktok",
): ViralVideo {
  return {
    id, platform, url: `https://x/${id}`, cover: "", title: id,
    description: "", topic: "", tags: [],
    views, likes: 0, comments: 0, shares: 0, duration: 25,
    playStyle: "未分类", visualStyle: "未分类", hook: "",
    bgm: "", authorHandle: "@u", publishedAt: "2026-05-10",
    trendingContext: hashtag ? { hashtag, hashtagRank: 1 } : undefined,
  };
}

function plan(opts: {
  videoId: string;
  movements?: string[];
  transitions?: string[];
  density?: number;
  bgmName?: string | null;
  bgmTrending?: boolean | null;
}): CutPlan {
  return {
    videoId: opts.videoId,
    durationSec: 25,
    fps: 30,
    videoFormat: "vlog",
    videoFormatConfidence: 0.9,
    actions: [],
    bgm: opts.bgmName === undefined ? null : { name: opts.bgmName ?? "", trending: opts.bgmTrending },
    dimensions: {
      pacing: {
        shotCount: 1, avgShotDurationSec: 25, cutDensityPerSec: 0,
        rhythmProfile: null, keyTwistAt: null,
      },
      camera: {
        dominantMovements: opts.movements ?? [],
        shotSizeDistribution: {},
        transitionPatterns: opts.transitions ?? [],
      },
      audiovisual: {
        bgmPattern: null, bgmSyncTightness: null,
        subtitleStyle: null, colorGrade: null,
      },
      structure: {
        hookFormat: null, openingShot: null, endingShot: null,
        cta: null, payoffAt: null,
      },
    },
    density: {
      editing: 50, transition: 50, effect: 50, bgmSync: 50,
      overall: opts.density ?? 50,
    },
  } as unknown as CutPlan;
}

function ep(video: ViralVideo, cutPlan: CutPlan): EnrichedPlan {
  return { video, cutPlan };
}

function ht(name: string, rank = 1): TrendingHashtag {
  return { name, rank, viewCount: 1000, videoCount: 10, rankDiff: 0, isNew: false };
}

describe("aggregate (T2 C4)", () => {
  describe("base wiring", () => {
    it("returns emptyInsight shape when given nothing to aggregate", () => {
      const r = aggregate({
        enrichedPlans: [], trendingHashtags: [], eventInsights: [],
        week: "2026-W21",
      });
      expect(r.week).toBe("2026-W21");
      expect(r.hashtagInsights).toEqual([]);
      expect(r.bgmInsights).toEqual([]);
      expect(r.eventInsights).toEqual([]);
      expect(r.velocity).toEqual({ techniqueWoW: {}, bgmWoW: [], eventWoW: [] });
      expect(r.totalEnriched).toBe(0);
    });

    it("is a pure function — same inputs produce equal outputs", () => {
      const input = {
        enrichedPlans: [
          ep(vid("a", "morningroutine", 1000),
             plan({ videoId: "a", movements: ["push_in"], density: 60 })),
        ],
        trendingHashtags: [ht("morningroutine")],
        eventInsights: [],
        week: "2026-W20",
        capturedAt: "2026-05-14T08:00:00Z",
      };
      const r1 = aggregate(input);
      const r2 = aggregate(input);
      expect(r1).toEqual(r2);
    });

    it("uses a default capturedAt when omitted", () => {
      const r = aggregate({
        enrichedPlans: [],
        trendingHashtags: [ht("x")],
        eventInsights: [],
        week: "2026-W22",
      });
      expect(typeof r.capturedAt).toBe("string");
      expect(r.capturedAt.length).toBeGreaterThan(10);
    });

    it("preserves caller-supplied capturedAt", () => {
      const r = aggregate({
        enrichedPlans: [], trendingHashtags: [ht("x")], eventInsights: [],
        week: "2026-W22", capturedAt: "2026-05-10T00:00:00Z",
      });
      expect(r.capturedAt).toBe("2026-05-10T00:00:00Z");
    });
  });

  describe("hashtag dimension", () => {
    it("matches plans by trendingContext.hashtag, normalizes distribution to sum ≈ 1", () => {
      const r = aggregate({
        enrichedPlans: [
          ep(vid("a", "morningroutine", 1000),
             plan({ videoId: "a", movements: ["push_in", "push_in", "static"], density: 80 })),
          ep(vid("b", "morningroutine", 500),
             plan({ videoId: "b", movements: ["match_cut"], density: 40 })),
          ep(vid("ig1", undefined, 9999, "instagram"),
             plan({ videoId: "ig1", movements: ["push_in"] })),  // no hashtag → ignored
        ],
        trendingHashtags: [ht("morningroutine")],
        eventInsights: [], week: "2026-W20",
      });
      const h = r.hashtagInsights[0];
      expect(h.name).toBe("morningroutine");
      expect(h.videoCount).toBe(2);
      const sum = Object.values(h.techniqueDistribution).reduce((s, n) => s + n, 0);
      expect(sum).toBeCloseTo(1, 5);
      expect(h.avgDensity).toBeCloseTo(60, 5);
    });

    it("avgDensity is 0 (not NaN) when hashtag has no matching plans", () => {
      const r = aggregate({
        enrichedPlans: [],
        trendingHashtags: [ht("empty")],
        eventInsights: [], week: "2026-W20",
      });
      expect(r.hashtagInsights[0].avgDensity).toBe(0);
      expect(r.hashtagInsights[0].videoCount).toBe(0);
      expect(r.hashtagInsights[0].techniqueDistribution).toEqual({});
    });

    it("topVideoIds returns top 3 by views, sorted desc", () => {
      const r = aggregate({
        enrichedPlans: [
          ep(vid("low", "x", 100), plan({ videoId: "low" })),
          ep(vid("mid", "x", 500), plan({ videoId: "mid" })),
          ep(vid("high", "x", 9000), plan({ videoId: "high" })),
          ep(vid("highest", "x", 99999), plan({ videoId: "highest" })),
        ],
        trendingHashtags: [ht("x")],
        eventInsights: [], week: "2026-W20",
      });
      expect(r.hashtagInsights[0].topVideoIds).toEqual(["highest", "high", "mid"]);
    });

    it("normalizes tag spelling consistently (snake_case → kebab-case)", () => {
      const r = aggregate({
        enrichedPlans: [
          ep(vid("a", "x", 1000),
             plan({ videoId: "a", movements: ["push_in", "PUSH_IN"], transitions: ["WHIP_PAN"] })),
        ],
        trendingHashtags: [ht("x")],
        eventInsights: [], week: "2026-W20",
      });
      const dist = r.hashtagInsights[0].techniqueDistribution;
      expect(dist["push-in"]).toBeCloseTo(2 / 3, 5);
      expect(dist["whip-pan"]).toBeCloseTo(1 / 3, 5);
    });
  });

  describe("BGM dimension", () => {
    it("rolls up by exact BGM name, sorted by hitCount desc", () => {
      const r = aggregate({
        enrichedPlans: [
          ep(vid("a", "x", 1), plan({ videoId: "a", bgmName: "Sunset Lover" })),
          ep(vid("b", "x", 1), plan({ videoId: "b", bgmName: "Sunset Lover" })),
          ep(vid("c", "x", 1), plan({ videoId: "c", bgmName: "Other Track" })),
        ],
        trendingHashtags: [], eventInsights: [], week: "2026-W20",
      });
      expect(r.bgmInsights.map((b) => b.name)).toEqual(["Sunset Lover", "Other Track"]);
      expect(r.bgmInsights[0].hitCount).toBe(2);
      expect(r.bgmInsights[0].hitVideoIds).toEqual(["a", "b"]);
    });

    it("skips empty / null / whitespace BGM names", () => {
      const r = aggregate({
        enrichedPlans: [
          ep(vid("a", "x", 1), plan({ videoId: "a", bgmName: "" })),
          ep(vid("b", "x", 1), plan({ videoId: "b", bgmName: "   " })),
          ep(vid("c", "x", 1), plan({ videoId: "c", bgmName: null })),
        ],
        trendingHashtags: [], eventInsights: [], week: "2026-W20",
      });
      expect(r.bgmInsights).toEqual([]);
    });

    it("caps top-10 even when more distinct BGM names appear", () => {
      const plans = Array.from({ length: 20 }, (_, i) =>
        ep(vid(`v${i}`, "x", 1), plan({ videoId: `v${i}`, bgmName: `BGM${i}` })),
      );
      const r = aggregate({
        enrichedPlans: plans, trendingHashtags: [], eventInsights: [],
        week: "2026-W20",
      });
      expect(r.bgmInsights).toHaveLength(10);
    });

    it("carries trending flag from first plan that reported one", () => {
      const r = aggregate({
        enrichedPlans: [
          ep(vid("a", "x", 1), plan({ videoId: "a", bgmName: "Track", bgmTrending: undefined })),
          ep(vid("b", "x", 1), plan({ videoId: "b", bgmName: "Track", bgmTrending: true })),
        ],
        trendingHashtags: [], eventInsights: [], week: "2026-W20",
      });
      expect(r.bgmInsights[0].trending).toBe(true);
    });
  });

  describe("velocity dimension", () => {
    function prev(over: Partial<TrendingInsight> = {}): TrendingInsight {
      return {
        week: "2026-W19",
        capturedAt: "2026-05-07T00:00:00Z",
        hashtagInsights: [],
        bgmInsights: [],
        eventInsights: [],
        velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
        totalEnriched: 0,
        ...over,
      };
    }

    it("previousInsight=null → techniqueWoW={}, all BGM/event tagged 'new'", () => {
      const r = aggregate({
        enrichedPlans: [
          ep(vid("a", "x", 1), plan({ videoId: "a", bgmName: "Track A" })),
        ],
        trendingHashtags: [ht("x")],
        // C8 P1b: matchedVideoCount must be >= 3 to survive the exit filter.
        eventInsights: [{ name: "met_gala", displayName: "Met Gala", matchedHashtags: [], matchedVideoCount: 5, sampleVideoIds: [] }],
        week: "2026-W20",
        previousInsight: null,
      });
      expect(r.velocity.techniqueWoW).toEqual({});
      expect(r.velocity.bgmWoW[0]).toMatchObject({ name: "Track A", trend: "new" });
      expect(r.velocity.eventWoW[0]).toEqual({ name: "met_gala", trend: "new" });
    });

    it("technique WoW = current global share - previous global share", () => {
      const r = aggregate({
        enrichedPlans: [
          ep(vid("a", "x", 1),
             plan({ videoId: "a", movements: ["push_in", "push_in", "push_in"] })),
        ],
        trendingHashtags: [ht("x")],
        eventInsights: [],
        week: "2026-W20",
        previousInsight: prev({
          hashtagInsights: [{
            name: "x", videoCount: 1,
            techniqueDistribution: { "push-in": 0.4, "static": 0.6 },
            avgDensity: 0, topVideoIds: [],
          }],
        }),
      });
      expect(r.velocity.techniqueWoW["push-in"]).toBeCloseTo(0.6, 5);
      expect(r.velocity.techniqueWoW["static"]).toBeCloseTo(-0.6, 5);
    });

    it("classifies BGM rising / stable / falling against previous hit counts", () => {
      const r = aggregate({
        enrichedPlans: [
          ep(vid("a", "x", 1), plan({ videoId: "a", bgmName: "Up" })),
          ep(vid("b", "x", 1), plan({ videoId: "b", bgmName: "Up" })),
          ep(vid("c", "x", 1), plan({ videoId: "c", bgmName: "Up" })),
          ep(vid("d", "x", 1), plan({ videoId: "d", bgmName: "Up" })),
          ep(vid("e", "x", 1), plan({ videoId: "e", bgmName: "Stay" })),
          ep(vid("f", "x", 1), plan({ videoId: "f", bgmName: "Stay" })),
        ],
        trendingHashtags: [],
        eventInsights: [],
        week: "2026-W20",
        previousInsight: prev({
          bgmInsights: [
            { name: "Up", hitCount: 1, hitVideoIds: [] },
            { name: "Stay", hitCount: 2, hitVideoIds: [] },
            { name: "Down", hitCount: 5, hitVideoIds: [] },
          ],
        }),
      });
      const byName = Object.fromEntries(r.velocity.bgmWoW.map((b) => [b.name, b]));
      expect(byName["Up"].trend).toBe("rising");
      expect(byName["Up"].deltaHits).toBe(3);
      expect(byName["Stay"].trend).toBe("stable");
    });

    it("event WoW: new / stable / ended", () => {
      const r = aggregate({
        enrichedPlans: [],
        trendingHashtags: [],
        // C8 P1b: all matchedVideoCount bumped >= 3 to survive the exit filter.
        // previousInsight is opaque carryover so its event matchedVideoCount
        // is not filtered (only current-week events run through the filter).
        eventInsights: [
          { name: "vday", displayName: "VDay", matchedHashtags: [], matchedVideoCount: 4, sampleVideoIds: [] },
          { name: "xmas", displayName: "Xmas", matchedHashtags: [], matchedVideoCount: 5, sampleVideoIds: [] },
        ],
        week: "2026-W20",
        previousInsight: prev({
          eventInsights: [
            { name: "vday", displayName: "VDay", matchedHashtags: [], matchedVideoCount: 4, sampleVideoIds: [] },
            { name: "metgala", displayName: "Met Gala", matchedHashtags: [], matchedVideoCount: 3, sampleVideoIds: [] },
          ],
        }),
      });
      const byName = Object.fromEntries(r.velocity.eventWoW.map((e) => [e.name, e.trend]));
      expect(byName["vday"]).toBe("stable");
      expect(byName["xmas"]).toBe("new");
      expect(byName["metgala"]).toBe("ended");
    });

    it("C8 P1b: events with matchedVideoCount < 3 filtered at exit, do NOT surface in eventInsights or velocity", () => {
      const r = aggregate({
        enrichedPlans: [],
        trendingHashtags: [],
        eventInsights: [
          { name: "real", displayName: "Real", matchedHashtags: [], matchedVideoCount: 5, sampleVideoIds: [] },
          { name: "noisy_1hit", displayName: "Noisy 1", matchedHashtags: [], matchedVideoCount: 1, sampleVideoIds: [] },
          { name: "noisy_2hit", displayName: "Noisy 2", matchedHashtags: [], matchedVideoCount: 2, sampleVideoIds: [] },
        ],
        week: "2026-W20",
      });
      expect(r.eventInsights.map((e) => e.name)).toEqual(["real"]);
      expect(r.velocity.eventWoW.map((e) => e.name)).toEqual(["real"]);
    });

    it("C8 P1b: empty result when ONLY low-confidence events arrive (no plans / hashtags)", () => {
      const r = aggregate({
        enrichedPlans: [],
        trendingHashtags: [],
        eventInsights: [
          { name: "noise", displayName: "noise", matchedHashtags: [], matchedVideoCount: 1, sampleVideoIds: [] },
        ],
        week: "2026-W20",
      });
      // Falls through to emptyInsight: nothing has substance.
      expect(r.eventInsights).toEqual([]);
      expect(r.hashtagInsights).toEqual([]);
      expect(r.totalEnriched).toBe(0);
    });
  });

  it("totalEnriched reflects enrichedPlans length, regardless of hashtag matching", () => {
    const r = aggregate({
      enrichedPlans: [
        ep(vid("a", "matched", 1), plan({ videoId: "a" })),
        ep(vid("b", undefined, 1, "instagram"), plan({ videoId: "b" })),
        ep(vid("c", "unmatched", 1), plan({ videoId: "c" })),
      ],
      trendingHashtags: [ht("matched")],
      eventInsights: [],
      week: "2026-W20",
    });
    expect(r.totalEnriched).toBe(3);
  });
});
