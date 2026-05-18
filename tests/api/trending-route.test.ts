import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  TRENDING_SCHEMA_VERSION,
  type TrendingHashtag,
  type TrendingSnapshot,
} from "@/lib/trending/types";
import type { TrendingInsight } from "@/lib/trending/insight-schema";
import type { ViralVideo } from "@/lib/review-engine/types";
import { _resetBackendForTests } from "@/lib/rate-limit/backend";

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
  insight?: TrendingInsight,
  /** 默认 v2 (current);v1 老快照场景显式传 1 to faithfully simulate pre-L3+ data。 */
  schemaVersion: number = TRENDING_SCHEMA_VERSION,
): TrendingSnapshot {
  return {
    schemaVersion: schemaVersion as typeof TRENDING_SCHEMA_VERSION,
    week,
    capturedAt: `${week}T08:00:00Z`,
    trendingHashtags,
    videos,
    meta: {
      tiktok: { source: "trends-actor", actorRun: "r", rawCount: videos.length, enrichedCount: videos.length, ok: true },
      instagram: { source: "hashtag-proxy", actorRun: "", rawCount: 0, enrichedCount: 0, ok: true },
      partial: false,
    },
    ...(insight ? { insight } : {}),
  };
}

function mkInsight(overrides: Partial<TrendingInsight> = {}): TrendingInsight {
  return {
    week: "2026-W20",
    capturedAt: "2026-05-18T08:00:00Z",
    hashtagInsights: [
      {
        name: "#morningroutine",
        videoCount: 5,
        techniqueDistribution: { push_in: 0.6, match_cut: 0.4 },
        avgDensity: 42,
        topVideoIds: ["v1", "v2"],
      },
    ],
    bgmInsights: [{ name: "BGM-A", hitCount: 3, hitVideoIds: ["v1"], trending: true }],
    eventInsights: [
      {
        name: "met_gala",
        displayName: "Met Gala 2026",
        matchedHashtags: ["#metgala"],
        matchedVideoCount: 5,
        sampleVideoIds: ["v3", "v4"],
      },
    ],
    velocity: {
      techniqueWoW: { push_in: 0.08 },
      bgmWoW: [{ name: "BGM-A", trend: "rising", deltaHits: 2 }],
      eventWoW: [{ name: "met_gala", trend: "new" }],
    },
    totalEnriched: 5,
    ...overrides,
  };
}

beforeEach(() => {
  readLatestTwoMock.mockReset();
  // STRICT_PER_IP 桶 10/1m,跨 case 累积会让 11+ 个 cases 触 429。
  _resetBackendForTests();
});

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
    // T4 C2:无 snapshot → insight:null (前端 T5 隐藏 5 个 insight tab)
    expect(body.insight).toBeNull();
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

  describe("T4 C2 — insight projection field", () => {
    it("v1 老快照 (schemaVersion=1, 无 insight 字段) → response.insight === null", async () => {
      readLatestTwoMock.mockResolvedValue({
        // schemaVersion=1 真实模拟 pre-L3+ 数据;route 不读 schemaVersion 分支,
        // 走的是 insight===undefined → null 降级路径。
        current: snap("2026-W20", [vid("a", "tiktok", 9000)], [], undefined, 1),
        previous: null,
      });
      const res = await GET(new Request("https://x/api/trending"));
      const body = await res.json();
      expect(body.insight).toBeNull();
    });

    it("v2 snapshot 含 insight → response.insight 含 hashtagTab/techniqueTab/bgmTab/eventTab/velocityTab", async () => {
      readLatestTwoMock.mockResolvedValue({
        current: snap("2026-W20", [vid("a", "tiktok", 9000)], [], mkInsight()),
        previous: null,
      });
      const res = await GET(new Request("https://x/api/trending"));
      const body = await res.json();
      expect(body.insight).not.toBeNull();
      expect(body.insight.hashtagTab[0]?.name).toBe("#morningroutine");
      expect(body.insight.techniqueTab.map((t: { technique: string }) => t.technique)).toContain("push_in");
      expect(body.insight.bgmTab[0]?.name).toBe("BGM-A");
      expect(body.insight.bgmTab[0]?.trend).toBe("rising");
      expect(body.insight.eventTab[0]?.displayName).toBe("Met Gala 2026");
      // sampleVideoIds 不应进 board DTO (projection 剥离 internal-only 字段)
      expect(body.insight.eventTab[0]).not.toHaveProperty("sampleVideoIds");
      expect(body.insight.velocityTab.eventWoW[0]?.trend).toBe("new");
    });

    it("platform=instagram + v2 → insight.hashtagTab 为空 (TT 独占源),其他 tab 仍有数据", async () => {
      readLatestTwoMock.mockResolvedValue({
        current: snap(
          "2026-W20",
          [vid("ig", "instagram", 8000)],
          [],
          mkInsight(),
        ),
        previous: null,
      });
      const res = await GET(
        new Request("https://x/api/trending?platform=instagram"),
      );
      const body = await res.json();
      expect(body.insight.hashtagTab).toEqual([]);
      expect(body.insight.techniqueTab.length).toBeGreaterThan(0);
      expect(body.insight.bgmTab.length).toBeGreaterThan(0);
      expect(body.insight.eventTab.length).toBeGreaterThan(0);
    });

    it("platform=tiktok + v2 → insight.hashtagTab 透传 TT 数据", async () => {
      readLatestTwoMock.mockResolvedValue({
        current: snap(
          "2026-W20",
          [vid("tt", "tiktok", 9000)],
          [],
          mkInsight(),
        ),
        previous: null,
      });
      const res = await GET(
        new Request("https://x/api/trending?platform=tiktok"),
      );
      const body = await res.json();
      expect(body.insight.hashtagTab).toHaveLength(1);
      expect(body.insight.hashtagTab[0]?.name).toBe("#morningroutine");
    });
  });
});
