import { describe, expect, it } from "vitest";
import { computeVelocity } from "@/lib/trending/velocity";
import { TRENDING_SCHEMA_VERSION, type TrendingSnapshot } from "@/lib/trending/types";
import type { ViralVideo } from "@/lib/review-engine/types";

function vid(id: string, views: number): ViralVideo {
  return {
    id,
    platform: "tiktok",
    url: `https://www.tiktok.com/@u/video/${id}`,
    cover: "",
    title: id,
    description: "",
    topic: "Travel",
    tags: [],
    views,
    likes: 0,
    comments: 0,
    shares: 0,
    duration: 20,
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "h",
    bgm: "b",
    authorHandle: "@u",
    publishedAt: "2026-05-01",
  };
}

function snapshot(week: string, videos: ViralVideo[], over: Partial<TrendingSnapshot> = {}): TrendingSnapshot {
  return {
    schemaVersion: TRENDING_SCHEMA_VERSION,
    week,
    capturedAt: `${week}-captured`,
    videos,
    meta: {
      tiktok: { source: "trends-actor", actorRun: "r1", rawCount: videos.length, enrichedCount: videos.length, ok: true },
      instagram: { source: "hashtag-proxy", actorRun: "r2", rawCount: 0, enrichedCount: 0, ok: true },
      partial: false,
    },
    ...over,
  };
}

describe("computeVelocity", () => {
  it("marks every video NEW when previous snapshot is null", () => {
    const cur = snapshot("2026-W20", [vid("a", 1000), vid("b", 500)]);
    const result = computeVelocity(cur, null);
    expect(result).toHaveLength(2);
    expect(result.every((v) => v.velocity.trend === "new")).toBe(true);
    expect(result.every((v) => v.velocity.weekOverWeek === null)).toBe(true);
    expect(result.every((v) => v.velocity.rank.previous === null)).toBe(true);
  });

  it("marks every video NEW when previous schemaVersion mismatches", () => {
    const cur = snapshot("2026-W20", [vid("a", 1000)]);
    const prev = snapshot("2026-W19", [vid("a", 800)], {
      schemaVersion: 99 as unknown as typeof TRENDING_SCHEMA_VERSION,
    });
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.trend).toBe("new");
    expect(result[0].velocity.weekOverWeek).toBeNull();
  });

  it("marks every video NEW when previous snapshot has no schemaVersion field", () => {
    // 旧快照可能完全没有 schemaVersion 字段(undefined) —— 也当作"无上周"
    const cur = snapshot("2026-W20", [vid("a", 1000)]);
    const prev = snapshot("2026-W19", [vid("a", 800)], {
      schemaVersion: undefined as unknown as typeof TRENDING_SCHEMA_VERSION,
    });
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.trend).toBe("new");
    expect(result[0].velocity.weekOverWeek).toBeNull();
  });

  it("computes rising trend when views grow >5%", () => {
    const cur = snapshot("2026-W20", [vid("a", 1500)]);
    const prev = snapshot("2026-W19", [vid("a", 1000)]);
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.weekOverWeek).toBeCloseTo(0.5);
    expect(result[0].velocity.trend).toBe("rising");
  });

  it("computes falling trend when views drop >5%", () => {
    const cur = snapshot("2026-W20", [vid("a", 800)]);
    const prev = snapshot("2026-W19", [vid("a", 1000)]);
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.weekOverWeek).toBeCloseTo(-0.2);
    expect(result[0].velocity.trend).toBe("falling");
  });

  it("computes stable trend when views change <=5%", () => {
    const cur = snapshot("2026-W20", [vid("a", 1020)]);
    const prev = snapshot("2026-W19", [vid("a", 1000)]);
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.trend).toBe("stable");
  });

  it("marks a video NEW when it is absent from previous snapshot", () => {
    const cur = snapshot("2026-W20", [vid("a", 1000), vid("newbie", 900)]);
    const prev = snapshot("2026-W19", [vid("a", 800)]);
    const result = computeVelocity(cur, prev);
    const newbie = result.find((v) => v.id === "newbie")!;
    expect(newbie.velocity.trend).toBe("new");
    expect(newbie.velocity.weekOverWeek).toBeNull();
  });

  it("tracks rank movement (current index vs previous index, sorted by views desc)", () => {
    // 上周: a(1000) #0, b(900) #1 —— 本周 b(2000) #0, a(1000) #1
    const cur = snapshot("2026-W20", [vid("b", 2000), vid("a", 1000)]);
    const prev = snapshot("2026-W19", [vid("a", 1000), vid("b", 900)]);
    const result = computeVelocity(cur, prev);
    const b = result.find((v) => v.id === "b")!;
    expect(b.velocity.rank.current).toBe(0);
    expect(b.velocity.rank.previous).toBe(1);
  });

  it("sorts output by current views descending", () => {
    const cur = snapshot("2026-W20", [vid("low", 100), vid("high", 9000)]);
    const result = computeVelocity(cur, null);
    expect(result[0].id).toBe("high");
    expect(result[1].id).toBe("low");
  });

  it("marks a video stable (not new) when present in previous but prevViews was 0", () => {
    const cur = snapshot("2026-W20", [vid("a", 5000)]);
    const prev = snapshot("2026-W19", [vid("a", 0)]);
    const result = computeVelocity(cur, prev);
    expect(result[0].velocity.trend).toBe("stable");
    expect(result[0].velocity.weekOverWeek).toBeNull();
    expect(result[0].velocity.rank.previous).toBe(0);
  });
});
