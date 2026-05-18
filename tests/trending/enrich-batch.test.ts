import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";
import type { CutPlan } from "@/lib/cut-plan/schema";

const enrichTrendingVideoMock = vi.fn();

vi.mock("@/lib/trending/enrich-trending-video", () => ({
  enrichTrendingVideo: (...a: unknown[]) => enrichTrendingVideoMock(...a),
}));

import { enrichBatch } from "@/lib/trending/enrich-batch";

function v(id: string): ViralVideo {
  return {
    id,
    platform: "tiktok",
    url: `https://www.tiktok.com/@u/video/${id}`,
    cover: "",
    title: id,
    description: "",
    topic: "",
    tags: [],
    views: 1000,
    likes: 10,
    comments: 1,
    shares: 1,
    duration: 25,
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "",
    bgm: "",
    authorHandle: "@u",
    publishedAt: "2026-05-10",
  };
}

function fakePlan(id: string): CutPlan {
  return { videoId: id } as unknown as CutPlan;
}

beforeEach(() => {
  enrichTrendingVideoMock.mockReset();
});

describe("enrichBatch", () => {
  it("collects plans and failures into parallel arrays", async () => {
    enrichTrendingVideoMock.mockImplementation((video: ViralVideo) => {
      if (video.id === "fail1" || video.id === "fail2") {
        return Promise.resolve({ ok: false, reason: "download_failed: 404 Not Found" });
      }
      return Promise.resolve({ ok: true, cutPlan: fakePlan(video.id) });
    });

    const result = await enrichBatch(
      [v("ok1"), v("fail1"), v("ok2"), v("fail2"), v("ok3")],
      { concurrency: 2, retries: 0 },
    );

    expect(result.plans.map((p) => p.video.id).sort()).toEqual([
      "ok1",
      "ok2",
      "ok3",
    ]);
    expect(result.failures.map((f) => f.videoId).sort()).toEqual([
      "fail1",
      "fail2",
    ]);
    expect(result.failures[0].reason).toMatch(/404/);
  });

  it("retries transient failures (D5=B) up to retries count and succeeds", async () => {
    enrichTrendingVideoMock
      .mockResolvedValueOnce({ ok: false, reason: "gemini_failed: 500 Internal" })
      .mockResolvedValueOnce({ ok: true, cutPlan: fakePlan("flaky") });

    const result = await enrichBatch([v("flaky")], {
      retries: 1,
      retryBackoffMs: 0,
    });

    expect(enrichTrendingVideoMock).toHaveBeenCalledTimes(2);
    expect(result.plans).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
  });

  it("does not retry non-retryable failures (404 / invalid)", async () => {
    enrichTrendingVideoMock.mockResolvedValue({
      ok: false,
      reason: "download_failed: 404 Not Found",
    });

    const result = await enrichBatch([v("dead")], {
      retries: 3,
      retryBackoffMs: 0,
    });

    expect(enrichTrendingVideoMock).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([
      { videoId: "dead", reason: "download_failed: 404 Not Found" },
    ]);
  });

  it("treats 408 / 429 / unknown / 5xx as retryable (transient class)", async () => {
    enrichTrendingVideoMock
      .mockResolvedValueOnce({ ok: false, reason: "gemini_failed: 429 quota" })
      .mockResolvedValueOnce({ ok: true, cutPlan: fakePlan("retry-429") });

    const result = await enrichBatch([v("retry-429")], {
      retries: 1,
      retryBackoffMs: 0,
    });

    expect(enrichTrendingVideoMock).toHaveBeenCalledTimes(2);
    expect(result.plans).toHaveLength(1);
  });

  it("exhausts retries then records final failure", async () => {
    enrichTrendingVideoMock.mockResolvedValue({
      ok: false,
      reason: "gemini_failed: 502 bad gateway",
    });

    const result = await enrichBatch([v("dead")], {
      retries: 2,
      retryBackoffMs: 0,
    });

    expect(enrichTrendingVideoMock).toHaveBeenCalledTimes(3);
    expect(result.plans).toHaveLength(0);
    expect(result.failures[0].reason).toMatch(/502 bad gateway/);
  });

  it("respects maxVideos cost cap (cost budget)", async () => {
    enrichTrendingVideoMock.mockImplementation((video: ViralVideo) =>
      Promise.resolve({ ok: true, cutPlan: fakePlan(video.id) }),
    );

    const result = await enrichBatch(
      [v("a"), v("b"), v("c"), v("d"), v("e"), v("f")],
      { maxVideos: 2, retries: 0 },
    );

    expect(enrichTrendingVideoMock).toHaveBeenCalledTimes(2);
    expect(result.plans).toHaveLength(2);
  });

  it("limits concurrency via hand-rolled semaphore", async () => {
    let inFlight = 0;
    let peak = 0;
    enrichTrendingVideoMock.mockImplementation(async (video: ViralVideo) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { ok: true, cutPlan: fakePlan(video.id) };
    });

    await enrichBatch(
      Array.from({ length: 10 }, (_, i) => v(`v${i}`)),
      { concurrency: 3, retries: 0 },
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("returns empty result when input array is empty", async () => {
    const result = await enrichBatch([], { retries: 0 });
    expect(result).toEqual({ plans: [], failures: [] });
    expect(enrichTrendingVideoMock).not.toHaveBeenCalled();
  });

  it("returns empty result when maxVideos is 0", async () => {
    const result = await enrichBatch([v("a"), v("b")], {
      maxVideos: 0,
      retries: 0,
    });
    expect(result).toEqual({ plans: [], failures: [] });
    expect(enrichTrendingVideoMock).not.toHaveBeenCalled();
  });

  it("AbortSignal pre-aborted: no videos processed, all marked aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    enrichTrendingVideoMock.mockResolvedValue({
      ok: true,
      cutPlan: fakePlan("x"),
    });

    const result = await enrichBatch([v("a"), v("b")], {
      signal: ctrl.signal,
      retries: 0,
    });

    expect(enrichTrendingVideoMock).not.toHaveBeenCalled();
    expect(result.plans).toHaveLength(0);
  });

  it("AbortSignal mid-batch: in-flight finishes, queue stops, partial result returned", async () => {
    const ctrl = new AbortController();
    let processed = 0;
    enrichTrendingVideoMock.mockImplementation(async (video: ViralVideo) => {
      processed++;
      if (processed === 2) ctrl.abort();
      return { ok: true, cutPlan: fakePlan(video.id) };
    });

    const result = await enrichBatch(
      [v("a"), v("b"), v("c"), v("d"), v("e")],
      { concurrency: 1, signal: ctrl.signal, retries: 0 },
    );

    expect(result.plans.length).toBeGreaterThanOrEqual(1);
    expect(result.plans.length).toBeLessThan(5);
  });

  it("retry backoff respects abort signal (early-exit sleep)", async () => {
    const ctrl = new AbortController();
    enrichTrendingVideoMock.mockResolvedValue({
      ok: false,
      reason: "gemini_failed: 500",
    });

    const start = Date.now();
    setTimeout(() => ctrl.abort(), 10);
    await enrichBatch([v("a")], {
      retries: 1,
      retryBackoffMs: 10_000,
      signal: ctrl.signal,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it("forwards enrichOptions (tmpDir / downloadTimeoutMs) to inner helper", async () => {
    enrichTrendingVideoMock.mockResolvedValue({
      ok: true,
      cutPlan: fakePlan("a"),
    });

    await enrichBatch([v("a")], {
      retries: 0,
      enrichOptions: { tmpDir: "/custom", downloadTimeoutMs: 5_000 },
    });

    const call = enrichTrendingVideoMock.mock.calls[0];
    expect(call[1]).toEqual({ tmpDir: "/custom", downloadTimeoutMs: 5_000 });
  });

  it("preserves video metadata on the plan output for downstream aggregation", async () => {
    const sourceVideo = v("rich");
    sourceVideo.trendingContext = { hashtag: "morningroutine", hashtagRank: 1 };
    sourceVideo.views = 9_999;

    enrichTrendingVideoMock.mockResolvedValue({
      ok: true,
      cutPlan: fakePlan("rich"),
    });

    const result = await enrichBatch([sourceVideo], { retries: 0 });

    expect(result.plans[0].video).toBe(sourceVideo);
    expect(result.plans[0].video.trendingContext?.hashtag).toBe("morningroutine");
    expect(result.plans[0].video.views).toBe(9_999);
  });
});
