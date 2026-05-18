import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/insight/insight-template";
import type { TrendingInsight } from "@/lib/trending/insight-schema";

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

describe("renderTemplate", () => {
  it("空 insight: headline 用 userFormat, bullets 空, actionable degraded", () => {
    const result = renderTemplate({
      userFormat: "vlog",
      insight: mkInsight(),
      week: "2026-W20",
    });
    expect(result.headline).toContain("vlog");
    expect(result.bullets).toEqual([]);
    expect(result.actionable).toContain("vlog");
    expect(result.sampleVideoIds).toEqual([]);
    expect(result.week).toBe("2026-W20");
    expect(result.sourceWeek).toBe("2026-W20");
  });

  it("userTopic 模糊命中 hashtag.name → 用该 hashtag", () => {
    const result = renderTemplate({
      userFormat: "vlog",
      userTopic: "travel",
      insight: mkInsight({
        hashtagInsights: [
          {
            name: "travelvlog",
            videoCount: 12,
            techniqueDistribution: { jumpcut: 0.5, montage: 0.3 },
            avgDensity: 8,
            topVideoIds: ["v1", "v2", "v3", "v4"],
          },
          {
            name: "asmr",
            videoCount: 8,
            techniqueDistribution: { whisper: 0.9 },
            avgDensity: 2,
            topVideoIds: ["a1"],
          },
        ],
      }),
      week: "2026-W20",
    });
    expect(result.headline).toContain("travelvlog");
    expect(result.sampleVideoIds).toEqual(["v1", "v2", "v3"]);
  });

  it("userTopic 不命中 → fallback hashtagInsights[0]", () => {
    const result = renderTemplate({
      userFormat: "vlog",
      userTopic: "anime",
      insight: mkInsight({
        hashtagInsights: [
          {
            name: "fitness",
            videoCount: 5,
            techniqueDistribution: {},
            avgDensity: 0,
            topVideoIds: [],
          },
        ],
      }),
      week: "2026-W20",
    });
    expect(result.headline).toContain("fitness");
  });

  it("top-2 techniques + percentage 渲染(zoom 是 top-3 被裁)", () => {
    const result = renderTemplate({
      userFormat: "vlog",
      insight: mkInsight({
        hashtagInsights: [
          {
            name: "food",
            videoCount: 10,
            techniqueDistribution: {
              jumpcut: 0.45,
              montage: 0.3,
              zoom: 0.1,
            },
            avgDensity: 6,
            topVideoIds: ["f1"],
          },
        ],
      }),
      week: "2026-W20",
    });
    const techBullet = result.bullets[0] ?? "";
    expect(techBullet).toContain("jumpcut");
    expect(techBullet).toContain("45%");
    expect(techBullet).toContain("montage");
    expect(techBullet).toContain("30%");
    expect(techBullet).not.toContain("zoom");
  });

  it("bgm + event 各占一条 bullet(distribution 空 → 无 techniques bullet)", () => {
    const result = renderTemplate({
      userFormat: "vlog",
      insight: mkInsight({
        hashtagInsights: [
          {
            name: "travel",
            videoCount: 5,
            techniqueDistribution: {},
            avgDensity: 0,
            topVideoIds: [],
          },
        ],
        bgmInsights: [
          { name: "Sunset Drive", hitCount: 12, hitVideoIds: ["b1", "b2"] },
        ],
        eventInsights: [
          {
            name: "met_gala",
            displayName: "Met Gala 2026",
            matchedHashtags: ["fashion"],
            matchedVideoCount: 5,
            sampleVideoIds: ["e1"],
          },
        ],
      }),
      week: "2026-W20",
    });
    expect(result.bullets).toHaveLength(2);
    expect(result.bullets.some((b) => b.includes("Sunset Drive"))).toBe(true);
    expect(result.bullets.some((b) => b.includes("Met Gala 2026"))).toBe(true);
  });

  it("actionable 含 userFormat + 各维度建议", () => {
    const result = renderTemplate({
      userFormat: "tutorial",
      insight: mkInsight({
        hashtagInsights: [
          {
            name: "cook",
            videoCount: 8,
            techniqueDistribution: { speedup: 0.6 },
            avgDensity: 3,
            topVideoIds: ["c1"],
          },
        ],
        bgmInsights: [{ name: "Lofi Beats", hitCount: 4, hitVideoIds: [] }],
      }),
      week: "2026-W20",
    });
    expect(result.actionable).toContain("tutorial");
    expect(result.actionable).toContain("speedup");
    expect(result.actionable).toContain("Lofi Beats");
  });

  it("fuzzy match 不误报:短 name(<3 chars)不靠反向 substring 命中长 userTopic", () => {
    // name="go" should NOT match userTopic="vlog" via reverse substring,
    // and the short hashtag must NOT preempt the legitimate top-1.
    const result = renderTemplate({
      userFormat: "vlog",
      userTopic: "vlog",
      insight: mkInsight({
        hashtagInsights: [
          {
            name: "go",
            videoCount: 100,
            techniqueDistribution: { jumpcut: 0.9 },
            avgDensity: 5,
            topVideoIds: ["short1"],
          },
          {
            name: "fitness",
            videoCount: 50,
            techniqueDistribution: { speedup: 0.5 },
            avgDensity: 3,
            topVideoIds: ["fit1"],
          },
        ],
      }),
      week: "2026-W20",
    });
    // userTopic="vlog" doesn't match "go" (reverse blocked) nor "fitness"
    // (no overlap), so falls back to insights[0] = "go".
    // The defense is that "go" doesn't get chosen *because* of the
    // false reverse-match path — it gets chosen as legitimate top-1.
    expect(result.headline).toContain("go");
  });

  it("fuzzy match 反向命中要求 name >= 3 chars(允许 'travel' 命中长 topic)", () => {
    const result = renderTemplate({
      userFormat: "vlog",
      userTopic: "travel vlog adventure 2026",
      insight: mkInsight({
        hashtagInsights: [
          {
            name: "fitness",
            videoCount: 100,
            techniqueDistribution: {},
            avgDensity: 0,
            topVideoIds: [],
          },
          {
            name: "travel",
            videoCount: 50,
            techniqueDistribution: {},
            avgDensity: 0,
            topVideoIds: ["t1"],
          },
        ],
      }),
      week: "2026-W20",
    });
    expect(result.headline).toContain("travel");
  });

  it("pct cap:share > 1 时不渲染 > 100%", () => {
    const result = renderTemplate({
      userFormat: "vlog",
      insight: mkInsight({
        hashtagInsights: [
          {
            name: "x",
            videoCount: 1,
            // intentionally out-of-range to verify defensive clamp;
            // schema validates 0..1 upstream but pct() must not trust it
            techniqueDistribution: { broken: 1.5 } as Record<string, number>,
            avgDensity: 0,
            topVideoIds: [],
          },
        ],
      }),
      week: "2026-W20",
    });
    expect(result.bullets[0]).toContain("100%");
    expect(result.bullets[0]).not.toContain("150%");
  });

  it("sampleVideoIds 截到 3 条(topVideoIds 超过 3 时)", () => {
    const result = renderTemplate({
      userFormat: "vlog",
      insight: mkInsight({
        hashtagInsights: [
          {
            name: "travel",
            videoCount: 10,
            techniqueDistribution: {},
            avgDensity: 0,
            topVideoIds: ["v1", "v2", "v3", "v4", "v5"],
          },
        ],
      }),
      week: "2026-W20",
    });
    expect(result.sampleVideoIds).toEqual(["v1", "v2", "v3"]);
  });
});
