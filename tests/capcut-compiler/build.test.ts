import { describe, expect, it } from "vitest";
import { buildDraftContent, type CompileInput } from "@/lib/capcut-compiler/build";
import {
  TOKEN_PROJECT_DIR,
  TOKEN_DRAFTS_DIR,
} from "@/lib/capcut-compiler/setup-scripts/tokens";
import type { VideoMeta } from "@/lib/video/ffprobe-meta";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type {
  AssemblyClip,
  AssemblyTimeline,
  TechniqueMatchingResult,
} from "@/lib/technique-matching/types";
import type { VideoTrack } from "@/lib/capcut-compiler/schema";

const META: VideoMeta = {
  durationSec: 10,
  fps: 30,
  width: 1080,
  height: 1920,
  codec: "h264",
  bitrate: 1_000_000,
  hasAudio: true,
};

const BASE_MATCH = {
  userVideoId: "u",
  reports: [],
  topPriorityActions: [],
  globalDoNots: [],
  recommendedBgms: [],
  trimRanges: [],
} as unknown as TechniqueMatchingResult;

function makeInput(over: Partial<CompileInput> = {}): CompileInput {
  return {
    projectName: "test-project",
    videoFileNames: ["my-video.mp4"],
    metas: [META],
    potential: { base: { actions: [] } } as unknown as MaterialPotential,
    match: BASE_MATCH,
    ...over,
  };
}

function makeClip(over: Partial<AssemblyClip> = {}): AssemblyClip {
  return {
    sourceVideoIndex: 0,
    sourceVideoId: "v0",
    order: 0,
    sourceStartSec: 0,
    sourceEndSec: 2,
    animation: null,
    incomingTransition: null,
    reason: "test",
    ...over,
  };
}

function makeTimeline(clips: AssemblyClip[]): AssemblyTimeline {
  const dur = clips.reduce((acc, c) => acc + (c.sourceEndSec - c.sourceStartSec), 0);
  return {
    clips,
    estimatedDurationSec: dur,
    narrativeSummary: "test",
    rationale: "test",
  };
}

// ============================================================
// 旧单视频路径 —— 全部断言不变（blocking gate 的核心）
// ============================================================

describe("buildDraftContent — token paths", () => {
  it("video material path uses the project-dir token", () => {
    const { draftContent } = buildDraftContent(makeInput());
    expect(draftContent.materials.videos[0].path).toBe(
      `${TOKEN_PROJECT_DIR}/materials/my-video.mp4`,
    );
  });

  it("bgm audio path uses the project-dir token", () => {
    const { draftContent } = buildDraftContent(
      makeInput({ bgmFileName: "song.mp3", bgmDurationSec: 5 }),
    );
    expect(draftContent.materials.audios[0].path).toBe(
      `${TOKEN_PROJECT_DIR}/materials/song.mp3`,
    );
  });
});

describe("buildDraftContent — draft_meta_info", () => {
  it("fold/root paths use tokens", () => {
    const { metaInfo } = buildDraftContent(makeInput());
    expect(metaInfo.draft_fold_path).toBe(TOKEN_PROJECT_DIR);
    expect(metaInfo.draft_root_path).toBe(TOKEN_DRAFTS_DIR);
  });

  it("draft_materials has the 7-group native structure", () => {
    const { metaInfo } = buildDraftContent(makeInput());
    expect(metaInfo.draft_materials.map((g) => g.type)).toEqual([
      0, 1, 2, 3, 6, 7, 8,
    ]);
  });

  it("type-0 group holds the video entry; id matches the video material", () => {
    const { draftContent, metaInfo } = buildDraftContent(makeInput());
    const group0 = metaInfo.draft_materials.find((g) => g.type === 0)!;
    expect(group0.value).toHaveLength(1);
    const entry = group0.value[0];
    expect(entry.id).toBe(draftContent.materials.videos[0].id);
    expect(entry.file_Path).toBe(`${TOKEN_PROJECT_DIR}/materials/my-video.mp4`);
    expect(entry.extra_info).toBe("my-video.mp4");
    expect(entry.metetype).toBe("video");
    expect(entry.width).toBe(1080);
    expect(entry.height).toBe(1920);
  });

  it("type-0 group gets a second entry when BGM is present", () => {
    const { draftContent, metaInfo } = buildDraftContent(
      makeInput({ bgmFileName: "song.mp3", bgmDurationSec: 5 }),
    );
    const group0 = metaInfo.draft_materials.find((g) => g.type === 0)!;
    expect(group0.value).toHaveLength(2);
    const bgmEntry = group0.value[1];
    expect(bgmEntry.id).toBe(draftContent.materials.audios[0].id);
    expect(bgmEntry.metetype).toBe("music");
    expect(bgmEntry.extra_info).toBe("song.mp3");
  });
});

// ============================================================
// Blocking gate (W3 review I3) ·
// 旧单视频 match（无 assemblyTimeline）→ 编译输出与改造前逐字段一致
// ============================================================

describe("buildDraftContent — blocking gate: legacy single-video shape", () => {
  it("legacy match (no assemblyTimeline, N=1): single material, segments all point to it, no fitScale magnification", () => {
    const { draftContent, metaInfo } = buildDraftContent(makeInput());
    expect(draftContent.materials.videos).toHaveLength(1);
    expect(draftContent.canvas_config.width).toBe(META.width);
    expect(draftContent.canvas_config.height).toBe(META.height);
    const track = draftContent.tracks.find((t) => t.type === "video") as VideoTrack;
    const segments = track.segments;
    const onlyId = draftContent.materials.videos[0].id;
    for (const s of segments) {
      expect(s.material_id).toBe(onlyId);
      // metas[0] === segment meta ⇒ fitScale === 1 ⇒ clip.scale 应等于 animation.scaleFrom
      // 默认 BASE_MATCH 无 push_in/pull_out → scaleFrom === 1
      expect(s.clip!.scale.x).toBeCloseTo(1.0, 6);
      expect(s.clip!.scale.y).toBeCloseTo(1.0, 6);
    }
    const group0 = metaInfo.draft_materials.find((g) => g.type === 0)!;
    expect(group0.value).toHaveLength(1);
    expect(group0.value[0].id).toBe(onlyId);
  });
});

// ============================================================
// 多视频结构 —— 兼容路径（N metas, 无 assemblyTimeline）
// ============================================================

describe("buildDraftContent — multi-video shape (compat path)", () => {
  it("creates N videoMaterials when N metas/fileNames provided", () => {
    const { draftContent, metaInfo } = buildDraftContent(
      makeInput({
        videoFileNames: ["a.mp4", "b.mp4", "c.mp4"],
        metas: [META, META, META],
      }),
    );
    expect(draftContent.materials.videos).toHaveLength(3);
    expect(draftContent.materials.videos[0].path).toBe(
      `${TOKEN_PROJECT_DIR}/materials/a.mp4`,
    );
    expect(draftContent.materials.videos[1].path).toBe(
      `${TOKEN_PROJECT_DIR}/materials/b.mp4`,
    );
    expect(draftContent.materials.videos[2].path).toBe(
      `${TOKEN_PROJECT_DIR}/materials/c.mp4`,
    );
    const group0 = metaInfo.draft_materials.find((g) => g.type === 0)!;
    expect(group0.value).toHaveLength(3);
    expect(group0.value[0].id).toBe(draftContent.materials.videos[0].id);
    expect(group0.value[1].id).toBe(draftContent.materials.videos[1].id);
    expect(group0.value[2].id).toBe(draftContent.materials.videos[2].id);
  });

  it("compat path (no assemblyTimeline): all segments use videoMaterials[0].id", () => {
    const { draftContent } = buildDraftContent(
      makeInput({
        videoFileNames: ["a.mp4", "b.mp4"],
        metas: [META, META],
      }),
    );
    const segments = (draftContent.tracks.find((t) => t.type === "video")! as VideoTrack)
      .segments;
    const firstId = draftContent.materials.videos[0].id;
    for (const s of segments) {
      expect(s.material_id).toBe(firstId);
    }
  });

  it("canvas uses metas[0] dimensions regardless of later metas", () => {
    const { draftContent } = buildDraftContent(
      makeInput({
        videoFileNames: ["a.mp4", "b.mp4"],
        metas: [
          { ...META, width: 1080, height: 1920 },
          { ...META, width: 1920, height: 1080 },
        ],
      }),
    );
    expect(draftContent.canvas_config.width).toBe(1080);
    expect(draftContent.canvas_config.height).toBe(1920);
  });

  it("bgm group0 entry sits after all N video entries", () => {
    const { draftContent, metaInfo } = buildDraftContent(
      makeInput({
        videoFileNames: ["a.mp4", "b.mp4"],
        metas: [META, META],
        bgmFileName: "song.mp3",
        bgmDurationSec: 5,
      }),
    );
    const group0 = metaInfo.draft_materials.find((g) => g.type === 0)!;
    expect(group0.value).toHaveLength(3);
    expect(group0.value[0].metetype).toBe("video");
    expect(group0.value[1].metetype).toBe("video");
    expect(group0.value[2].metetype).toBe("music");
    expect(group0.value[2].id).toBe(draftContent.materials.audios[0].id);
  });
});

// ============================================================
// 多视频 + assemblyTimeline (Task 8 路径)
// ============================================================

describe("buildDraftContent — assemblyTimeline path", () => {
  const portrait = { ...META, width: 1080, height: 1920, durationSec: 10 };
  const landscape = { ...META, width: 1920, height: 1080, durationSec: 10 };
  const halfPortrait = { ...META, width: 540, height: 960, durationSec: 10 };

  it("segments use material_id based on sourceVideoIndex", () => {
    const timeline = makeTimeline([
      makeClip({ sourceVideoIndex: 0, sourceStartSec: 0, sourceEndSec: 2 }),
      makeClip({ sourceVideoIndex: 1, sourceStartSec: 0, sourceEndSec: 3 }),
      makeClip({ sourceVideoIndex: 0, sourceStartSec: 4, sourceEndSec: 5 }),
    ]);
    const { draftContent } = buildDraftContent(
      makeInput({
        videoFileNames: ["a.mp4", "b.mp4"],
        metas: [portrait, portrait],
        match: { ...BASE_MATCH, assemblyTimeline: timeline } as TechniqueMatchingResult,
      }),
    );
    const segments = (draftContent.tracks.find((t) => t.type === "video")! as VideoTrack)
      .segments;
    expect(segments).toHaveLength(3);
    expect(segments[0].material_id).toBe(draftContent.materials.videos[0].id);
    expect(segments[1].material_id).toBe(draftContent.materials.videos[1].id);
    expect(segments[2].material_id).toBe(draftContent.materials.videos[0].id);
  });

  it("fitScale = max(canvasW/segW, canvasH/segH) when segment meta differs from canvas", () => {
    const timeline = makeTimeline([
      makeClip({
        sourceVideoIndex: 1,
        sourceStartSec: 0,
        sourceEndSec: 3,
        animation: { type: "none" },
      }),
    ]);
    const { draftContent } = buildDraftContent(
      makeInput({
        videoFileNames: ["a.mp4", "b.mp4"],
        metas: [portrait, landscape],
        match: { ...BASE_MATCH, assemblyTimeline: timeline } as TechniqueMatchingResult,
      }),
    );
    const segments = (draftContent.tracks.find((t) => t.type === "video")! as VideoTrack)
      .segments;
    const expected = Math.max(1080 / 1920, 1920 / 1080);
    expect(segments[0]!.clip!.scale.x).toBeCloseTo(expected, 6);
    expect(segments[0]!.clip!.scale.y).toBeCloseTo(expected, 6);
    const scaleKf = segments[0]!.common_keyframes!.find(
      (k) => k.property_type === "KFTypeScaleX",
    )!;
    expect(scaleKf.keyframe_list[0]!.values[0]!).toBeCloseTo(expected, 6);
  });

  it("push_in keyframe scale baseline is multiplied by fitScale", () => {
    const timeline = makeTimeline([
      makeClip({
        sourceVideoIndex: 1,
        sourceStartSec: 0,
        sourceEndSec: 3,
        animation: { type: "push_in", scaleFrom: 1.0, scaleTo: 1.1 },
      }),
    ]);
    const { draftContent } = buildDraftContent(
      makeInput({
        videoFileNames: ["a.mp4", "b.mp4"],
        // canvas 1080×1920, seg meta 540×960 ⇒ fitScale = max(2, 2) = 2
        metas: [portrait, halfPortrait],
        match: { ...BASE_MATCH, assemblyTimeline: timeline } as TechniqueMatchingResult,
      }),
    );
    const segments = (draftContent.tracks.find((t) => t.type === "video")! as VideoTrack)
      .segments;
    const fitScale = 2;
    expect(segments[0]!.clip!.scale.x).toBeCloseTo(1.0 * fitScale, 6);
    const scaleKf = segments[0]!.common_keyframes!.find(
      (k) => k.property_type === "KFTypeScaleX",
    )!;
    expect(scaleKf.keyframe_list[0]!.values[0]!).toBeCloseTo(1.0 * fitScale, 6);
    expect(
      scaleKf.keyframe_list[scaleKf.keyframe_list.length - 1]!.values[0],
    ).toBeCloseTo(1.1 * fitScale, 6);
  });

  it("matching canvas size: fitScale=1, clip.scale equals scaleFrom", () => {
    const timeline = makeTimeline([
      makeClip({
        sourceVideoIndex: 0,
        sourceStartSec: 0,
        sourceEndSec: 2,
        animation: { type: "none" },
      }),
    ]);
    const { draftContent } = buildDraftContent(
      makeInput({
        videoFileNames: ["a.mp4", "b.mp4"],
        metas: [portrait, portrait],
        match: { ...BASE_MATCH, assemblyTimeline: timeline } as TechniqueMatchingResult,
      }),
    );
    const segments = (draftContent.tracks.find((t) => t.type === "video")! as VideoTrack)
      .segments;
    expect(segments[0]!.clip!.scale.x).toBeCloseTo(1.0, 6);
  });

  it("targetEndSec of last clip drives outputDuration", () => {
    const timeline = makeTimeline([
      makeClip({ sourceVideoIndex: 0, sourceStartSec: 0, sourceEndSec: 2 }),
      makeClip({ sourceVideoIndex: 1, sourceStartSec: 0, sourceEndSec: 3 }),
    ]);
    const { draftContent } = buildDraftContent(
      makeInput({
        videoFileNames: ["a.mp4", "b.mp4"],
        metas: [portrait, portrait],
        match: { ...BASE_MATCH, assemblyTimeline: timeline } as TechniqueMatchingResult,
      }),
    );
    // 总时长 = 2 + 3 = 5s = 5_000_000us
    expect(draftContent.duration).toBe(5_000_000);
  });
});
