import { describe, expect, it } from "vitest";
import { computeHashtagVelocity } from "@/lib/trending/velocity";
import {
  TRENDING_SCHEMA_VERSION,
  type TrendingHashtag,
  type TrendingSnapshot,
} from "@/lib/trending/types";

function ht(name: string, rank: number, viewCount: number): TrendingHashtag {
  return { name, rank, viewCount, videoCount: 10, rankDiff: 0, isNew: false };
}

function snap(
  week: string,
  hashtags: TrendingHashtag[],
  over: Partial<TrendingSnapshot> = {},
): TrendingSnapshot {
  return {
    schemaVersion: TRENDING_SCHEMA_VERSION,
    week,
    capturedAt: `${week}-captured`,
    trendingHashtags: hashtags,
    videos: [],
    meta: {
      tiktok: { source: "trends-actor", actorRun: "r", rawCount: 0, enrichedCount: 0, ok: true },
      instagram: { source: "hashtag-proxy", actorRun: "", rawCount: 0, enrichedCount: 0, ok: true },
      partial: false,
    },
    ...over,
  };
}

describe("computeHashtagVelocity", () => {
  it("marks every hashtag NEW when previous is null", () => {
    const cur = snap("2026-W20", [ht("a", 1, 1000), ht("b", 2, 500)]);
    const result = computeHashtagVelocity(cur, null);
    expect(result).toHaveLength(2);
    expect(result.every((h) => h.velocity.trend === "new")).toBe(true);
    expect(result.every((h) => h.velocity.weekOverWeek === null)).toBe(true);
    expect(result.every((h) => h.velocity.rank.previous === null)).toBe(true);
  });

  it("marks every hashtag NEW when previous schemaVersion mismatches", () => {
    const cur = snap("2026-W20", [ht("a", 1, 1000)]);
    const prev = snap("2026-W19", [ht("a", 1, 800)], {
      schemaVersion: 99 as unknown as typeof TRENDING_SCHEMA_VERSION,
    });
    expect(computeHashtagVelocity(cur, prev)[0].velocity.trend).toBe("new");
  });

  it("computes rising / falling / stable from viewCount week-over-week", () => {
    const prev = snap("2026-W19", [ht("up", 1, 1000), ht("down", 2, 1000), ht("flat", 3, 1000)]);
    const cur = snap("2026-W20", [ht("up", 1, 1500), ht("down", 2, 800), ht("flat", 3, 1010)]);
    const result = computeHashtagVelocity(cur, prev);
    const byName = Object.fromEntries(result.map((h) => [h.name, h.velocity]));
    expect(byName.up.trend).toBe("rising");
    expect(byName.up.weekOverWeek).toBeCloseTo(0.5);
    expect(byName.down.trend).toBe("falling");
    expect(byName.flat.trend).toBe("stable");
  });

  it("matches hashtags by name and tracks rank change", () => {
    const prev = snap("2026-W19", [ht("a", 3, 1000)]);
    const cur = snap("2026-W20", [ht("a", 1, 1100)]);
    const a = computeHashtagVelocity(cur, prev)[0];
    expect(a.velocity.rank).toEqual({ current: 1, previous: 3 });
  });

  it("marks a hashtag NEW when absent from previous", () => {
    const prev = snap("2026-W19", [ht("a", 1, 1000)]);
    const cur = snap("2026-W20", [ht("a", 1, 1000), ht("newbie", 2, 900)]);
    const newbie = computeHashtagVelocity(cur, prev).find((h) => h.name === "newbie")!;
    expect(newbie.velocity.trend).toBe("new");
    expect(newbie.velocity.weekOverWeek).toBeNull();
  });

  it("treats present-but-prev-viewCount-0 as stable, not new", () => {
    const prev = snap("2026-W19", [ht("a", 1, 0)]);
    const cur = snap("2026-W20", [ht("a", 1, 5000)]);
    const a = computeHashtagVelocity(cur, prev)[0];
    expect(a.velocity.trend).toBe("stable");
    expect(a.velocity.weekOverWeek).toBeNull();
    expect(a.velocity.rank.previous).toBe(1);
  });

  it("sorts output by current rank ascending", () => {
    const cur = snap("2026-W20", [ht("third", 3, 1), ht("first", 1, 1), ht("second", 2, 1)]);
    expect(computeHashtagVelocity(cur, null).map((h) => h.name)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});
