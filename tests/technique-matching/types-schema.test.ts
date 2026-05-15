import { describe, expect, it } from "vitest";
import {
  AssemblyTimelineSchema,
  TechniqueMatchingResultSchema,
} from "@/lib/technique-matching/types";
import { Schema as TechniqueMatchRequestSchema } from "@/app/api/technique-match/schema";
import { RequestSchema as CompileCapcutRequestSchema } from "@/app/api/compile-capcut/schema";

/** 最小合法 TechniqueMatchingResult（不含多视频改造的新字段） */
const baseResult = {
  userVideoId: "user-1",
  reports: [],
  topPriorityActions: [],
};

const assemblyTimeline = {
  clips: [
    {
      sourceVideoIndex: 0,
      sourceVideoId: "user-1",
      order: 0,
      sourceStartSec: 0,
      sourceEndSec: 3.5,
      animation: null,
      incomingTransition: null,
      reason: "开场钩子",
    },
    {
      sourceVideoIndex: 1,
      sourceVideoId: "user-2",
      order: 1,
      sourceStartSec: 1.2,
      sourceEndSec: 4,
      animation: { type: "push_in", scaleFrom: 1, scaleTo: 1.25 },
      incomingTransition: {
        type: "cross_dissolve",
        durationSec: 0.4,
        reason: "平滑承接",
      },
      reason: "高潮段落",
    },
  ],
  estimatedDurationSec: 6.3,
  narrativeSummary: "钩子 → 高潮",
  rationale: "两段素材叙事互补",
};

describe("TechniqueMatchingResultSchema · 多视频改造向后兼容", () => {
  it("解析不带 assemblyTimeline 的旧分析结果（向后兼容）", () => {
    const r = TechniqueMatchingResultSchema.safeParse(baseResult);
    expect(r.success).toBe(true);
  });

  it("解析带 assemblyTimeline + userVideoIds 的新分析结果", () => {
    const r = TechniqueMatchingResultSchema.safeParse({
      ...baseResult,
      userVideoIds: ["user-1", "user-2"],
      assemblyTimeline,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.assemblyTimeline?.clips).toHaveLength(2);
      expect(r.data.assemblyTimeline?.clips[0].incomingTransition).toBeNull();
    }
  });

  it("assemblyTimeline 显式为 null 也能通过（.nullable()）", () => {
    const r = TechniqueMatchingResultSchema.safeParse({
      ...baseResult,
      assemblyTimeline: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("AssemblyTimelineSchema", () => {
  it("接受合法时间线", () => {
    expect(AssemblyTimelineSchema.safeParse(assemblyTimeline).success).toBe(true);
  });

  it("拒绝负数 sourceVideoIndex", () => {
    const bad = {
      ...assemblyTimeline,
      clips: [{ ...assemblyTimeline.clips[0], sourceVideoIndex: -1 }],
    };
    expect(AssemblyTimelineSchema.safeParse(bad).success).toBe(false);
  });

  it("拒绝 sourceEndSec <= sourceStartSec 的零/负时长 clip", () => {
    const bad = {
      ...assemblyTimeline,
      clips: [
        { ...assemblyTimeline.clips[0], sourceStartSec: 3, sourceEndSec: 3 },
      ],
    };
    expect(AssemblyTimelineSchema.safeParse(bad).success).toBe(false);
  });
});

describe("technique-match route Schema · Task 14 纯数组收紧", () => {
  it("videoUrls 数组合法时通过", () => {
    const r = TechniqueMatchRequestSchema.safeParse({
      videoUrls: [
        "https://blob.example.com/a.mp4",
        "https://blob.example.com/b.mp4",
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.videoUrls).toHaveLength(2);
      expect(r.data.videoUrls[0]).toBe("https://blob.example.com/a.mp4");
    }
  });

  it("只发旧的 videoUrl 单字段（无 videoUrls）→ 失败", () => {
    const r = TechniqueMatchRequestSchema.safeParse({
      videoUrl: "https://blob.example.com/a.mp4",
    });
    expect(r.success).toBe(false);
  });

  it("videoUrls 缺失 → 失败", () => {
    expect(TechniqueMatchRequestSchema.safeParse({ topic: "x" }).success).toBe(
      false,
    );
  });

  it("videoUrls 空数组 → 失败（min 1）", () => {
    expect(
      TechniqueMatchRequestSchema.safeParse({ videoUrls: [] }).success,
    ).toBe(false);
  });

  it("videoUrls 长度 > 6 → 失败（max 6）", () => {
    const urls = Array.from(
      { length: 7 },
      (_, i) => `https://blob.example.com/${i}.mp4`,
    );
    expect(
      TechniqueMatchRequestSchema.safeParse({ videoUrls: urls }).success,
    ).toBe(false);
  });
});

describe("compile-capcut route RequestSchema · Task 14 纯数组收紧", () => {
  it("videoUrls + videoFileNames 数组等长合法时通过", () => {
    const r = CompileCapcutRequestSchema.safeParse({
      projectName: "demo",
      videoUrls: [
        "https://blob.example.com/a.mp4",
        "https://blob.example.com/b.mp4",
      ],
      videoFileNames: ["a.mp4", "b.mp4"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.videoUrls).toHaveLength(2);
      expect(r.data.videoFileNames).toEqual(["a.mp4", "b.mp4"]);
    }
  });

  it("只发旧的 videoUrl + videoFileName 单字段 → 失败", () => {
    const r = CompileCapcutRequestSchema.safeParse({
      projectName: "demo",
      videoUrl: "https://blob.example.com/a.mp4",
      videoFileName: "a.mp4",
    });
    expect(r.success).toBe(false);
  });

  it("videoFileNames 缺失（只 videoUrls）→ 通过（数组 optional，下游退化为 input.mp4）", () => {
    const r = CompileCapcutRequestSchema.safeParse({
      projectName: "demo",
      videoUrls: ["https://blob.example.com/a.mp4"],
    });
    expect(r.success).toBe(true);
  });

  it("videoUrls 与 videoFileNames 长度不一致 → 失败（refine 等长不变量）", () => {
    const r = CompileCapcutRequestSchema.safeParse({
      projectName: "demo",
      videoUrls: [
        "https://blob.example.com/a.mp4",
        "https://blob.example.com/b.mp4",
      ],
      videoFileNames: ["a.mp4"],
    });
    expect(r.success).toBe(false);
  });

  it("videoUrls 空数组 → 失败（min 1）", () => {
    const r = CompileCapcutRequestSchema.safeParse({
      projectName: "demo",
      videoUrls: [],
    });
    expect(r.success).toBe(false);
  });

  it("videoUrls 长度 > 6 → 失败（max 6）", () => {
    const urls = Array.from(
      { length: 7 },
      (_, i) => `https://blob.example.com/${i}.mp4`,
    );
    const r = CompileCapcutRequestSchema.safeParse({
      projectName: "demo",
      videoUrls: urls,
    });
    expect(r.success).toBe(false);
  });
});
