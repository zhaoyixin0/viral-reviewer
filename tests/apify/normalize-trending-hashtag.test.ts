import { describe, expect, it } from "vitest";
import { normalizeTikTokTrendingHashtag } from "@/lib/apify/normalize";

// fixture 字段名 = P1.7 probe 实测的 clockworks/tiktok-trends-scraper 真实 raw item
const RAW = {
  id: "7615394994269978635",
  name: "tiktoktvfilmcontest",
  url: "https://www.tiktok.com/tag/tiktoktvfilmcontest",
  rank: 1,
  viewCount: 202_936_112,
  videoCount: 1_234,
  rankDiff: 3,
  markedAsNew: false,
  industryName: "News & Entertainment",
  type: "hashtag",
};

describe("normalizeTikTokTrendingHashtag", () => {
  it("maps a raw trends-scraper item into a TrendingHashtag", () => {
    const h = normalizeTikTokTrendingHashtag(RAW);
    expect(h).not.toBeNull();
    expect(h!.name).toBe("tiktoktvfilmcontest");
    expect(h!.rank).toBe(1);
    expect(h!.viewCount).toBe(202_936_112);
    expect(h!.videoCount).toBe(1_234);
    expect(h!.rankDiff).toBe(3);
    expect(h!.isNew).toBe(false);
    expect(h!.industryName).toBe("News & Entertainment");
  });

  it("returns null when name is missing", () => {
    expect(normalizeTikTokTrendingHashtag({ rank: 1 })).toBeNull();
  });

  it("coerces missing numeric fields to 0 and missing markedAsNew to false", () => {
    const h = normalizeTikTokTrendingHashtag({ name: "x" });
    expect(h).not.toBeNull();
    expect(h!.rank).toBe(0);
    expect(h!.viewCount).toBe(0);
    expect(h!.videoCount).toBe(0);
    expect(h!.rankDiff).toBe(0);
    expect(h!.isNew).toBe(false);
    expect(h!.industryName).toBeUndefined();
  });

  it("coerces non-numeric string fields to 0 (no NaN leaks)", () => {
    const h = normalizeTikTokTrendingHashtag({ name: "x", rank: "N/A", viewCount: "" });
    expect(h).not.toBeNull();
    expect(h!.rank).toBe(0);
    expect(h!.viewCount).toBe(0);
  });
});
