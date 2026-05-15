import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrendingSnapshot, TrendingHashtag } from "@/lib/trending/types";
import type { ViralVideo } from "@/lib/review-engine/types";

const readLatestTwoMock = vi.fn();
vi.mock("@/lib/trending/snapshot-store", () => ({
  readLatestTwoSnapshots: (...a: unknown[]) => readLatestTwoMock(...a),
}));

import { GET } from "@/app/api/trending/route";

function vid(
  id: string,
  platform: "tiktok" | "instagram",
  views: number,
  trendingContext?: { hashtag: string; hashtagRank: number },
): ViralVideo {
  return {
    id, platform, url: `https://x/${id}`, cover: "c", title: id,
    description: "desc", topic: "Travel", tags: ["#x"], views,
    likes: 1, comments: 1, shares: 1, duration: 20,
    playStyle: "p", visualStyle: "vs", hook: "h", bgm: "b",
    authorHandle: "@u", publishedAt: "2026-05-01",
    ...(trendingContext ? { trendingContext } : {}),
  };
}

function ht(name: string, rank: number): TrendingHashtag {
  return { name, rank, viewCount: 50000, videoCount: 200, rankDiff: 1, isNew: false };
}

function snap(
  week: string,
  videos: ViralVideo[],
  trendingHashtags: TrendingHashtag[] = [],
): TrendingSnapshot {
  return {
    schemaVersion: 1, week, capturedAt: `${week}T08:00:00Z`,
    trendingHashtags,
    videos,
    meta: {
      tiktok: { source: "trends-actor", actorRun: "r", rawCount: videos.length, enrichedCount: videos.length, ok: true },
      instagram: { source: "hashtag-proxy", actorRun: "", rawCount: 0, enrichedCount: 0, ok: true },
      partial: false,
    },
  };
}

beforeEach(() => readLatestTwoMock.mockReset());

describe("GET /api/trending", () => {
  it("returns slim card projection, not the full enriched video", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snap("2026-W20", [vid("a", "tiktok", 9000)]),
      previous: null,
    });
    const res = await GET(new Request("https://x/api/trending"));
    const body = await res.json();
    const card = body.cards[0];
    // 精简投影不含完整富化字段
    expect(card).not.toHaveProperty("description");
    expect(card).not.toHaveProperty("playStyle");
    expect(card).not.toHaveProperty("hook");
    // 含基本卡片字段
    expect(card).toHaveProperty("id");
    expect(card).toHaveProperty("velocity");
  });

  it("card projection includes trendingContext when present on the video", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snap("2026-W20", [
        vid("tt1", "tiktok", 9000, { hashtag: "morningroutine", hashtagRank: 1 }),
        vid("ig1", "instagram", 8000),
      ]),
      previous: null,
    });
    const res = await GET(new Request("https://x/api/trending"));
    const body = await res.json();
    const ttCard = body.cards.find((c: { id: string }) => c.id === "tt1");
    const igCard = body.cards.find((c: { id: string }) => c.id === "ig1");
    expect(ttCard.trendingContext).toEqual({ hashtag: "morningroutine", hashtagRank: 1 });
    expect(igCard.trendingContext).toBeUndefined();
  });

  it("response includes trendingHashtags as slim projection (no rankDiff / industryName)", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snap("2026-W20", [], [ht("morningroutine", 1), ht("glowup", 2)]),
      previous: null,
    });
    const res = await GET(new Request("https://x/api/trending"));
    const body = await res.json();
    expect(body.trendingHashtags).toHaveLength(2);
    const h = body.trendingHashtags[0];
    // 精简投影:只含 name / rank / viewCount / videoCount / velocity
    expect(h).toHaveProperty("name");
    expect(h).toHaveProperty("rank");
    expect(h).toHaveProperty("viewCount");
    expect(h).toHaveProperty("videoCount");
    expect(h).toHaveProperty("velocity");
    // 不含 rankDiff / industryName
    expect(h).not.toHaveProperty("rankDiff");
    expect(h).not.toHaveProperty("industryName");
  });

  it("filters by platform query param", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snap("2026-W20", [vid("tt", "tiktok", 9000), vid("ig", "instagram", 8000)]),
      previous: null,
    });
    const res = await GET(new Request("https://x/api/trending?platform=instagram"));
    const body = await res.json();
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].platform).toBe("instagram");
  });

  it("returns empty cards and trendingHashtags:[] with week=null when no snapshot exists", async () => {
    readLatestTwoMock.mockResolvedValue({ current: null, previous: null });
    const res = await GET(new Request("https://x/api/trending"));
    const body = await res.json();
    expect(body.cards).toEqual([]);
    expect(body.trendingHashtags).toEqual([]);
    expect(body.week).toBeNull();
  });

  it("rejects invalid platform query with 400", async () => {
    // 没有 snapshot 也无所谓 —— schema 校验在 readLatestTwoSnapshots 之前
    const res = await GET(new Request("https://x/api/trending?platform=foo"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_query");
    expect(body.detail).toBeDefined();
    // schema 校验应该在读 snapshot 之前；保证不会被无意中调用
    expect(readLatestTwoMock).not.toHaveBeenCalled();
  });

  it("accepts missing platform (returns all platforms)", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snap("2026-W20", [vid("tt", "tiktok", 9000), vid("ig", "instagram", 8000)]),
      previous: null,
    });
    const res = await GET(new Request("https://x/api/trending"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toHaveLength(2);
  });
});
