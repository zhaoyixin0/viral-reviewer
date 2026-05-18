import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";
import type { TrendingHashtag } from "@/lib/trending/types";

const scrapeTikTokTrendingHashtagsMock = vi.fn();
const scrapeTikTokByHashtagMock = vi.fn();
const scrapeInstagramByHashtagMock = vi.fn();
const enrichBatchMock = vi.fn();
const classifyTopicsMock = vi.fn();
const loadVideosMock = vi.fn();

vi.mock("@/lib/apify/scrapers", () => ({
  scrapeTikTokTrendingHashtags: (...a: unknown[]) => scrapeTikTokTrendingHashtagsMock(...a),
  scrapeTikTokByHashtag: (...a: unknown[]) => scrapeTikTokByHashtagMock(...a),
  scrapeInstagramByHashtag: (...a: unknown[]) => scrapeInstagramByHashtagMock(...a),
}));
vi.mock("@/lib/research/enrich-one", () => ({
  enrichBatch: (...a: unknown[]) => enrichBatchMock(...a),
}));
vi.mock("@/lib/trending/topic-classifier", () => ({
  classifyTopics: (...a: unknown[]) => classifyTopicsMock(...a),
}));
vi.mock("@/lib/data/load-videos", () => ({
  loadVideos: (...a: unknown[]) => loadVideosMock(...a),
}));

import { fetchTrendingSnapshot } from "@/lib/trending/fetch";

function vid(id: string, platform: "tiktok" | "instagram"): ViralVideo {
  return {
    id, platform,
    url: `https://x/${id}`, cover: "", title: id, description: "",
    topic: "", tags: [], views: 1000, likes: 1, comments: 1, shares: 1,
    duration: 20, playStyle: "未分类", visualStyle: "未分类", hook: "h",
    bgm: "b", authorHandle: "@u", publishedAt: "2026-05-01",
  };
}
function ht(name: string, rank: number): TrendingHashtag {
  return { name, rank, viewCount: 1000, videoCount: 10, rankDiff: 0, isNew: false };
}

beforeEach(() => {
  scrapeTikTokTrendingHashtagsMock.mockReset();
  scrapeTikTokByHashtagMock.mockReset();
  scrapeInstagramByHashtagMock.mockReset();
  enrichBatchMock.mockReset();
  classifyTopicsMock.mockReset();
  loadVideosMock.mockReset();
  loadVideosMock.mockResolvedValue([{ topic: "早餐健身" }, { topic: "旅行 vlog" }]);
  // enrich / classify 默认透传(保留 trendingContext 等字段)
  enrichBatchMock.mockImplementation((vs: ViralVideo[]) => Promise.resolve(vs));
  classifyTopicsMock.mockImplementation((vs: ViralVideo[]) => Promise.resolve(vs));
  // 默认:Stage 1 给 2 个 hashtag,Stage 2 每个 hashtag 给 1 条视频,IG 给 1 条
  scrapeTikTokTrendingHashtagsMock.mockResolvedValue({
    hashtags: [ht("morningroutine", 1), ht("glowup", 2)],
    runId: "run-stage1",
  });
  scrapeTikTokByHashtagMock.mockImplementation((opts: { hashtags: string[] }) =>
    Promise.resolve([vid(`tt-${opts.hashtags[0]}`, "tiktok")]),
  );
  scrapeInstagramByHashtagMock.mockResolvedValue([vid("ig1", "instagram")]);
});

describe("fetchTrendingSnapshot (two-stage TikTok)", () => {
  it("produces a snapshot with trendingHashtags + merged videos", async () => {
    const snap = await fetchTrendingSnapshot();
    expect(snap.schemaVersion).toBe(2);
    expect(snap.trendingHashtags.map((h) => h.name)).toEqual(["morningroutine", "glowup"]);
    // 2 TT 视频(每 hashtag 1 条)+ 1 IG 视频
    expect(snap.videos).toHaveLength(3);
    expect(snap.meta.tiktok.ok).toBe(true);
    expect(snap.meta.tiktok.source).toBe("trends-actor");
    expect(snap.meta.instagram.ok).toBe(true);
    expect(snap.meta.partial).toBe(false);
  });

  it("tags each TikTok video with trendingContext (hashtag + rank)", async () => {
    const snap = await fetchTrendingSnapshot();
    const ttVideo = snap.videos.find((v) => v.id === "tt-morningroutine")!;
    expect(ttVideo.trendingContext).toEqual({ hashtag: "morningroutine", hashtagRank: 1 });
    // IG 视频不带 trendingContext
    const igVideo = snap.videos.find((v) => v.id === "ig1")!;
    expect(igVideo.trendingContext).toBeUndefined();
  });

  it("first-lock by rank: a video under multiple hashtags keeps the highest-rank one", async () => {
    // morningroutine(rank 1)和 glowup(rank 2)都返回同一条 shared 视频
    scrapeTikTokByHashtagMock.mockImplementation(() =>
      Promise.resolve([vid("tt-shared", "tiktok")]),
    );
    const snap = await fetchTrendingSnapshot();
    const shared = snap.videos.filter((v) => v.id === "tt-shared");
    expect(shared).toHaveLength(1); // 去重
    expect(shared[0].trendingContext).toEqual({ hashtag: "morningroutine", hashtagRank: 1 });
  });

  it("Stage 1 fails → tiktok.ok=false, trendingHashtags=[], IG still continues", async () => {
    scrapeTikTokTrendingHashtagsMock.mockRejectedValue(new Error("stage1 down"));
    const snap = await fetchTrendingSnapshot();
    expect(snap.meta.tiktok.ok).toBe(false);
    expect(snap.trendingHashtags).toEqual([]);
    expect(snap.meta.instagram.ok).toBe(true);
    expect(snap.meta.partial).toBe(true);
    expect(snap.videos.map((v) => v.id)).toEqual(["ig1"]);
    expect(scrapeTikTokByHashtagMock).not.toHaveBeenCalled();
  });

  it("Stage 1 ok but ALL Stage 2 hashtags fail → tiktok.ok=false (architect H2)", async () => {
    // Stage 1 给了 hashtag,但每个 hashtag 的 Stage 2 抓取都抛错 → 0 视频
    scrapeTikTokByHashtagMock.mockRejectedValue(new Error("stage2 down"));
    const snap = await fetchTrendingSnapshot();
    expect(snap.meta.tiktok.ok).toBe(false);   // 不能是"成功但 0 视频"的假成功
    expect(snap.meta.partial).toBe(true);
    // trendingHashtags 仍保留(Stage 1 成功的产物)
    expect(snap.trendingHashtags.map((h) => h.name)).toEqual(["morningroutine", "glowup"]);
    // 只剩 IG 视频
    expect(snap.videos.map((v) => v.id)).toEqual(["ig1"]);
  });

  it("throws when BOTH platforms fail (caller must not write an empty snapshot)", async () => {
    scrapeTikTokTrendingHashtagsMock.mockRejectedValue(new Error("tt down"));
    scrapeInstagramByHashtagMock.mockRejectedValue(new Error("ig down"));
    await expect(fetchTrendingSnapshot()).rejects.toThrow(/both platforms failed/i);
  });

  it("passes library topics from loadVideos into the classifier", async () => {
    await fetchTrendingSnapshot();
    expect(classifyTopicsMock).toHaveBeenCalledTimes(1);
    const [, libraryTopics] = classifyTopicsMock.mock.calls[0];
    expect(libraryTopics).toEqual(["早餐健身", "旅行 vlog"]);
  });
});
