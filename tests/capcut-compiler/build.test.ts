import { describe, expect, it } from "vitest";
import { buildDraftContent, type CompileInput } from "@/lib/capcut-compiler/build";
import {
  TOKEN_PROJECT_DIR,
  TOKEN_DRAFTS_DIR,
} from "@/lib/capcut-compiler/setup-scripts/tokens";
import type { VideoMeta } from "@/lib/video/ffprobe-meta";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";

const META: VideoMeta = {
  durationSec: 10,
  fps: 30,
  width: 1080,
  height: 1920,
  codec: "h264",
  bitrate: 1_000_000,
  hasAudio: true,
};

function makeInput(over: Partial<CompileInput> = {}): CompileInput {
  return {
    projectName: "test-project",
    videoFileName: "my-video.mp4",
    meta: META,
    potential: { base: { actions: [] } } as unknown as MaterialPotential,
    match: {
      userVideoId: "u",
      reports: [],
      topPriorityActions: [],
      globalDoNots: [],
      recommendedBgms: [],
      trimRanges: [],
    } as unknown as TechniqueMatchingResult,
    ...over,
  };
}

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
