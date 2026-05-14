import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { packageDraftAsZip } from "@/lib/capcut-compiler/package";
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

function makeInput(): CompileInput {
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
  };
}

async function buildZip() {
  const { draftContent, metaInfo } = buildDraftContent(makeInput());
  const bytes = await packageDraftAsZip({
    projectName: "test-project",
    draftContent,
    metaInfo,
    videoBuffer: Buffer.from("fake-mp4-bytes"),
    videoFileName: "my-video.mp4",
  });
  return JSZip.loadAsync(Buffer.from(bytes));
}

describe("packageDraftAsZip — structure", () => {
  it("puts the 3 setup scripts at the zip root", async () => {
    const zip = await buildZip();
    expect(zip.file("setup.bat")).not.toBeNull();
    expect(zip.file("setup.ps1")).not.toBeNull();
    expect(zip.file("setup.sh")).not.toBeNull();
  });

  it("keeps the project folder structure", async () => {
    const zip = await buildZip();
    expect(zip.file("test-project/draft_content.json")).not.toBeNull();
    expect(zip.file("test-project/draft_meta_info.json")).not.toBeNull();
    expect(zip.file("test-project/README.txt")).not.toBeNull();
    expect(zip.file("test-project/materials/my-video.mp4")).not.toBeNull();
  });
});

describe("packageDraftAsZip — token replacement contract", () => {
  // 这个函数必须和 setup.ps1 / setup.sh 做的字面替换完全一致。
  // 若改了 token 或脚本替换逻辑，这里也要同步。
  function applyTokens(raw: string, projectDir: string, draftsDir: string) {
    return raw
      .split(TOKEN_PROJECT_DIR)
      .join(projectDir)
      .split(TOKEN_DRAFTS_DIR)
      .join(draftsDir);
  }

  it("draft_content.json contains tokens and resolves to valid JSON with absolute paths", async () => {
    const zip = await buildZip();
    const raw = await zip.file("test-project/draft_content.json")!.async("string");
    expect(raw).toContain(TOKEN_PROJECT_DIR);

    const resolved = applyTokens(
      raw,
      "C:/fake/com.lveditor.draft/test-project",
      "C:/fake/com.lveditor.draft",
    );
    expect(resolved).not.toContain(TOKEN_PROJECT_DIR);
    const parsed = JSON.parse(resolved);
    expect(parsed.materials.videos[0].path).toBe(
      "C:/fake/com.lveditor.draft/test-project/materials/my-video.mp4",
    );
  });

  it("draft_meta_info.json tokens resolve to valid JSON", async () => {
    const zip = await buildZip();
    const raw = await zip.file("test-project/draft_meta_info.json")!.async("string");
    expect(raw).toContain(TOKEN_DRAFTS_DIR);

    const resolved = applyTokens(
      raw,
      "C:/fake/com.lveditor.draft/test-project",
      "C:/fake/com.lveditor.draft",
    );
    const parsed = JSON.parse(resolved);
    expect(parsed.draft_fold_path).toBe(
      "C:/fake/com.lveditor.draft/test-project",
    );
    expect(parsed.draft_root_path).toBe("C:/fake/com.lveditor.draft");
    expect(parsed.draft_materials[0].value[0].file_Path).toBe(
      "C:/fake/com.lveditor.draft/test-project/materials/my-video.mp4",
    );
  });
});
