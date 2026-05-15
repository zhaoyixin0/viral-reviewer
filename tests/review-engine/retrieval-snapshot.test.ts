import { describe, expect, it } from "vitest";
import { pickSnapshotMatches } from "@/lib/review-engine/retrieval";
import type { ViralVideo } from "@/lib/review-engine/types";

function vid(id: string, topic: string, topicConfidence: number | undefined, views: number): ViralVideo {
  return {
    id, platform: "tiktok",
    url: `https://x/${id}`, cover: "", title: id, description: "",
    topic, tags: [], views, likes: 1, comments: 1, shares: 1,
    duration: 20, playStyle: "未分类", visualStyle: "未分类", hook: "h",
    bgm: "b", authorHandle: "@u", publishedAt: "2026-05-01",
    ...(topicConfidence === undefined ? {} : { topicConfidence }),
  };
}

describe("pickSnapshotMatches", () => {
  it("returns videos whose topic matches the canonical topic", () => {
    const pool = [
      vid("a", "早餐健身", 0.9, 5000),
      vid("b", "旅行 vlog", 0.9, 9000),
    ];
    const out = pickSnapshotMatches(pool, "早餐健身", 5);
    expect(out.map((v) => v.id)).toContain("a");
    expect(out.map((v) => v.id)).not.toContain("b");
  });

  it("skips low-confidence videos even if topic matches", () => {
    const pool = [
      vid("lowconf", "早餐健身", 0.2, 5000),
      vid("highconf", "早餐健身", 0.9, 4000),
    ];
    const out = pickSnapshotMatches(pool, "早餐健身", 5);
    expect(out.map((v) => v.id)).toEqual(["highconf"]);
  });

  it("skips videos with undefined topicConfidence (treated as 0)", () => {
    const pool = [vid("noconf", "早餐健身", undefined, 5000)];
    const out = pickSnapshotMatches(pool, "早餐健身", 5);
    expect(out).toHaveLength(0);
  });

  it("returns an empty array when nothing clears the fuzzy-match threshold", () => {
    const pool = [vid("a", "宠物日常", 0.9, 5000)];
    const out = pickSnapshotMatches(pool, "量子物理", 5);
    expect(out).toHaveLength(0);
  });

  it("caps results at topK, sorted by views desc", () => {
    const pool = [
      vid("a", "健身", 0.9, 1000),
      vid("b", "健身", 0.9, 9000),
      vid("c", "健身", 0.9, 5000),
    ];
    const out = pickSnapshotMatches(pool, "健身", 2);
    expect(out.map((v) => v.id)).toEqual(["b", "c"]);
  });
});
