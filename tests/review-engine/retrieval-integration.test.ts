import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";

const loadVideosMock = vi.fn();
const inferTopicMock = vi.fn();
const readTopicCacheMock = vi.fn();
const writeTopicCacheMock = vi.fn();
const researchTopicLiveMock = vi.fn();
const readLatestTwoMock = vi.fn();

vi.mock("@/lib/data/load-videos", () => ({
  loadVideos: (...a: unknown[]) => loadVideosMock(...a),
}));
vi.mock("@/lib/research/topic-inference", () => ({
  inferTopic: (...a: unknown[]) => inferTopicMock(...a),
}));
vi.mock("@/lib/topic-cache/blob-cache", () => ({
  readTopicCache: (...a: unknown[]) => readTopicCacheMock(...a),
  writeTopicCache: (...a: unknown[]) => writeTopicCacheMock(...a),
}));
vi.mock("@/lib/research/topic-research", () => ({
  researchTopicLive: (...a: unknown[]) => researchTopicLiveMock(...a),
}));
vi.mock("@/lib/trending/snapshot-store", () => ({
  readLatestTwoSnapshots: (...a: unknown[]) => readLatestTwoMock(...a),
}));

import { retrieveSimilarVideos } from "@/lib/review-engine/retrieval";

function vid(
  id: string,
  topic: string,
  topicConfidence: number | undefined,
  views: number,
): ViralVideo {
  return {
    id, platform: "tiktok", url: `https://x/${id}`, cover: "", title: id,
    description: "", topic, tags: [], views, likes: 1, comments: 1, shares: 1,
    duration: 20, playStyle: "p", visualStyle: "vs", hook: "h", bgm: "b",
    authorHandle: "@u", publishedAt: "2026-05-01",
    ...(topicConfidence === undefined ? {} : { topicConfidence }),
  };
}

function snapshotWith(videos: ViralVideo[]) {
  return {
    schemaVersion: 1, week: "2026-W20", capturedAt: "x", videos,
    trendingHashtags: [],
    meta: { tiktok: {}, instagram: {}, partial: false },
  };
}

beforeEach(() => {
  loadVideosMock.mockReset();
  inferTopicMock.mockReset();
  readTopicCacheMock.mockReset();
  writeTopicCacheMock.mockReset();
  researchTopicLiveMock.mockReset();
  readLatestTwoMock.mockReset();
  // 默认:本地库为空、题材推断为库外、topic-cache miss、live 有结果
  loadVideosMock.mockResolvedValue([]);
  inferTopicMock.mockResolvedValue({ canonicalTopic: "早餐健身", isFromLibrary: false });
  readTopicCacheMock.mockResolvedValue(null);
  researchTopicLiveMock.mockResolvedValue({
    topic: "早餐健身", hashtags: ["fitness"],
    videos: [vid("live1", "早餐健身", undefined, 5000)],
  });
});

describe("retrieveSimilarVideos — snapshot fallback layer", () => {
  it("returns source=snapshot when the trending snapshot has a high-confidence topic match", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snapshotWith([vid("snap1", "早餐健身", 0.9, 8000)]),
      previous: null,
    });
    const result = await retrieveSimilarVideos({ topic: "早餐健身" });
    expect(result.source).toBe("snapshot");
    expect(result.videos.map((v) => v.id)).toContain("snap1");
    expect(researchTopicLiveMock).not.toHaveBeenCalled(); // 命中后不再走 live
  });

  it("falls through to live when the snapshot has no topic match (miss)", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snapshotWith([vid("snap1", "宠物日常", 0.9, 8000)]),
      previous: null,
    });
    const result = await retrieveSimilarVideos({ topic: "早餐健身" });
    expect(result.source).toBe("live");
    expect(researchTopicLiveMock).toHaveBeenCalledTimes(1);
  });

  it("skips low-confidence snapshot videos and falls through to live", async () => {
    readLatestTwoMock.mockResolvedValue({
      current: snapshotWith([vid("lowconf", "早餐健身", 0.2, 8000)]),
      previous: null,
    });
    const result = await retrieveSimilarVideos({ topic: "早餐健身" });
    expect(result.source).toBe("live");
  });

  it("falls through to live when there is no snapshot at all", async () => {
    readLatestTwoMock.mockResolvedValue({ current: null, previous: null });
    const result = await retrieveSimilarVideos({ topic: "早餐健身" });
    expect(result.source).toBe("live");
  });
});
