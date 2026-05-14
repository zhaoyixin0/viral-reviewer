import { describe, expect, it } from "vitest";
import { TrendingSnapshotSchema } from "@/lib/trending/types";

const base = {
  schemaVersion: 1,
  week: "2026-W20",
  capturedAt: "2026-05-14T08:00:00Z",
  videos: [{ id: "tt-1", views: 1000 }],
  meta: { tiktok: {}, instagram: {}, partial: false },
};

describe("TrendingSnapshotSchema (v4)", () => {
  it("accepts a snapshot WITH trendingHashtags", () => {
    const r = TrendingSnapshotSchema.safeParse({
      ...base,
      trendingHashtags: [{ name: "morningroutine", rank: 1, viewCount: 9, videoCount: 3, rankDiff: 0, isNew: false }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a snapshot WITHOUT trendingHashtags (old snapshot, optional)", () => {
    const r = TrendingSnapshotSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("rejects a snapshot missing the structural anchors", () => {
    expect(TrendingSnapshotSchema.safeParse({ garbage: true }).success).toBe(false);
  });
});
