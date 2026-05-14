import { describe, expect, it } from "vitest";
import { withinPublishWindow } from "@/lib/research/topic-research";
import type { ViralVideo } from "@/lib/review-engine/types";

function makeVideo(over: Partial<ViralVideo> = {}): ViralVideo {
  return {
    id: "tt-1",
    platform: "tiktok",
    url: "https://www.tiktok.com/@u/video/1",
    cover: "",
    title: "t",
    description: "d",
    topic: "Travel",
    tags: [],
    views: 1000,
    likes: 10,
    comments: 1,
    shares: 1,
    duration: 20,
    playStyle: "未分类",
    visualStyle: "未分类",
    hook: "h",
    bgm: "b",
    authorHandle: "@u",
    publishedAt: "2026-05-01",
    ...over,
  };
}

const NOW = new Date("2026-05-13T00:00:00Z").getTime();

describe("withinPublishWindow", () => {
  it("keeps a video published 12 days ago", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "2026-05-01" }), NOW)).toBe(true);
  });

  it("drops a video published 31 days ago", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "2026-04-12" }), NOW)).toBe(false);
  });

  it("keeps a video exactly 30 days old (boundary inclusive)", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "2026-04-13" }), NOW)).toBe(true);
  });

  it("keeps a video when publishedAt is missing (unknown date is not dropped)", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "" }), NOW)).toBe(true);
  });

  it("keeps a video when publishedAt is unparseable", () => {
    expect(withinPublishWindow(makeVideo({ publishedAt: "not-a-date" }), NOW)).toBe(true);
  });
});
