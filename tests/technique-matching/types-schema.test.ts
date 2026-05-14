import { describe, expect, it } from "vitest";
import {
  AssemblyTimelineSchema,
  TechniqueMatchingResultSchema,
} from "@/lib/technique-matching/types";
import { Schema as TechniqueMatchRequestSchema } from "@/app/api/technique-match/route";
import { RequestSchema as CompileCapcutRequestSchema } from "@/app/api/compile-capcut/route";

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

describe("technique-match route Schema · C1 兼容层", () => {
  it("旧形态请求体（只带 videoUrl）仍能解析出 videoUrl", () => {
    const r = TechniqueMatchRequestSchema.safeParse({
      videoUrl: "https://blob.example.com/a.mp4",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const data = r.data as { videoUrl: string; videoUrls?: string[] };
      expect(data.videoUrl).toBe("https://blob.example.com/a.mp4");
      expect(data.videoUrls).toEqual(["https://blob.example.com/a.mp4"]);
    }
  });

  it("新形态请求体（videoUrls 数组）派生出 videoUrl = videoUrls[0]", () => {
    const r = TechniqueMatchRequestSchema.safeParse({
      videoUrls: [
        "https://blob.example.com/a.mp4",
        "https://blob.example.com/b.mp4",
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const data = r.data as { videoUrl: string; videoUrls?: string[] };
      expect(data.videoUrl).toBe("https://blob.example.com/a.mp4");
      expect(data.videoUrls).toHaveLength(2);
    }
  });

  it("既无 videoUrl 也无 videoUrls 时校验失败", () => {
    expect(TechniqueMatchRequestSchema.safeParse({ topic: "x" }).success).toBe(
      false,
    );
  });
});

describe("compile-capcut route RequestSchema · C1 兼容层", () => {
  it("旧形态请求体（videoUrl + videoFileName）仍能解析出单值字段", () => {
    const r = CompileCapcutRequestSchema.safeParse({
      projectName: "demo",
      videoUrl: "https://blob.example.com/a.mp4",
      videoFileName: "a.mp4",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const data = r.data as {
        videoUrl: string;
        videoUrls?: string[];
        videoFileName?: string;
        videoFileNames?: string[];
      };
      expect(data.videoUrl).toBe("https://blob.example.com/a.mp4");
      expect(data.videoUrls).toEqual(["https://blob.example.com/a.mp4"]);
      expect(data.videoFileNames).toEqual(["a.mp4"]);
    }
  });

  it("新形态请求体（videoUrls + videoFileNames 数组）派生出单值字段", () => {
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
      const data = r.data as { videoUrl: string; videoFileName?: string };
      expect(data.videoUrl).toBe("https://blob.example.com/a.mp4");
      expect(data.videoFileName).toBe("a.mp4");
    }
  });

  it("videoUrls 与 videoFileNames 长度不一致时校验失败", () => {
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
});
