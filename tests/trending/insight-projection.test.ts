import { describe, expect, it } from "vitest";
import type { TrendingInsight } from "@/lib/trending/insight-schema";
import {
  projectInsightForBoard,
  type BoardInsightDTO,
} from "@/lib/trending/insight-projection";

function makeInsight(overrides: Partial<TrendingInsight> = {}): TrendingInsight {
  return {
    week: "2026-W20",
    capturedAt: "2026-05-18T07:00:00.000Z",
    hashtagInsights: [],
    bgmInsights: [],
    eventInsights: [],
    velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
    totalEnriched: 0,
    ...overrides,
  };
}

describe("projectInsightForBoard — 降级路径", () => {
  it("insight === undefined → 返 null (v1 老快照场景)", () => {
    expect(projectInsightForBoard(undefined, "all")).toBeNull();
  });

  it("空 insight (无富化数据) → DTO 各 tab 数组为空,不抛", () => {
    const dto = projectInsightForBoard(makeInsight(), "all");
    expect(dto).not.toBeNull();
    expect(dto?.hashtagTab).toEqual([]);
    expect(dto?.techniqueTab).toEqual([]);
    expect(dto?.bgmTab).toEqual([]);
    expect(dto?.eventTab).toEqual([]);
    expect(dto?.velocityTab).toEqual({
      techniqueWoW: {},
      bgmWoW: [],
      eventWoW: [],
    });
  });
});

describe("projectInsightForBoard — 平台过滤", () => {
  const insight = makeInsight({
    hashtagInsights: [
      {
        name: "#fyp",
        videoCount: 5,
        techniqueDistribution: { push_in: 0.6, match_cut: 0.4 },
        avgDensity: 42,
        topVideoIds: ["v1", "v2"],
      },
    ],
  });

  it("platform=tiktok → hashtagTab 透传 TT 数据", () => {
    const dto = projectInsightForBoard(insight, "tiktok");
    expect(dto?.hashtagTab).toHaveLength(1);
    expect(dto?.hashtagTab[0]?.name).toBe("#fyp");
  });

  it("platform=all → hashtagTab 透传", () => {
    const dto = projectInsightForBoard(insight, "all");
    expect(dto?.hashtagTab).toHaveLength(1);
  });

  it("platform=instagram → hashtagTab 空 (HashtagInsight 为 TT 独占源)", () => {
    const dto = projectInsightForBoard(insight, "instagram");
    expect(dto?.hashtagTab).toEqual([]);
    // 其他 tab 不受 platform 影响:即使 hashtagInsights 非空,techniqueTab 仍按
    // 加权聚合产出 (techniqueTab 没有 platform 概念,share 是全局技法分布)。
    expect(dto?.techniqueTab.map((e) => e.technique).sort()).toEqual([
      "match_cut",
      "push_in",
    ]);
    expect(dto?.bgmTab).toEqual([]);
    expect(dto?.eventTab).toEqual([]);
  });
});

describe("projectInsightForBoard — techniqueTab 聚合", () => {
  it("按 hashtag videoCount 加权汇总 technique share,sum ≈ 1", () => {
    const insight = makeInsight({
      hashtagInsights: [
        {
          name: "#a",
          videoCount: 4,
          techniqueDistribution: { push_in: 0.5, match_cut: 0.5 },
          avgDensity: 30,
          topVideoIds: [],
        },
        {
          name: "#b",
          videoCount: 1,
          techniqueDistribution: { push_in: 1.0 },
          avgDensity: 50,
          topVideoIds: [],
        },
      ],
    });
    const dto = projectInsightForBoard(insight, "all");
    const totalShare = dto!.techniqueTab.reduce((s, e) => s + e.share, 0);
    expect(totalShare).toBeCloseTo(1.0, 4);
    // 4 个 a-vid + 1 个 b-vid:push_in = (0.5*4 + 1.0*1)/5 = 0.6,match_cut = (0.5*4 + 0)/5 = 0.4
    const pushIn = dto!.techniqueTab.find((e) => e.technique === "push_in");
    const matchCut = dto!.techniqueTab.find((e) => e.technique === "match_cut");
    expect(pushIn?.share).toBeCloseTo(0.6, 4);
    expect(matchCut?.share).toBeCloseTo(0.4, 4);
  });

  it("techniqueTab 按 share 降序排", () => {
    const insight = makeInsight({
      hashtagInsights: [
        {
          name: "#a",
          videoCount: 10,
          techniqueDistribution: { push_in: 0.2, match_cut: 0.5, j_cut: 0.3 },
          avgDensity: 40,
          topVideoIds: [],
        },
      ],
    });
    const dto = projectInsightForBoard(insight, "all");
    const shares = dto!.techniqueTab.map((e) => e.share);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    expect(dto!.techniqueTab[0]?.technique).toBe("match_cut");
  });

  it("velocity.techniqueWoW 为空 (无 prev 数据) → 所有 trend = new", () => {
    const insight = makeInsight({
      hashtagInsights: [
        {
          name: "#a",
          videoCount: 1,
          techniqueDistribution: { push_in: 1.0 },
          avgDensity: 50,
          topVideoIds: [],
        },
      ],
      velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
    });
    const dto = projectInsightForBoard(insight, "all");
    expect(dto!.techniqueTab[0]?.trend).toBe("new");
  });

  it("trend 阈值: delta > 0.05 → rising; delta < -0.05 → falling; 范围内 → stable", () => {
    const insight = makeInsight({
      hashtagInsights: [
        {
          name: "#a",
          videoCount: 1,
          techniqueDistribution: { rising_t: 0.4, stable_t: 0.3, falling_t: 0.3 },
          avgDensity: 0,
          topVideoIds: [],
        },
      ],
      velocity: {
        techniqueWoW: { rising_t: 0.12, stable_t: 0.02, falling_t: -0.1 },
        bgmWoW: [],
        eventWoW: [],
      },
    });
    const dto = projectInsightForBoard(insight, "all");
    const byTech = Object.fromEntries(
      dto!.techniqueTab.map((e) => [e.technique, e.trend]),
    );
    expect(byTech.rising_t).toBe("rising");
    expect(byTech.stable_t).toBe("stable");
    expect(byTech.falling_t).toBe("falling");
  });

  it("velocity 有数据但 technique 不在 WoW → trend = new (本周新出现)", () => {
    const insight = makeInsight({
      hashtagInsights: [
        {
          name: "#a",
          videoCount: 1,
          techniqueDistribution: { brand_new: 1.0 },
          avgDensity: 0,
          topVideoIds: [],
        },
      ],
      velocity: {
        techniqueWoW: { existing_t: 0.1 },
        bgmWoW: [],
        eventWoW: [],
      },
    });
    const dto = projectInsightForBoard(insight, "all");
    expect(dto!.techniqueTab[0]?.trend).toBe("new");
  });
});

describe("projectInsightForBoard — bgmTab 限流 + trend join", () => {
  it("超出 10 条只取前 10", () => {
    const bgmInsights = Array.from({ length: 15 }, (_, i) => ({
      name: `bgm-${i}`,
      hitCount: 15 - i,
      hitVideoIds: [],
      trending: null,
    }));
    const dto = projectInsightForBoard(makeInsight({ bgmInsights }), "all");
    expect(dto!.bgmTab).toHaveLength(10);
    expect(dto!.bgmTab[0]?.name).toBe("bgm-0");
    expect(dto!.bgmTab[9]?.name).toBe("bgm-9");
  });

  it("velocity.bgmWoW 按 name join trend; 不在 velocity 中的不带 trend 字段", () => {
    const insight = makeInsight({
      bgmInsights: [
        { name: "BGM-A", hitCount: 5, hitVideoIds: [], trending: true },
        { name: "BGM-B", hitCount: 3, hitVideoIds: [] }, // 无 trending 字段
      ],
      velocity: {
        techniqueWoW: {},
        bgmWoW: [{ name: "BGM-A", trend: "rising", deltaHits: 3 }],
        eventWoW: [],
      },
    });
    const dto = projectInsightForBoard(insight, "all");
    const a = dto!.bgmTab.find((b) => b.name === "BGM-A");
    const b = dto!.bgmTab.find((b) => b.name === "BGM-B");
    expect(a?.trend).toBe("rising");
    expect(a?.trending).toBe(true);
    expect(b?.trend).toBeUndefined();
    expect(b?.trending).toBeUndefined();
  });

  it("trending=null (Gemini 显式标过非trend) 保留 null,不被吞", () => {
    const insight = makeInsight({
      bgmInsights: [
        { name: "BGM-C", hitCount: 2, hitVideoIds: [], trending: null },
      ],
    });
    const dto = projectInsightForBoard(insight, "all");
    expect(dto!.bgmTab[0]?.trending).toBeNull();
  });
});

describe("projectInsightForBoard — eventTab 投影", () => {
  it("剥离 sampleVideoIds; 透传 displayName / matchedHashtags / matchedVideoCount", () => {
    const insight = makeInsight({
      eventInsights: [
        {
          name: "met_gala",
          displayName: "Met Gala 2026",
          matchedHashtags: ["#metgala", "#metgala2026"],
          matchedVideoCount: 8,
          sampleVideoIds: ["v1", "v2", "v3"],
        },
      ],
    });
    const dto = projectInsightForBoard(insight, "all");
    const e = dto!.eventTab[0]!;
    expect(e.name).toBe("met_gala");
    expect(e.displayName).toBe("Met Gala 2026");
    expect(e.matchedHashtags).toEqual(["#metgala", "#metgala2026"]);
    expect(e.matchedVideoCount).toBe(8);
    expect(e).not.toHaveProperty("sampleVideoIds");
  });
});

describe("projectInsightForBoard — velocityTab 浅拷贝防 mutation", () => {
  it("透传 velocity 等值,但是新对象 (浅拷贝防 RSC 跨调用 mutation)", () => {
    const velocity = {
      techniqueWoW: { push_in: 0.05 },
      bgmWoW: [{ name: "X", trend: "stable" as const, deltaHits: 0 }],
      eventWoW: [{ name: "Y", trend: "new" as const }],
    };
    const dto: BoardInsightDTO | null = projectInsightForBoard(
      makeInsight({ velocity }),
      "all",
    );
    expect(dto!.velocityTab).toEqual(velocity);
    expect(dto!.velocityTab).not.toBe(velocity);
    expect(dto!.velocityTab.bgmWoW).not.toBe(velocity.bgmWoW);
    expect(dto!.velocityTab.eventWoW).not.toBe(velocity.eventWoW);
    expect(dto!.velocityTab.techniqueWoW).not.toBe(velocity.techniqueWoW);
  });

  it("同一 insight 多次投影 → 两次 dto 修改互不污染 (RSC 多调用安全)", () => {
    const insight = makeInsight({
      velocity: {
        techniqueWoW: {},
        bgmWoW: [{ name: "X", trend: "rising", deltaHits: 5 }],
        eventWoW: [],
      },
    });
    const dtoA = projectInsightForBoard(insight, "tiktok")!;
    const dtoB = projectInsightForBoard(insight, "instagram")!;
    // 模拟 A 被下游 mutate
    dtoA.velocityTab.bgmWoW.push({ name: "polluted", trend: "new", deltaHits: 0 });
    expect(dtoB.velocityTab.bgmWoW).toHaveLength(1);
    expect(dtoB.velocityTab.bgmWoW[0]?.name).toBe("X");
    // 也确认底层 insight 不被污染
    expect(insight.velocity.bgmWoW).toHaveLength(1);
  });

  it("EventTrend 类型收窄:eventWoW[].trend 不含 rising/falling,只 new|stable|ended", () => {
    // 类型层断言:如果 BoardVelocityTab.eventWoW[].trend 不收窄,这段编译会报错
    const insight = makeInsight({
      velocity: {
        techniqueWoW: {},
        bgmWoW: [],
        eventWoW: [
          { name: "e1", trend: "new" },
          { name: "e2", trend: "stable" },
          { name: "e3", trend: "ended" },
        ],
      },
    });
    const dto = projectInsightForBoard(insight, "all");
    const trends = dto!.velocityTab.eventWoW.map((w) => w.trend);
    expect(trends).toEqual(["new", "stable", "ended"]);
  });
});
