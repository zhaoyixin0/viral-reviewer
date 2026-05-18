import { describe, expect, it } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";
import { selectForEnrichment } from "@/lib/trending/select-for-enrichment";

function vid(
  id: string,
  views: number,
  hashtag: string | undefined,
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

describe("selectForEnrichment", () => {
  it("returns top-N per hashtag bucket, sorted by views", () => {
    const r = selectForEnrichment(
      [
        vid("a", 100, "x"), vid("b", 500, "x"), vid("c", 300, "x"), vid("d", 50, "x"),
      ],
      { topPerHashtag: 2, maxTotal: 10 },
    );
    expect(r.map((v) => v.id)).toEqual(["b", "c"]);
  });

  it("processes hashtags in first-seen order (caller's rank order)", () => {
    const r = selectForEnrichment(
      [
        vid("h1-a", 100, "high-rank"),
        vid("h2-a", 999, "low-rank"),
        vid("h1-b", 50, "high-rank"),
      ],
      { topPerHashtag: 1, maxTotal: 10 },
    );
    expect(r.map((v) => v.id)).toEqual(["h1-a", "h2-a"]);
  });

  it("buckets IG videos separately under a synthetic key", () => {
    const r = selectForEnrichment(
      [
        vid("tt", 100, "x"),
        vid("ig1", 200, undefined, "instagram"),
        vid("ig2", 500, undefined, "instagram"),
      ],
      { topPerHashtag: 1, maxTotal: 10 },
    );
    expect(r.map((v) => v.id).sort()).toEqual(["ig2", "tt"]);
  });

  it("caps result at maxTotal across all buckets", () => {
    const buckets = Array.from({ length: 10 }, (_, i) =>
      vid(`v${i}`, 1000 - i, `h${i}`),
    );
    const r = selectForEnrichment(buckets, { topPerHashtag: 1, maxTotal: 3 });
    expect(r).toHaveLength(3);
  });

  it("deduplicates by id even when the same video appears in multiple buckets", () => {
    const dup = vid("shared", 1000, "x");
    const dup2 = { ...dup, trendingContext: { hashtag: "y", hashtagRank: 2 } };
    const r = selectForEnrichment(
      [dup, dup2, vid("other", 500, "x")],
      { topPerHashtag: 2, maxTotal: 10 },
    );
    expect(r.filter((v) => v.id === "shared")).toHaveLength(1);
  });

  it("returns empty when maxTotal is 0", () => {
    expect(selectForEnrichment([vid("a", 1, "x")], { topPerHashtag: 1, maxTotal: 0 })).toEqual([]);
  });

  it("returns empty when topPerHashtag is 0", () => {
    expect(selectForEnrichment([vid("a", 1, "x")], { topPerHashtag: 0, maxTotal: 10 })).toEqual([]);
  });

  it("returns empty on empty input", () => {
    expect(selectForEnrichment([], { topPerHashtag: 3, maxTotal: 15 })).toEqual([]);
  });
});
