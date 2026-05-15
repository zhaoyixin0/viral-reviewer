import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  packageDraftAsZip,
  type PackageInput,
} from "@/lib/capcut-compiler/package";
import {
  buildDraftContent,
  dedupeFileNames,
  type CompileInput,
} from "@/lib/capcut-compiler/build";
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
import type { DraftContent, DraftMetaInfo } from "@/lib/capcut-compiler/schema";

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

function buildArtifacts(input?: CompileInput): {
  draftContent: DraftContent;
  metaInfo: DraftMetaInfo;
} {
  return buildDraftContent(input ?? makeInput());
}

async function buildZipSingle(): Promise<JSZip> {
  const { draftContent, metaInfo } = buildArtifacts();
  const bytes = await packageDraftAsZip({
    projectName: "test-project",
    draftContent,
    metaInfo,
    videos: [{ buffer: Buffer.from("fake-mp4-bytes"), fileName: "my-video.mp4" }],
  });
  return JSZip.loadAsync(Buffer.from(bytes));
}

describe("packageDraftAsZip — structure", () => {
  it("puts the 3 setup scripts at the zip root", async () => {
    const zip = await buildZipSingle();
    expect(zip.file("setup.bat")).not.toBeNull();
    expect(zip.file("setup.ps1")).not.toBeNull();
    expect(zip.file("setup.sh")).not.toBeNull();
  });

  it("keeps the project folder structure", async () => {
    const zip = await buildZipSingle();
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
    const zip = await buildZipSingle();
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
    const zip = await buildZipSingle();
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

// ============================================================
// Task 11 · 多视频打包
// ============================================================

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
  const dur = clips.reduce(
    (acc, c) => acc + (c.sourceEndSec - c.sourceStartSec),
    0,
  );
  return {
    clips,
    estimatedDurationSec: dur,
    narrativeSummary: "test",
    rationale: "test",
  };
}

describe("packageDraftAsZip — Task 11 multi-video", () => {
  it("N 视频 buffer 全进 materials/，按 fileName 写入", async () => {
    const fileNames = ["clip-a.mp4", "clip-b.mp4", "clip-c.mp4"];
    const { draftContent, metaInfo } = buildArtifacts(
      makeInput({
        videoFileNames: fileNames,
        metas: [META, META, META],
      }),
    );
    const bytes = await packageDraftAsZip({
      projectName: "multi",
      draftContent,
      metaInfo,
      videos: fileNames.map((fileName, i) => ({
        buffer: Buffer.from(`fake-mp4-${i}`),
        fileName,
      })),
    });
    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    for (const fileName of fileNames) {
      expect(zip.file(`multi/materials/${fileName}`)).not.toBeNull();
    }
  });

  it("同名输入 → 文件名 dedupe 后 zip 内 3 个不同文件", async () => {
    // 模拟用户上传 3 个 IMG_0001.mp4 → sanitize 全部为 IMG_0001.mp4 → dedupe
    const raw = ["IMG_0001.mp4", "IMG_0001.mp4", "IMG_0001.mp4"];
    const deduped = dedupeFileNames(raw);
    expect(deduped).toEqual(["IMG_0001.mp4", "IMG_0001-1.mp4", "IMG_0001-2.mp4"]);

    const { draftContent, metaInfo } = buildArtifacts(
      makeInput({ videoFileNames: deduped, metas: [META, META, META] }),
    );
    const bytes = await packageDraftAsZip({
      projectName: "dup",
      draftContent,
      metaInfo,
      videos: deduped.map((fileName, i) => ({
        buffer: Buffer.from(`fake-mp4-${i}`),
        fileName,
      })),
    });
    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    expect(zip.file("dup/materials/IMG_0001.mp4")).not.toBeNull();
    expect(zip.file("dup/materials/IMG_0001-1.mp4")).not.toBeNull();
    expect(zip.file("dup/materials/IMG_0001-2.mp4")).not.toBeNull();
    // 三处一致性：path / file_Path / zip 文件名
    expect(draftContent.materials.videos[0]!.path).toContain(
      "/materials/IMG_0001.mp4",
    );
    expect(draftContent.materials.videos[1]!.path).toContain(
      "/materials/IMG_0001-1.mp4",
    );
    expect(draftContent.materials.videos[2]!.path).toContain(
      "/materials/IMG_0001-2.mp4",
    );
  });

  it("空 videos 数组 → 抛错（防御性约束）", async () => {
    const { draftContent, metaInfo } = buildArtifacts();
    await expect(
      packageDraftAsZip({
        projectName: "empty",
        draftContent,
        metaInfo,
        videos: [],
      } satisfies PackageInput),
    ).rejects.toThrow(/videos must be non-empty/);
  });

  it("DEFLATE level:1 仍可正常解压（每个 buffer 字节回读 = 原 buffer）", async () => {
    const buf = Buffer.from(
      // 故意造一段不太可压缩的字节：随机性高，level 1 不容易出问题
      Array.from({ length: 4096 }, (_, i) => (i * 31) % 251),
    );
    const { draftContent, metaInfo } = buildArtifacts();
    const bytes = await packageDraftAsZip({
      projectName: "compressed",
      draftContent,
      metaInfo,
      videos: [{ buffer: buf, fileName: "my-video.mp4" }],
    });
    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    const stored = await zip
      .file("compressed/materials/my-video.mp4")!
      .async("nodebuffer");
    expect(Buffer.compare(stored, buf)).toBe(0);
  });
});

// ============================================================
// Task 11 · README 模板
// ============================================================

describe("packageDraftAsZip — README content", () => {
  it("写入 N 段视频数（单视频 = 1）", async () => {
    const zip = await buildZipSingle();
    const readme = await zip.file("test-project/README.txt")!.async("string");
    expect(readme).toContain("1 段视频");
    // 旧文案"复杂转场（whip pan / match cut / 速度坡）"在 Task 11 后已删
    expect(readme).not.toContain("复杂转场");
  });

  it("多视频写入正确段数", async () => {
    const fileNames = ["a.mp4", "b.mp4", "c.mp4", "d.mp4"];
    const { draftContent, metaInfo } = buildArtifacts(
      makeInput({
        videoFileNames: fileNames,
        metas: [META, META, META, META],
      }),
    );
    const bytes = await packageDraftAsZip({
      projectName: "p",
      draftContent,
      metaInfo,
      videos: fileNames.map((fileName, i) => ({
        buffer: Buffer.from(`b${i}`),
        fileName,
      })),
    });
    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    const readme = await zip.file("p/README.txt")!.async("string");
    expect(readme).toContain("4 段视频");
  });

  it("无真转场 → README 写 '无（hard_cut 直切）'", async () => {
    const zip = await buildZipSingle();
    const readme = await zip.file("test-project/README.txt")!.async("string");
    expect(readme).toContain("已应用转场：无（hard_cut 直切）");
  });

  it("有真转场 → README 列出 unique transition name（按 draft.materials.transitions 派生）", async () => {
    // 用 assemblyTimeline 路径触发转场写入
    const timeline = makeTimeline([
      makeClip({ order: 0, sourceStartSec: 0, sourceEndSec: 2 }),
      makeClip({
        order: 1,
        sourceStartSec: 2,
        sourceEndSec: 4,
        incomingTransition: { type: "cross_dissolve", durationSec: 0.5, reason: "t" },
      }),
      makeClip({
        order: 2,
        sourceStartSec: 4,
        sourceEndSec: 6,
        incomingTransition: { type: "whip_pan", durationSec: 0.5, reason: "t" },
      }),
    ]);
    const { draftContent, metaInfo } = buildArtifacts(
      makeInput({
        match: { ...BASE_MATCH, assemblyTimeline: timeline } as TechniqueMatchingResult,
      }),
    );
    const bytes = await packageDraftAsZip({
      projectName: "trans",
      draftContent,
      metaInfo,
      videos: [{ buffer: Buffer.from("x"), fileName: "my-video.mp4" }],
    });
    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    const readme = await zip.file("trans/README.txt")!.async("string");
    expect(readme).toContain("叠化"); // cross_dissolve
    expect(readme).toContain("Slick Twist"); // whip_pan
    expect(readme).toContain(" / "); // 多个 transitions join
  });
});
