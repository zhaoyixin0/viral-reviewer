import { describe, expect, it } from "vitest";
import { viralVideoToCutPlanStub } from "@/lib/sample-references";
import { CutPlanSchema } from "@/lib/cut-plan/schema";
import type { ViralVideo } from "@/lib/review-engine/types";

function makeViral(over: Partial<ViralVideo> = {}): ViralVideo {
  return {
    id: "tt-12345",
    platform: "tiktok",
    url: "https://www.tiktok.com/@u/video/12345",
    cover: "",
    title: "Vlog day in Bali",
    description: "...",
    topic: "Travel Vlog",
    tags: ["travel"],
    views: 1000000,
    likes: 50000,
    comments: 1200,
    shares: 800,
    duration: 25,
    playStyle: "cinematic-vlog",
    visualStyle: "warm-grade",
    hook: "wide aerial reveal",
    bgm: "Espresso · Sabrina Carpenter",
    authorHandle: "@user",
    publishedAt: "2026-04-01",
    ...over,
  };
}

describe("viralVideoToCutPlanStub", () => {
  it("produces a CutPlan that passes the strict schema", () => {
    const cp = viralVideoToCutPlanStub(makeViral(), "vlog");
    const parsed = CutPlanSchema.safeParse(cp);
    expect(parsed.success).toBe(true);
  });

  it("falls back duration to 30s when source duration is 0", () => {
    const cp = viralVideoToCutPlanStub(makeViral({ duration: 0 }), "vlog");
    expect(cp.durationSec).toBe(30);
  });

  it("uses videoFormat from ViralVideo when present, else fallback arg", () => {
    const withFormat = viralVideoToCutPlanStub(
      makeViral({ videoFormat: "transformation" }),
      "vlog",
    );
    expect(withFormat.videoFormat).toBe("transformation");

    const withoutFormat = viralVideoToCutPlanStub(makeViral(), "tutorial");
    expect(withoutFormat.videoFormat).toBe("tutorial");
  });

  it("marks density.overall=60 (below real enriched data so it doesn't dominate top-N)", () => {
    const cp = viralVideoToCutPlanStub(makeViral(), "vlog");
    expect(cp.density.overall).toBe(60);
  });

  it("preserves source URL in meta for traceability", () => {
    const cp = viralVideoToCutPlanStub(
      makeViral({ url: "https://www.instagram.com/reel/abc123/" }),
      "vlog",
    );
    expect(cp.meta?.sourceUrl).toBe("https://www.instagram.com/reel/abc123/");
    expect(cp.meta?.model).toBe("live-metadata-stub");
  });

  it("falls back videoId when ViralVideo.id is empty", () => {
    const cp = viralVideoToCutPlanStub(
      makeViral({ id: "", url: "https://tiktok.com/@x/video/9999999" }),
      "vlog",
    );
    expect(cp.videoId).toMatch(/^live-/);
    expect(cp.videoId.length).toBeGreaterThan(6);
  });

  it("leaves actions empty (no fake cut points to confuse match-engine)", () => {
    const cp = viralVideoToCutPlanStub(makeViral(), "vlog");
    expect(cp.actions).toEqual([]);
  });

  it("threads hook + visual style into dimensions (helps Opus reason about it)", () => {
    const cp = viralVideoToCutPlanStub(
      makeViral({ hook: "vertical pan reveal", visualStyle: "high-contrast" }),
      "vlog",
    );
    expect(cp.dimensions.structure.hookFormat).toBe("vertical pan reveal");
    expect(cp.dimensions.audiovisual.colorGrade).toBe("high-contrast");
  });
});
