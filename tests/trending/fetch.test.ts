import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";
import type { TrendingHashtag } from "@/lib/trending/types";

const scrapeTikTokTrendingHashtagsMock = vi.fn();
const scrapeTikTokByHashtagMock = vi.fn();
const scrapeInstagramByHashtagMock = vi.fn();
const enrichBatchMock = vi.fn();
const classifyTopicsMock = vi.fn();
const loadVideosMock = vi.fn();
const enrichCutPlanBatchMock = vi.fn();
const detectEventsMock = vi.fn();
const readLatestTwoSnapshotsMock = vi.fn();

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
vi.mock("@/lib/trending/enrich-batch", () => ({
  enrichBatch: (...a: unknown[]) => enrichCutPlanBatchMock(...a),
}));
vi.mock("@/lib/trending/event-detector", () => ({
  detectEvents: (...a: unknown[]) => detectEventsMock(...a),
}));
vi.mock("@/lib/trending/snapshot-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trending/snapshot-store")>(
    "@/lib/trending/snapshot-store",
  );
  return {
    ...actual,
    readLatestTwoSnapshots: (...a: unknown[]) => readLatestTwoSnapshotsMock(...a),
  };
});

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
  enrichCutPlanBatchMock.mockReset();
  detectEventsMock.mockReset();
  readLatestTwoSnapshotsMock.mockReset();
  loadVideosMock.mockResolvedValue([{ topic: "早餐健身" }, { topic: "旅行 vlog" }]);
  // enrich / classify 默认透传(保留 trendingContext 等字段)
  enrichBatchMock.mockImplementation((vs: ViralVideo[]) => Promise.resolve(vs));
  classifyTopicsMock.mockImplementation((vs: ViralVideo[]) => Promise.resolve(vs));
  // L3+ defaults: empty enrichment / events / no previous snapshot.
  enrichCutPlanBatchMock.mockResolvedValue({ plans: [], failures: [] });
  detectEventsMock.mockResolvedValue([]);
  readLatestTwoSnapshotsMock.mockResolvedValue({ current: null, previous: null });
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

describe("fetchTrendingSnapshot — L3+ enrichment pipeline (T3)", () => {
  it("produces v2 snapshot with insight when enrichBatch succeeds", async () => {
    enrichCutPlanBatchMock.mockResolvedValue({
      plans: [
        { video: vid("tt-morningroutine", "tiktok"), cutPlan: { videoId: "tt-morningroutine" } },
      ],
      failures: [],
    });
    // C8 P1b: matchedVideoCount must be >= 3 to survive the aggregate exit filter.
    detectEventsMock.mockResolvedValue([
      { name: "metgala", displayName: "Met Gala", matchedHashtags: ["MetGala"], matchedVideoCount: 4, sampleVideoIds: ["tt-morningroutine"] },
    ]);

    const snap = await fetchTrendingSnapshot();

    expect(snap.schemaVersion).toBe(2);
    expect(snap.insight).toBeDefined();
    expect(snap.insight?.totalEnriched).toBe(1);
    expect(snap.insight?.eventInsights.map((e) => e.name)).toContain("metgala");
  });

  it("still writes snapshot with emptyInsight when enrichBatch fully fails (stage1 not lost)", async () => {
    enrichCutPlanBatchMock.mockResolvedValue({
      plans: [],
      failures: [{ videoId: "x", reason: "gemini_failed: 500" }],
    });

    const snap = await fetchTrendingSnapshot();

    expect(snap.schemaVersion).toBe(2);
    expect(snap.insight).toBeDefined();
    expect(snap.insight?.totalEnriched).toBe(0);
    // stage 1 video data still on snapshot.videos[]
    expect(snap.videos.length).toBeGreaterThan(0);
  });

  it("forwards AbortController signal into enrichBatch and detectEvents", async () => {
    const ctrl = new AbortController();
    await fetchTrendingSnapshot({ signal: ctrl.signal });
    const enrichOpts = enrichCutPlanBatchMock.mock.calls[0][1];
    expect(enrichOpts.signal).toBe(ctrl.signal);
    const detectArg = detectEventsMock.mock.calls[0][0];
    expect(detectArg.signal).toBe(ctrl.signal);
  });

  it("signal already aborted before enrichment → emptyInsight, no enrichBatch call", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const snap = await fetchTrendingSnapshot({ signal: ctrl.signal });
    expect(enrichCutPlanBatchMock).not.toHaveBeenCalled();
    expect(snap.insight?.totalEnriched).toBe(0);
  });

  it("skipEnrichment=true omits insight + skips L3+ entirely", async () => {
    const snap = await fetchTrendingSnapshot({ skipEnrichment: true });
    expect(snap.insight).toBeUndefined();
    expect(enrichCutPlanBatchMock).not.toHaveBeenCalled();
    expect(detectEventsMock).not.toHaveBeenCalled();
  });

  it("skipLLMEventDetection=true passes useLLM=false to detectEvents", async () => {
    await fetchTrendingSnapshot({ skipLLMEventDetection: true });
    expect(detectEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ useLLM: false }),
    );
  });

  it("by default passes useLLM=true to detectEvents (D1=B)", async () => {
    await fetchTrendingSnapshot();
    expect(detectEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ useLLM: true }),
    );
  });

  it("forwards previousSnapshot.insight into aggregate via readLatestTwoSnapshots", async () => {
    readLatestTwoSnapshotsMock.mockResolvedValue({
      current: null,
      previous: {
        schemaVersion: 2,
        week: "2026-W19",
        capturedAt: "2026-05-07T00:00:00Z",
        trendingHashtags: [],
        videos: [],
        meta: {
          tiktok: { source: "trends-actor", actorRun: "r", rawCount: 0, enrichedCount: 0, ok: true },
          instagram: { source: "hashtag-proxy", actorRun: "", rawCount: 0, enrichedCount: 0, ok: true },
          partial: false,
        },
        insight: {
          week: "2026-W19", capturedAt: "2026-05-07T00:00:00Z",
          hashtagInsights: [],
          bgmInsights: [{ name: "Last Week BGM", hitCount: 3, hitVideoIds: [] }],
          eventInsights: [],
          velocity: { techniqueWoW: {}, bgmWoW: [], eventWoW: [] },
          totalEnriched: 3,
        },
      },
    });
    enrichCutPlanBatchMock.mockResolvedValue({
      plans: [
        {
          video: vid("tt-x", "tiktok"),
          cutPlan: {
            videoId: "tt-x",
            density: { editing: 50, transition: 50, effect: 50, bgmSync: 50, overall: 50 },
            bgm: { name: "Last Week BGM", trending: false },
            dimensions: {
              pacing: { shotCount: 1, avgShotDurationSec: 25, cutDensityPerSec: 0, rhythmProfile: null, keyTwistAt: null },
              camera: { dominantMovements: [], shotSizeDistribution: {}, transitionPatterns: [] },
              audiovisual: { bgmPattern: null, bgmSyncTightness: null, subtitleStyle: null, colorGrade: null },
              structure: { hookFormat: null, openingShot: null, endingShot: null, cta: null, payoffAt: null },
            },
          },
        },
      ],
      failures: [],
    });

    const snap = await fetchTrendingSnapshot();
    const wow = snap.insight?.velocity.bgmWoW.find((b) => b.name === "Last Week BGM");
    // 1 hit this week vs 3 hits last week → falling (delta -2, threshold max(1, 3*0.05)=1)
    expect(wow?.trend).toBe("falling");
  });

  it("survives readLatestTwoSnapshots failure (previousInsight=null fallback)", async () => {
    readLatestTwoSnapshotsMock.mockRejectedValue(new Error("blob list error"));
    enrichCutPlanBatchMock.mockResolvedValue({
      plans: [
        {
          video: vid("tt-x", "tiktok"),
          cutPlan: {
            videoId: "tt-x",
            density: { editing: 50, transition: 50, effect: 50, bgmSync: 50, overall: 50 },
            bgm: null,
            dimensions: {
              pacing: { shotCount: 1, avgShotDurationSec: 25, cutDensityPerSec: 0, rhythmProfile: null, keyTwistAt: null },
              camera: { dominantMovements: ["push_in"], shotSizeDistribution: {}, transitionPatterns: [] },
              audiovisual: { bgmPattern: null, bgmSyncTightness: null, subtitleStyle: null, colorGrade: null },
              structure: { hookFormat: null, openingShot: null, endingShot: null, cta: null, payoffAt: null },
            },
          },
        },
      ],
      failures: [],
    });

    const snap = await fetchTrendingSnapshot();
    expect(snap.insight).toBeDefined();
    // null prev → techniqueWoW={} per aggregate contract
    expect(snap.insight?.velocity.techniqueWoW).toEqual({});
  });
});

describe("fetchTrendingSnapshot — T8 upstream AbortSignal forwarding", () => {
  it("forwards signal into TikTok Stage 1 (scrapeTikTokTrendingHashtags)", async () => {
    const ctrl = new AbortController();
    await fetchTrendingSnapshot({ signal: ctrl.signal });
    expect(scrapeTikTokTrendingHashtagsMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: ctrl.signal }),
    );
  });

  it("forwards signal into TikTok Stage 2 (scrapeTikTokByHashtag — every call)", async () => {
    const ctrl = new AbortController();
    await fetchTrendingSnapshot({ signal: ctrl.signal });
    expect(scrapeTikTokByHashtagMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of scrapeTikTokByHashtagMock.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ signal: ctrl.signal }));
    }
  });

  it("forwards signal into Instagram scrape (scrapeInstagramByHashtag)", async () => {
    const ctrl = new AbortController();
    await fetchTrendingSnapshot({ signal: ctrl.signal });
    expect(scrapeInstagramByHashtagMock).toHaveBeenCalledWith(
      expect.objectContaining({ signal: ctrl.signal }),
    );
  });

  it("forwards signal into Haiku metadata enrichBatch (research/enrich-one)", async () => {
    const ctrl = new AbortController();
    await fetchTrendingSnapshot({ signal: ctrl.signal });
    const enrichOpts = enrichBatchMock.mock.calls[0][1];
    expect(enrichOpts?.signal).toBe(ctrl.signal);
  });

  it("forwards signal into topic classifier (classifyTopics)", async () => {
    const ctrl = new AbortController();
    await fetchTrendingSnapshot({ signal: ctrl.signal });
    const classifyOpts = classifyTopicsMock.mock.calls[0][2];
    expect(classifyOpts?.signal).toBe(ctrl.signal);
  });

  it("when no signal is passed, upstream stages receive signal: undefined (backward compat)", async () => {
    await fetchTrendingSnapshot();
    const trendingArg = scrapeTikTokTrendingHashtagsMock.mock.calls[0][0];
    expect(trendingArg.signal).toBeUndefined();
    const igArg = scrapeInstagramByHashtagMock.mock.calls[0][0];
    expect(igArg.signal).toBeUndefined();
    const enrichOpts = enrichBatchMock.mock.calls[0][1];
    expect(enrichOpts?.signal).toBeUndefined();
    const classifyOpts = classifyTopicsMock.mock.calls[0][2];
    expect(classifyOpts?.signal).toBeUndefined();
  });
});

describe("fetchTrendingSnapshot — Item 2: Stage 1 retry on 0-hashtag / throw", () => {
  it("Stage 1 returns 0 hashtags → retry once → succeed on second attempt", async () => {
    scrapeTikTokTrendingHashtagsMock
      .mockResolvedValueOnce({ hashtags: [], runId: "run-empty" })
      .mockResolvedValueOnce({
        hashtags: [ht("retrysuccess", 1)],
        runId: "run-retry-ok",
      });

    const snap = await fetchTrendingSnapshot();

    expect(scrapeTikTokTrendingHashtagsMock).toHaveBeenCalledTimes(2);
    expect(snap.meta.tiktok.ok).toBe(true);
    expect(snap.meta.tiktok.retryAttempts).toBe(2);
    expect(snap.meta.tiktok.actorRun).toBe("run-retry-ok");
    expect(snap.trendingHashtags.map((h) => h.name)).toEqual(["retrysuccess"]);
  });

  it("Stage 1 returns 0 hashtags both attempts → meta.tiktok.ok=false, partial=true", async () => {
    scrapeTikTokTrendingHashtagsMock
      .mockResolvedValueOnce({ hashtags: [], runId: "run-empty-1" })
      .mockResolvedValueOnce({ hashtags: [], runId: "run-empty-2" });

    const snap = await fetchTrendingSnapshot();

    expect(scrapeTikTokTrendingHashtagsMock).toHaveBeenCalledTimes(2);
    expect(snap.meta.tiktok.ok).toBe(false);
    expect(snap.meta.tiktok.retryAttempts).toBe(2);
    expect(snap.meta.partial).toBe(true);
    expect(snap.trendingHashtags).toEqual([]);
    // Stage 2 must not have been called when Stage 1 produced 0 hashtags.
    expect(scrapeTikTokByHashtagMock).not.toHaveBeenCalled();
    // IG path still produces its video, so snapshot is not empty.
    expect(snap.videos.map((v) => v.id)).toEqual(["ig1"]);
  });

  it("Stage 1 throws on first attempt → retry → succeed on second attempt", async () => {
    scrapeTikTokTrendingHashtagsMock
      .mockRejectedValueOnce(new Error("trends actor 503"))
      .mockResolvedValueOnce({
        hashtags: [ht("recovered", 1)],
        runId: "run-after-throw",
      });

    const snap = await fetchTrendingSnapshot();

    expect(scrapeTikTokTrendingHashtagsMock).toHaveBeenCalledTimes(2);
    expect(snap.meta.tiktok.ok).toBe(true);
    expect(snap.meta.tiktok.retryAttempts).toBe(2);
    expect(snap.trendingHashtags.map((h) => h.name)).toEqual(["recovered"]);
  });

  it("Stage 1 throws both attempts → meta.tiktok.ok=false, retryAttempts=2", async () => {
    scrapeTikTokTrendingHashtagsMock
      .mockRejectedValueOnce(new Error("first throw"))
      .mockRejectedValueOnce(new Error("second throw"));

    const snap = await fetchTrendingSnapshot();

    expect(scrapeTikTokTrendingHashtagsMock).toHaveBeenCalledTimes(2);
    expect(snap.meta.tiktok.ok).toBe(false);
    expect(snap.meta.tiktok.retryAttempts).toBe(2);
    expect(snap.meta.partial).toBe(true);
  });

  it("Stage 1 success first attempt → no retry, retryAttempts=1", async () => {
    // default beforeEach mock returns valid hashtags on first call
    const snap = await fetchTrendingSnapshot();
    expect(scrapeTikTokTrendingHashtagsMock).toHaveBeenCalledTimes(1);
    expect(snap.meta.tiktok.retryAttempts).toBe(1);
    expect(snap.meta.tiktok.ok).toBe(true);
  });

  it("signal already aborted → Stage 1 short-circuits, no Apify call, ok=false", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const snap = await fetchTrendingSnapshot({ signal: ctrl.signal });
    expect(scrapeTikTokTrendingHashtagsMock).not.toHaveBeenCalled();
    expect(snap.meta.tiktok.ok).toBe(false);
    expect(snap.meta.tiktok.retryAttempts).toBe(0);
  });
});
