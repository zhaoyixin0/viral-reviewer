import { describe, expect, it } from "vitest";
import {
  BgmInsightSchema,
  EventInsightSchema,
  HashtagInsightSchema,
  TrendingInsightSchema,
  VelocityInsightSchema,
  emptyInsight,
  type TrendingInsight,
} from "@/lib/trending/insight-schema";
import {
  TrendingSnapshotSchema,
  TRENDING_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
} from "@/lib/trending/types";

describe("TRENDING_SCHEMA_VERSION constants", () => {
  it("is bumped to 2 (L3+ insight layer)", () => {
    expect(TRENDING_SCHEMA_VERSION).toBe(2);
  });

  it("SUPPORTED_SCHEMA_VERSIONS keeps v1 in the compat window", () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain(1);
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain(2);
  });
});

describe("HashtagInsightSchema", () => {
  it("parses a fully populated record", () => {
    const r = HashtagInsightSchema.safeParse({
      name: "morningroutine",
      videoCount: 8,
      techniqueDistribution: { push_in: 0.6, match_cut: 0.4 },
      avgDensity: 72.4,
      topVideoIds: ["tt-a", "tt-b", "tt-c"],
    });
    expect(r.success).toBe(true);
  });

  it("applies defaults for empty distribution / videos / density", () => {
    const r = HashtagInsightSchema.parse({
      name: "glowup",
      videoCount: 0,
    });
    expect(r.techniqueDistribution).toEqual({});
    expect(r.topVideoIds).toEqual([]);
    expect(r.avgDensity).toBe(0);
  });

  it("rejects negative videoCount / out-of-range distribution value", () => {
    expect(
      HashtagInsightSchema.safeParse({ name: "x", videoCount: -1 }).success,
    ).toBe(false);
    expect(
      HashtagInsightSchema.safeParse({
        name: "x",
        videoCount: 1,
        techniqueDistribution: { weird: 1.5 },
      }).success,
    ).toBe(false);
  });

  it("preserves extra fields via passthrough (forward-compat)", () => {
    const r = HashtagInsightSchema.parse({
      name: "x",
      videoCount: 1,
      futureField: "preserved",
    });
    expect((r as Record<string, unknown>).futureField).toBe("preserved");
  });
});

describe("BgmInsightSchema", () => {
  it("name is z.string() not enum (allows arbitrary BGM titles)", () => {
    const r = BgmInsightSchema.safeParse({
      name: "Some Wild Title - Artist 🌅 (Remix)",
      hitCount: 5,
    });
    expect(r.success).toBe(true);
  });

  it("trending field is nullable + optional (Gemini sometimes omits)", () => {
    expect(BgmInsightSchema.safeParse({ name: "x", hitCount: 1 }).success).toBe(true);
    expect(
      BgmInsightSchema.safeParse({ name: "x", hitCount: 1, trending: null }).success,
    ).toBe(true);
    expect(
      BgmInsightSchema.safeParse({ name: "x", hitCount: 1, trending: true }).success,
    ).toBe(true);
  });
});

describe("EventInsightSchema", () => {
  it("name is z.string() so the dictionary can grow without a schema bump", () => {
    const r = EventInsightSchema.safeParse({
      name: "novel_event_2027",
      displayName: "Novel Event",
      matchedVideoCount: 3,
    });
    expect(r.success).toBe(true);
  });
});

describe("VelocityInsightSchema", () => {
  it("trend enum rejects unknown values (computed, not LLM)", () => {
    const r = VelocityInsightSchema.safeParse({
      techniqueWoW: {},
      bgmWoW: [{ name: "x", trend: "wat", deltaHits: 0 }],
      eventWoW: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts all four bgm trend tags + three event trend tags", () => {
    const r = VelocityInsightSchema.safeParse({
      techniqueWoW: { push_in: 0.15 },
      bgmWoW: [
        { name: "a", trend: "rising", deltaHits: 5 },
        { name: "b", trend: "stable", deltaHits: 0 },
        { name: "c", trend: "falling", deltaHits: -3 },
        { name: "d", trend: "new", deltaHits: 10 },
      ],
      eventWoW: [
        { name: "x", trend: "new" },
        { name: "y", trend: "stable" },
        { name: "z", trend: "ended" },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("TrendingInsightSchema (top-level)", () => {
  function fullInsight(): TrendingInsight {
    return {
      week: "2026-W20",
      capturedAt: "2026-05-14T08:00:00Z",
      hashtagInsights: [],
      bgmInsights: [],
      eventInsights: [],
      velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
      totalEnriched: 0,
    };
  }

  it("parses a minimum-fields insight", () => {
    const r = TrendingInsightSchema.safeParse(fullInsight());
    expect(r.success).toBe(true);
  });

  it("preserves extra top-level fields via passthrough (forward-compat)", () => {
    const r = TrendingInsightSchema.parse({
      ...fullInsight(),
      experimental: { metaScore: 42 },
    });
    expect((r as Record<string, unknown>).experimental).toEqual({
      metaScore: 42,
    });
  });

  it("emptyInsight() produces a schema-valid stub", () => {
    const r = TrendingInsightSchema.safeParse(emptyInsight("2026-W21"));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.week).toBe("2026-W21");
      expect(r.data.totalEnriched).toBe(0);
      expect(r.data.velocity.techniqueWoW).toEqual({});
    }
  });
});

describe("TrendingSnapshotSchema (v1 → v2 forward-compat — critical)", () => {
  const baseAnchors = {
    week: "2026-W20",
    videos: [{ id: "tt-1", views: 1000 }],
  };

  it("parses a v1 snapshot (schemaVersion=1, no insight field)", () => {
    const r = TrendingSnapshotSchema.safeParse({
      ...baseAnchors,
      schemaVersion: 1,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.insight).toBeUndefined();
    }
  });

  it("parses a v2 snapshot with full insight field", () => {
    const r = TrendingSnapshotSchema.safeParse({
      ...baseAnchors,
      schemaVersion: 2,
      insight: {
        week: "2026-W20",
        capturedAt: "2026-05-14T08:00:00Z",
        hashtagInsights: [],
        bgmInsights: [],
        eventInsights: [],
        velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
        totalEnriched: 0,
      },
    });
    expect(r.success).toBe(true);
  });

  it("parses a v2 snapshot whose insight contains extra fields (passthrough preserved)", () => {
    const parsed = TrendingSnapshotSchema.parse({
      ...baseAnchors,
      schemaVersion: 2,
      insight: {
        week: "2026-W20",
        capturedAt: "now",
        velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
        totalEnriched: 0,
        futureMetric: { score: 0.7 },
      },
    });
    expect(
      (parsed.insight as Record<string, unknown> | undefined)?.futureMetric,
    ).toEqual({ score: 0.7 });
  });

  it("rejects v2 snapshot when insight.velocity.bgmWoW.trend is an unknown enum", () => {
    const r = TrendingSnapshotSchema.safeParse({
      ...baseAnchors,
      schemaVersion: 2,
      insight: {
        week: "2026-W20",
        capturedAt: "now",
        velocity: {
          techniqueWoW: {},
          bgmWoW: [{ name: "x", trend: "definitely_not_a_tag", deltaHits: 0 }],
          eventWoW: [],
        },
        totalEnriched: 0,
      },
    });
    expect(r.success).toBe(false);
  });
});
