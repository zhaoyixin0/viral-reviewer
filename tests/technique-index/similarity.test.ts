import { describe, it, expect } from "vitest";
import { potentialToDesiredTags, scoreCandidates } from "@/lib/technique-index/similarity";
import type { TechniqueIndex } from "@/lib/technique-index/types";

const idx: TechniqueIndex = {
  version: 1,
  generatedAt: "2026-05-13T00:00:00.000Z",
  videoCount: 3,
  byTechnique: {
    "camera-move:push-in": ["a", "b"],
    "camera-move:pull-out": ["c"],
    "cut:match-cut": ["a"],
  },
  videoTags: {
    a: {
      cuts: ["match-cut"],
      transitions: [],
      cameraMoves: ["push-in"],
      speedChanges: [],
      effects: [],
      subtitleStyles: [],
      audioSyncAnchors: [],
      hookFormats: ["question"],
    },
    b: {
      cuts: [],
      transitions: [],
      cameraMoves: ["push-in"],
      speedChanges: [],
      effects: [],
      subtitleStyles: [],
      audioSyncAnchors: [],
      hookFormats: ["before-after"],
    },
    c: {
      cuts: [],
      transitions: [],
      cameraMoves: ["pull-out"],
      speedChanges: [],
      effects: [],
      subtitleStyles: [],
      audioSyncAnchors: [],
      hookFormats: ["question"],
    },
  },
};

describe("potentialToDesiredTags", () => {
  it("maps push-in opportunities to camera-move:push-in tag", () => {
    const tags = potentialToDesiredTags({
      pushInOpportunities: [{ at: { sec: 1 }, reason: "centered subject" }],
      matchCutCandidates: [],
      sceneTransitionCandidates: [],
    });
    expect(tags).toContain("camera-move:push-in");
  });

  it("maps match-cut candidates to cut:match-cut", () => {
    const tags = potentialToDesiredTags({
      pushInOpportunities: [],
      matchCutCandidates: [{ pairId: "p1", from: { sec: 1 }, to: { sec: 3 }, reason: "" }],
      sceneTransitionCandidates: [],
    });
    expect(tags).toContain("cut:match-cut");
  });

  it("returns empty array when no opportunities", () => {
    const tags = potentialToDesiredTags({
      pushInOpportunities: [],
      matchCutCandidates: [],
      sceneTransitionCandidates: [],
    });
    expect(tags).toEqual([]);
  });
});

describe("scoreCandidates", () => {
  it("returns candidates sorted by match count then alphabetical", () => {
    const scored = scoreCandidates(idx, ["camera-move:push-in", "cut:match-cut"]);
    expect(scored[0].videoId).toBe("a");
    expect(scored[0].matchedTags).toEqual(["camera-move:push-in", "cut:match-cut"]);
    expect(scored[0].score).toBe(2);
    expect(scored[1].videoId).toBe("b");
    expect(scored[1].score).toBe(1);
  });

  it("returns empty array when no tags match", () => {
    const scored = scoreCandidates(idx, ["camera-move:dolly-zoom"]);
    expect(scored).toEqual([]);
  });

  it("does not include videos with zero matches", () => {
    const scored = scoreCandidates(idx, ["camera-move:push-in"]);
    const ids = scored.map((c) => c.videoId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
  });
});
