import { describe, it, expect } from "vitest";
import { buildTechniqueIndex } from "@/lib/technique-index/build-index";
import type { CutPlan } from "@/lib/cut-plan/schema";

function makePlan(
  id: string,
  overall: number,
  patch: Partial<CutPlan>,
): CutPlan {
  return {
    videoId: id,
    durationSec: 30,
    fps: 30,
    videoFormat: "vlog",
    videoFormatConfidence: 0.9,
    actions: [],
    dimensions: {
      pacing: {
        shotCount: 5,
        avgShotDurationSec: 6,
        cutDensityPerSec: 0.2,
        rhythmProfile: "medium",
      },
      camera: {
        dominantMovements: [],
        shotSizeDistribution: {
          extreme_close_up: 0,
          close_up: 0,
          medium: 1,
          wide: 0,
          extreme_wide: 0,
        },
        transitionPatterns: [],
      },
      audiovisual: {
        bgmPattern: "steady",
        bgmSyncTightness: "moderate",
        subtitleStyle: "centered_minimal",
      },
      structure: {
        hookFormat: "question",
        openingShot: "",
        endingShot: "",
      },
    },
    density: { editing: 50, transition: 50, effect: 50, bgmSync: 50, overall },
    ...patch,
  };
}

describe("buildTechniqueIndex", () => {
  it("returns empty index for empty input", () => {
    const idx = buildTechniqueIndex([]);
    expect(idx.videoCount).toBe(0);
    expect(idx.byTechnique).toEqual({});
    expect(idx.videoTags).toEqual({});
    expect(idx.version).toBe(1);
  });

  it("builds reverse index from camera_move actions", () => {
    const plans = [
      makePlan("a", 80, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
      makePlan("b", 90, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
      makePlan("c", 70, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "pull_out", durationSec: 1 }],
      }),
    ];
    const idx = buildTechniqueIndex(plans);
    expect(idx.videoCount).toBe(3);
    expect(idx.byTechnique["camera-move:push-in"]).toEqual(["b", "a"]);
    expect(idx.byTechnique["camera-move:pull-out"]).toEqual(["c"]);
  });

  it("namespaces tags by dimension", () => {
    const plans = [
      makePlan("a", 50, {
        actions: [
          { kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 },
          { kind: "transition", at: { sec: 1 }, type: "push_in", durationFrames: 6 },
        ],
      }),
    ];
    const idx = buildTechniqueIndex(plans);
    expect(idx.byTechnique["camera-move:push-in"]).toEqual(["a"]);
    expect(idx.byTechnique["transition:push-in"]).toEqual(["a"]);
  });

  it("sorts each tag's videoId list by density.overall desc", () => {
    const plans = [
      makePlan("low", 30, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
      makePlan("high", 95, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
      makePlan("mid", 60, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
    ];
    const idx = buildTechniqueIndex(plans);
    expect(idx.byTechnique["camera-move:push-in"]).toEqual(["high", "mid", "low"]);
  });

  it("populates videoTags forward index", () => {
    const plans = [
      makePlan("a", 50, {
        actions: [{ kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 }],
      }),
    ];
    const idx = buildTechniqueIndex(plans);
    expect(idx.videoTags["a"].cameraMoves).toContain("push-in");
  });
});
