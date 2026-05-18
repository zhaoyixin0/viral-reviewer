import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViralVideo } from "@/lib/review-engine/types";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...a: unknown[]) => createMock(...a) };
  },
}));

import { enrichBatch } from "@/lib/research/enrich-one";

function v(id: string, over: Partial<ViralVideo> = {}): ViralVideo {
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
    ...over,
  };
}

beforeEach(() => {
  createMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
  // Default: SDK returns valid JSON, enrichOneVideo writes fields onto video.
  createMock.mockResolvedValue({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          playStyle: "前后对比",
          visualStyle: "Cinematic 大片感",
          hook: "h",
        }),
      },
    ],
  });
});

describe("enrichBatch — AbortSignal handling", () => {
  it("throws AbortError when signal is already aborted before first batch", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      enrichBatch([v("a")], { signal: ctrl.signal }),
    ).rejects.toThrowError(/Aborted/);
    // SDK should NOT have been called — we bailed before the first batch.
    expect(createMock).not.toHaveBeenCalled();
  });

  it("throws AbortError between batches when signal aborts mid-flight", async () => {
    const ctrl = new AbortController();
    // Concurrency 2 + 4 videos → 2 batches. Abort after first batch completes.
    const videos = [v("a"), v("b"), v("c"), v("d")];
    let callCount = 0;
    createMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        // After the first batch (2 calls) completes, abort before the next.
        ctrl.abort();
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ playStyle: "", visualStyle: "", hook: "" }) },
        ],
      };
    });
    await expect(
      enrichBatch(videos, { concurrency: 2, signal: ctrl.signal }),
    ).rejects.toThrowError(/Aborted/);
    // First batch ran (2 calls), second batch skipped.
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("processes all videos when no signal is provided (backwards compat)", async () => {
    const out = await enrichBatch([v("a"), v("b")]);
    expect(out).toHaveLength(2);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("respects custom concurrency in opts", async () => {
    const out = await enrichBatch([v("a"), v("b"), v("c")], { concurrency: 1 });
    expect(out).toHaveLength(3);
    expect(createMock).toHaveBeenCalledTimes(3);
  });
});
