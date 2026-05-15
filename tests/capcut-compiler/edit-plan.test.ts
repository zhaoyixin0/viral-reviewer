import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampTransitionDurationSec,
  computeKeepRanges,
  extractTrimRanges,
  makeEasedScaleKeyframes,
  planEditSegments,
  planFromAssemblyTimeline,
} from "@/lib/capcut-compiler/edit-plan";
import type {
  AssemblyClip,
  AssemblyTimeline,
  TechniqueMatchingResult,
} from "@/lib/technique-matching/types";
import type { VideoMeta } from "@/lib/video/ffprobe-meta";

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
    // 兼容路径：单视频 fallback 一律记 sourceVideoIndex:0（Task 8）
    expect(plan.every((p) => p.sourceVideoIndex === 0)).toBe(true);
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

// ===== Task 8 · 多视频编排 =====

function makeMeta(over: Partial<VideoMeta> = {}): VideoMeta {
  return {
    durationSec: 10,
    fps: 30,
    width: 1080,
    height: 1920,
    codec: "h264",
    bitrate: 2_000_000,
    hasAudio: true,
    ...over,
  };
}

function makeClip(over: Partial<AssemblyClip> = {}): AssemblyClip {
  return {
    sourceVideoIndex: 0,
    sourceVideoId: "vid-0",
    order: 0,
    sourceStartSec: 0,
    sourceEndSec: 2,
    animation: null,
    incomingTransition: null,
    reason: "",
    ...over,
  } as AssemblyClip;
}

function makeTimeline(clips: AssemblyClip[]): AssemblyTimeline {
  const est = clips.reduce(
    (s, c) => s + Math.max(0, c.sourceEndSec - c.sourceStartSec),
    0,
  );
  return {
    clips,
    estimatedDurationSec: est,
    narrativeSummary: "",
    rationale: "",
  };
}

describe("planFromAssemblyTimeline", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  // vi.spyOn 的泛型签名拿不到精确 mock.calls 元组，统一在用的地方收口
  const collectWarnMessages = (): string[] =>
    (warnSpy.mock.calls as ReadonlyArray<ReadonlyArray<unknown>>).map((c) =>
      String(c[0]),
    );

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns [] for empty clips", () => {
    const plan = planFromAssemblyTimeline(makeTimeline([]), [makeMeta()]);
    expect(plan).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("maps a single clip with correct sourceVideoIndex and linear target", () => {
    const tl = makeTimeline([
      makeClip({
        sourceVideoIndex: 0,
        sourceStartSec: 1,
        sourceEndSec: 3.5,
        animation: { type: "push_in", scaleFrom: 1.0, scaleTo: 1.05 },
      }),
    ]);
    const plan = planFromAssemblyTimeline(tl, [makeMeta({ durationSec: 10 })]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      sourceVideoIndex: 0,
      sourceStartSec: 1,
      sourceEndSec: 3.5,
      targetStartSec: 0,
      targetEndSec: 2.5,
      animation: { type: "push_in", scaleFrom: 1.0, scaleTo: 1.05 },
    });
  });

  it("accumulates target linearly across multi-video clips (transitions do NOT shrink/overlap)", () => {
    // PROBE 第 4 节：转场不影响 target_timerange，纯线性累加
    const tl = makeTimeline([
      makeClip({
        sourceVideoIndex: 0,
        sourceStartSec: 0,
        sourceEndSec: 2,
      }),
      makeClip({
        sourceVideoIndex: 2,
        sourceVideoId: "vid-2",
        order: 1,
        sourceStartSec: 1,
        sourceEndSec: 4,
        incomingTransition: { type: "cross_dissolve", durationSec: 0.4, reason: "" },
      }),
      makeClip({
        sourceVideoIndex: 1,
        sourceVideoId: "vid-1",
        order: 2,
        sourceStartSec: 0.5,
        sourceEndSec: 2.5,
        incomingTransition: { type: "whip_pan", durationSec: 0.3, reason: "" },
      }),
    ]);
    const metas = [
      makeMeta({ durationSec: 10 }),
      makeMeta({ durationSec: 10 }),
      makeMeta({ durationSec: 10 }),
    ];
    const plan = planFromAssemblyTimeline(tl, metas);
    expect(plan.map((p) => p.sourceVideoIndex)).toEqual([0, 2, 1]);
    expect(plan.map((p) => p.targetStartSec)).toEqual([0, 2, 5]);
    expect(plan.map((p) => p.targetEndSec)).toEqual([2, 5, 7]);
  });

  it("clamps out-of-range sourceVideoIndex to 0 and warns", () => {
    const tl = makeTimeline([
      makeClip({ sourceVideoIndex: 5, sourceStartSec: 0, sourceEndSec: 2 }),
    ]);
    const plan = planFromAssemblyTimeline(tl, [makeMeta(), makeMeta()]);
    expect(plan).toHaveLength(1);
    expect(plan[0].sourceVideoIndex).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    const msgs = collectWarnMessages();
    expect(msgs.some((m) => m.includes("sourceVideoIndex") && m.includes("5"))).toBe(true);
  });

  it("clamps sourceEndSec to meta.durationSec and warns when overrun", () => {
    const tl = makeTimeline([
      makeClip({
        sourceVideoIndex: 0,
        sourceStartSec: 0,
        sourceEndSec: 999,
      }),
    ]);
    const plan = planFromAssemblyTimeline(tl, [makeMeta({ durationSec: 5 })]);
    expect(plan).toHaveLength(1);
    expect(plan[0].sourceEndSec).toBeCloseTo(5);
    expect(plan[0].targetEndSec).toBeCloseTo(5);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("skips degenerate clips (sourceStartSec >= clamped sourceEndSec) and warns", () => {
    // sourceStartSec 已超过 meta.durationSec，clamp 后退化为零时长 → skip
    const tl = makeTimeline([
      makeClip({
        sourceVideoIndex: 0,
        sourceStartSec: 0,
        sourceEndSec: 2,
      }),
      makeClip({
        sourceVideoIndex: 0,
        order: 1,
        sourceStartSec: 99,
        sourceEndSec: 100,
      }),
      makeClip({
        sourceVideoIndex: 0,
        order: 2,
        sourceStartSec: 3,
        sourceEndSec: 5,
      }),
    ]);
    const plan = planFromAssemblyTimeline(tl, [makeMeta({ durationSec: 6 })]);
    expect(plan).toHaveLength(2);
    expect(plan.map((p) => p.sourceStartSec)).toEqual([0, 3]);
    expect(plan.map((p) => p.targetStartSec)).toEqual([0, 2]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to alternating push_in / pull_out when clip.animation is null", () => {
    const tl = makeTimeline([
      makeClip({ sourceVideoIndex: 0, sourceStartSec: 0, sourceEndSec: 2, animation: null }),
      makeClip({
        sourceVideoIndex: 0,
        order: 1,
        sourceStartSec: 2,
        sourceEndSec: 4,
        animation: null,
      }),
    ]);
    const plan = planFromAssemblyTimeline(tl, [makeMeta({ durationSec: 10 })]);
    expect(plan).toHaveLength(2);
    expect(plan[0].animation.type).toBe("push_in");
    expect(plan[1].animation.type).toBe("pull_out");
  });

  it("treats animation.type=='none' as no animation, not fallback", () => {
    const tl = makeTimeline([
      makeClip({
        sourceVideoIndex: 0,
        sourceStartSec: 0,
        sourceEndSec: 2,
        animation: { type: "none" },
      }),
    ]);
    const plan = planFromAssemblyTimeline(tl, [makeMeta({ durationSec: 10 })]);
    expect(plan[0].animation).toEqual({ type: "none" });
  });
});

describe("clampTransitionDurationSec", () => {
  it("returns input duration when comfortably under half of both adjacent segments", () => {
    expect(clampTransitionDurationSec(0.4, 3, 3)).toBeCloseTo(0.4);
  });

  it("clamps to half of the shorter neighbor when transition is too long", () => {
    // 前段 1s, 当前段 4s → 上限 0.5s
    expect(clampTransitionDurationSec(2, 1, 4)).toBeCloseTo(0.5);
    // 前段 5s, 当前段 0.8s → 上限 0.4s
    expect(clampTransitionDurationSec(1.5, 5, 0.8)).toBeCloseTo(0.4);
  });

  it("clamps negative / zero / NaN input to 0", () => {
    expect(clampTransitionDurationSec(-1, 3, 3)).toBe(0);
    expect(clampTransitionDurationSec(0, 3, 3)).toBe(0);
    expect(clampTransitionDurationSec(Number.NaN, 3, 3)).toBe(0);
  });

  it("clamps to 0 when either neighbor has zero / invalid duration", () => {
    expect(clampTransitionDurationSec(0.5, 0, 3)).toBe(0);
    expect(clampTransitionDurationSec(0.5, 3, 0)).toBe(0);
    expect(clampTransitionDurationSec(0.5, Number.NaN, 3)).toBe(0);
  });
});
