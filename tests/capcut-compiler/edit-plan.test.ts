import { describe, expect, it } from "vitest";
import {
  computeKeepRanges,
  extractTrimRanges,
  makeEasedScaleKeyframes,
  planEditSegments,
} from "@/lib/capcut-compiler/edit-plan";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

function makeMatch(over: Partial<TechniqueMatchingResult> = {}): TechniqueMatchingResult {
  return {
    userVideoId: "test",
    reports: [],
    topPriorityActions: [],
    globalDoNots: [],
    recommendedBgms: [],
    trimRanges: [],
    ...over,
  } as TechniqueMatchingResult;
}

describe("extractTrimRanges", () => {
  it("uses structured trimRanges when present", () => {
    const m = makeMatch({
      trimRanges: [
        { startSec: 0, endSec: 0.6, reason: "重复抬手", priority: "P0" },
        { startSec: 3.5, endSec: 3.6, reason: "摩擦", priority: "P1" },
      ],
    });
    const out = extractTrimRanges(m, 8.1);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ startSec: 0, endSec: 0.6 });
    expect(out[1]).toMatchObject({ startSec: 3.5, endSec: 3.6 });
  });

  it("clamps endSec to total duration", () => {
    const m = makeMatch({
      trimRanges: [{ startSec: 7, endSec: 99, reason: "x", priority: "P0" }],
    });
    const out = extractTrimRanges(m, 8.1);
    expect(out[0].endSec).toBeCloseTo(8.1);
  });

  it("falls back to regex on legacy free-text actions", () => {
    const m = makeMatch({
      topPriorityActions: [
        {
          userVideoAt: { sec: 0 },
          action: "必删片段 P0 - 0-0.6s 重复抬手停顿",
          sourcedFromReferenceId: "ref-a",
          priority: "P0",
        },
        {
          userVideoAt: { sec: 3.5 },
          action: "在 3.5s 加 push-in", // 没有删除关键字，不应抽
          sourcedFromReferenceId: "ref-b",
          priority: "P1",
        },
      ],
    });
    const out = extractTrimRanges(m, 8.1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ startSec: 0, endSec: 0.6 });
  });

  it("merges overlapping ranges", () => {
    const m = makeMatch({
      trimRanges: [
        { startSec: 0, endSec: 1.0, reason: "a", priority: "P0" },
        { startSec: 0.5, endSec: 1.5, reason: "b", priority: "P0" },
      ],
    });
    const out = extractTrimRanges(m, 8.1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ startSec: 0, endSec: 1.5 });
  });

  it("ignores invalid ranges", () => {
    const m = makeMatch({
      trimRanges: [
        { startSec: -1, endSec: 0.5, reason: "x", priority: "P0" },
        { startSec: 2, endSec: 1, reason: "y", priority: "P0" },
      ],
    });
    const out = extractTrimRanges(m, 8.1);
    expect(out).toHaveLength(0);
  });
});

describe("computeKeepRanges", () => {
  it("keeps everything when no trim", () => {
    const out = computeKeepRanges(8.1, []);
    expect(out).toEqual([{ sourceStartSec: 0, sourceEndSec: 8.1 }]);
  });

  it("removes a single mid-range trim", () => {
    const out = computeKeepRanges(8.1, [
      { startSec: 3.5, endSec: 3.6, reason: "x" },
    ]);
    expect(out).toEqual([
      { sourceStartSec: 0, sourceEndSec: 3.5 },
      { sourceStartSec: 3.6, sourceEndSec: 8.1 },
    ]);
  });

  it("handles trim at start", () => {
    const out = computeKeepRanges(8.1, [
      { startSec: 0, endSec: 0.6, reason: "x" },
    ]);
    expect(out).toEqual([{ sourceStartSec: 0.6, sourceEndSec: 8.1 }]);
  });

  it("handles multiple trims", () => {
    const out = computeKeepRanges(8.1, [
      { startSec: 0, endSec: 0.6, reason: "a" },
      { startSec: 3.5, endSec: 3.6, reason: "b" },
    ]);
    expect(out).toEqual([
      { sourceStartSec: 0.6, sourceEndSec: 3.5 },
      { sourceStartSec: 3.6, sourceEndSec: 8.1 },
    ]);
  });
});

describe("planEditSegments", () => {
  it("places kept ranges contiguously on output timeline", () => {
    const keeps = [
      { sourceStartSec: 0.6, sourceEndSec: 3.5 },
      { sourceStartSec: 3.6, sourceEndSec: 8.1 },
    ];
    const plan = planEditSegments(keeps, [], () => ({ type: "none" }));
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      sourceStartSec: 0.6,
      sourceEndSec: 3.5,
      targetStartSec: 0,
      targetEndSec: 2.9,
    });
    expect(plan[1]).toMatchObject({
      sourceStartSec: 3.6,
      sourceEndSec: 8.1,
      targetStartSec: 2.9,
      targetEndSec: 7.4,
    });
  });

  it("subdivides keep ranges by cut points", () => {
    const keeps = [{ sourceStartSec: 0, sourceEndSec: 4.0 }];
    const plan = planEditSegments(keeps, [1.0, 2.5], () => ({ type: "none" }));
    expect(plan).toHaveLength(3);
    expect(plan.map((p) => [p.sourceStartSec, p.sourceEndSec])).toEqual([
      [0, 1.0],
      [1.0, 2.5],
      [2.5, 4.0],
    ]);
    // target is contiguous from 0
    expect(plan.map((p) => p.targetStartSec)).toEqual([0, 1.0, 2.5]);
  });

  it("ignores cut points inside trim regions (i.e. outside any keep range)", () => {
    const keeps = [
      { sourceStartSec: 0, sourceEndSec: 1.0 },
      { sourceStartSec: 2.0, sourceEndSec: 4.0 },
    ];
    // 1.5 is inside the trim 1.0-2.0 — must not introduce a 3rd seg
    const plan = planEditSegments(keeps, [1.5], () => ({ type: "none" }));
    expect(plan).toHaveLength(2);
  });
});

describe("makeEasedScaleKeyframes", () => {
  it("returns a single keyframe when change is negligible", () => {
    const kfs = makeEasedScaleKeyframes(1.0, 1.001, 1_000_000);
    expect(kfs).toHaveLength(1);
  });

  it("returns 9 keyframes with monotonic ease-in-out for normal zoom", () => {
    const kfs = makeEasedScaleKeyframes(1.0, 1.06, 1_000_000);
    expect(kfs).toHaveLength(9);
    // monotonically increasing
    for (let i = 1; i < kfs.length; i++) {
      expect(kfs[i].values[0]).toBeGreaterThanOrEqual(kfs[i - 1].values[0]);
    }
    // endpoints exact
    expect(kfs[0].values[0]).toBeCloseTo(1.0);
    expect(kfs[8].values[0]).toBeCloseTo(1.06);
    // midpoint is roughly halfway (ease-in-out crosses 0.5 at t=0.5)
    expect(kfs[4].values[0]).toBeCloseTo(1.03, 2);
  });

  it("handles pull-out (decreasing scale) correctly", () => {
    const kfs = makeEasedScaleKeyframes(1.06, 1.0, 1_000_000);
    expect(kfs[0].values[0]).toBeCloseTo(1.06);
    expect(kfs[8].values[0]).toBeCloseTo(1.0);
    // monotonically decreasing
    for (let i = 1; i < kfs.length; i++) {
      expect(kfs[i].values[0]).toBeLessThanOrEqual(kfs[i - 1].values[0]);
    }
  });
});
