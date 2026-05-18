import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";
import type { CutPlan } from "@/lib/cut-plan/schema";

const downloadVideoMock = vi.fn();
const probeVideoMetaMock = vi.fn();
const understandVideoAsCutPlanMock = vi.fn();
const rmMock = vi.fn();
const mkdirMock = vi.fn();

vi.mock("@/lib/enrichment/video-downloader", () => ({
  downloadVideo: (...a: unknown[]) => downloadVideoMock(...a),
}));
vi.mock("@/lib/video/ffprobe-meta", () => ({
  probeVideoMeta: (...a: unknown[]) => probeVideoMetaMock(...a),
}));
vi.mock("@/lib/video/gemini-understand", () => ({
  understandVideoAsCutPlan: (...a: unknown[]) => understandVideoAsCutPlanMock(...a),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: (...a: unknown[]) => mkdirMock(...a),
  rm: (...a: unknown[]) => rmMock(...a),
}));

import { enrichTrendingVideo } from "@/lib/trending/enrich-trending-video";

function viralVideo(over: Partial<ViralVideo> = {}): ViralVideo {
  return {
    id: "tt-abc",
    platform: "tiktok",
    url: "https://www.tiktok.com/@u/video/abc",
    cover: "",
    title: "morning routine",
    description: "",
    topic: "",
    tags: ["#morningroutine"],
    views: 1000,
    likes: 10,
    comments: 1,
    shares: 1,
    duration: 25,
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "",
    bgm: "Trending Sound",
    authorHandle: "@u",
    publishedAt: "2026-05-10",
    ...over,
  };
}

function fakeCutPlan(): CutPlan {
  return {
    videoId: "tt-abc",
    durationSec: 25,
    fps: 30,
    resolution: { width: 1080, height: 1920 },
    videoFormat: "vlog",
    videoFormatConfidence: 0.9,
    actions: [],
    bgm: null,
    dimensions: {
      pacing: {
        shotCount: 1,
        avgShotDurationSec: 25,
        cutDensityPerSec: 0,
        rhythmProfile: "medium",
        keyTwistAt: null,
      },
      camera: {
        dominantMovements: ["static"],
        shotSizeDistribution: {},
        transitionPatterns: [],
      },
      audiovisual: {
        bgmPattern: null,
        bgmSyncTightness: null,
        subtitleStyle: null,
        colorGrade: null,
      },
      structure: {
        hookFormat: null,
        openingShot: null,
        endingShot: null,
        cta: null,
        payoffAt: null,
      },
    },
    density: { editing: 50, transition: 50, effect: 50, bgmSync: 50, overall: 50 },
  } as unknown as CutPlan;
}

beforeEach(() => {
  downloadVideoMock.mockReset();
  probeVideoMetaMock.mockReset();
  understandVideoAsCutPlanMock.mockReset();
  rmMock.mockReset();
  mkdirMock.mockReset();
  rmMock.mockResolvedValue(undefined);
  mkdirMock.mockResolvedValue(undefined);
});

describe("enrichTrendingVideo", () => {
  it("happy path: download → ffprobe → Gemini → CutPlan", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: true,
      path: "/tmp/x/tt-abc.mp4",
      bytes: 1_000_000,
      cached: false,
    });
    probeVideoMetaMock.mockResolvedValue({
      durationSec: 25,
      fps: 30,
      width: 1080,
      height: 1920,
      codec: "h264",
      bitrate: 2_000_000,
      hasAudio: true,
    });
    const plan = fakeCutPlan();
    understandVideoAsCutPlanMock.mockResolvedValue(plan);

    const result = await enrichTrendingVideo(viralVideo());

    expect(result).toEqual({ ok: true, cutPlan: plan });
    expect(downloadVideoMock).toHaveBeenCalledTimes(1);
    expect(probeVideoMetaMock).toHaveBeenCalledTimes(1);
    expect(understandVideoAsCutPlanMock).toHaveBeenCalledTimes(1);
  });

  it("C8 P1a: prepends trendingContext.hashtag (with `#`) into knownTags", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: true, path: "/tmp/h/tt-abc.mp4", bytes: 1_000_000, cached: false,
    });
    probeVideoMetaMock.mockResolvedValue({
      durationSec: 25, fps: 30, width: 1080, height: 1920,
      codec: "h264", bitrate: 2_000_000, hasAudio: true,
    });
    understandVideoAsCutPlanMock.mockResolvedValue(fakeCutPlan());

    await enrichTrendingVideo({
      ...viralVideo({ tags: ["#travel"] }),
      trendingContext: { hashtag: "morningroutine", hashtagRank: 1 },
    });

    const call = understandVideoAsCutPlanMock.mock.calls[0][0];
    expect(call.hints.knownTags).toEqual(["#morningroutine", "#travel"]);
  });

  it("C8 P1a: leaves knownTags unchanged when video has no trendingContext", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: true, path: "/tmp/h/tt-abc.mp4", bytes: 1_000_000, cached: false,
    });
    probeVideoMetaMock.mockResolvedValue({
      durationSec: 25, fps: 30, width: 1080, height: 1920,
      codec: "h264", bitrate: 2_000_000, hasAudio: true,
    });
    understandVideoAsCutPlanMock.mockResolvedValue(fakeCutPlan());

    await enrichTrendingVideo(viralVideo({ tags: ["#travel"] }));

    const call = understandVideoAsCutPlanMock.mock.calls[0][0];
    expect(call.hints.knownTags).toEqual(["#travel"]);
  });

  it("passes trending video hints (title / bgm / tags / sourceUrl) into Gemini", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: true,
      path: "/tmp/y/tt-abc.mp4",
      bytes: 1_000_000,
      cached: false,
    });
    probeVideoMetaMock.mockResolvedValue({
      durationSec: 25,
      fps: 30,
      width: 1080,
      height: 1920,
      codec: "h264",
      bitrate: 2_000_000,
      hasAudio: true,
    });
    understandVideoAsCutPlanMock.mockResolvedValue(fakeCutPlan());

    await enrichTrendingVideo(
      viralVideo({
        title: "POV: travel day",
        bgm: "Sunset Lover",
        tags: ["#travel", "#summer"],
        url: "https://www.tiktok.com/@traveler/video/123",
      }),
    );

    const call = understandVideoAsCutPlanMock.mock.calls[0][0];
    expect(call.videoId).toBe("tt-abc");
    expect(call.hints).toEqual({
      sourceUrl: "https://www.tiktok.com/@traveler/video/123",
      knownTitle: "POV: travel day",
      knownBgm: "Sunset Lover",
      knownTags: ["#travel", "#summer"],
    });
  });

  it("download failure → classified reason, no ffprobe / Gemini calls", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: false,
      reason: "yt-dlp timeout 90000ms",
    });

    const result = await enrichTrendingVideo(viralVideo());

    expect(result).toEqual({
      ok: false,
      reason: "download_failed: yt-dlp timeout 90000ms",
    });
    expect(probeVideoMetaMock).not.toHaveBeenCalled();
    expect(understandVideoAsCutPlanMock).not.toHaveBeenCalled();
  });

  it("ffprobe failure → classified reason, no Gemini call", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: true,
      path: "/tmp/z/tt-abc.mp4",
      bytes: 1_000_000,
      cached: false,
    });
    probeVideoMetaMock.mockRejectedValue(new Error("no video stream"));

    const result = await enrichTrendingVideo(viralVideo());

    expect(result).toEqual({
      ok: false,
      reason: "ffprobe_failed: no video stream",
    });
    expect(understandVideoAsCutPlanMock).not.toHaveBeenCalled();
  });

  it("Gemini failure → classified reason", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: true,
      path: "/tmp/z/tt-abc.mp4",
      bytes: 1_000_000,
      cached: false,
    });
    probeVideoMetaMock.mockResolvedValue({
      durationSec: 25, fps: 30, width: 1080, height: 1920,
      codec: "h264", bitrate: 2_000_000, hasAudio: true,
    });
    understandVideoAsCutPlanMock.mockRejectedValue(
      new Error("Gemini file processing failed"),
    );

    const result = await enrichTrendingVideo(viralVideo());

    expect(result).toEqual({
      ok: false,
      reason: "gemini_failed: Gemini file processing failed",
    });
  });

  it("non-Error rejection coerces to string in reason", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: true,
      path: "/tmp/z/tt-abc.mp4",
      bytes: 1_000_000,
      cached: false,
    });
    probeVideoMetaMock.mockRejectedValue("string-thrown");

    const result = await enrichTrendingVideo(viralVideo());

    expect(result).toEqual({
      ok: false,
      reason: "ffprobe_failed: string-thrown",
    });
  });

  it("cleans up tmp dir on success", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: true,
      path: "/tmp/z/tt-abc.mp4",
      bytes: 1_000_000,
      cached: false,
    });
    probeVideoMetaMock.mockResolvedValue({
      durationSec: 25, fps: 30, width: 1080, height: 1920,
      codec: "h264", bitrate: 2_000_000, hasAudio: true,
    });
    understandVideoAsCutPlanMock.mockResolvedValue(fakeCutPlan());

    await enrichTrendingVideo(viralVideo());

    expect(rmMock).toHaveBeenCalledTimes(1);
    const rmCall = rmMock.mock.calls[0];
    expect(rmCall[1]).toEqual({ recursive: true, force: true });
  });

  it("cleans up tmp dir on failure (finally block runs)", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: false,
      reason: "404 Not Found",
    });

    await enrichTrendingVideo(viralVideo());

    expect(rmMock).toHaveBeenCalledTimes(1);
  });

  it("swallows cleanup error so caller still sees the primary result", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: true,
      path: "/tmp/z/tt-abc.mp4",
      bytes: 1_000_000,
      cached: false,
    });
    probeVideoMetaMock.mockResolvedValue({
      durationSec: 25, fps: 30, width: 1080, height: 1920,
      codec: "h264", bitrate: 2_000_000, hasAudio: true,
    });
    understandVideoAsCutPlanMock.mockResolvedValue(fakeCutPlan());
    rmMock.mockRejectedValue(new Error("EBUSY"));

    const result = await enrichTrendingVideo(viralVideo());

    expect(result.ok).toBe(true);
  });

  it("respects custom tmpDir + downloadTimeoutMs options", async () => {
    downloadVideoMock.mockResolvedValue({
      ok: false,
      reason: "custom",
    });

    await enrichTrendingVideo(viralVideo(), {
      tmpDir: "/custom/root",
      downloadTimeoutMs: 30_000,
    });

    const dlCall = downloadVideoMock.mock.calls[0];
    const outPath = dlCall[1] as string;
    expect(outPath.startsWith("/custom/root") || outPath.startsWith("\\custom\\root")).toBe(true);
    expect(dlCall[2]).toEqual({ timeoutMs: 30_000 });
  });
});
