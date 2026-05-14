import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETUP_PS1, SETUP_SH } from "@/lib/capcut-compiler/setup-scripts";
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
    projectName: "exec-test-project",
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

const isWindows = process.platform === "win32";

describe("setup script — real execution (CI-able, no CapCut needed)", () => {
  it("moves the project into the override drafts dir and resolves tokens to valid JSON", () => {
    const extractRoot = mkdtempSync(join(tmpdir(), "vr-setup-extract-"));
    const draftsTarget = mkdtempSync(join(tmpdir(), "vr-setup-drafts-"));
    try {
      const projectName = "exec-test-project";
      const projectDir = join(extractRoot, projectName);
      mkdirSync(projectDir);

      const { draftContent, metaInfo } = buildDraftContent(makeInput());
      writeFileSync(
        join(projectDir, "draft_content.json"),
        JSON.stringify(draftContent, null, 2),
      );
      writeFileSync(
        join(projectDir, "draft_meta_info.json"),
        JSON.stringify(metaInfo, null, 2),
      );

      // 把对应平台的脚本写到解压根（和 <projectName>/ 并列）
      const scriptName = isWindows ? "setup.ps1" : "setup.sh";
      const scriptBody = isWindows ? SETUP_PS1 : SETUP_SH;
      const scriptPath = join(extractRoot, scriptName);
      writeFileSync(scriptPath, scriptBody);

      // 跑脚本，VR_SETUP_DRAFTS_DIR 指向假 drafts target
      const env = { ...process.env, VR_SETUP_DRAFTS_DIR: draftsTarget };
      if (isWindows) {
        execFileSync(
          "powershell",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
          { env, stdio: "pipe" },
        );
      } else {
        execFileSync("bash", [scriptPath], { env, stdio: "pipe" });
      }

      // 项目应已搬进 draftsTarget，原位置应空
      const movedDir = join(draftsTarget, projectName);
      expect(existsSync(movedDir)).toBe(true);
      expect(existsSync(projectDir)).toBe(false);

      // 两个 JSON 都应 token-free 且可 JSON.parse
      for (const f of ["draft_content.json", "draft_meta_info.json"]) {
        const raw = readFileSync(join(movedDir, f), "utf-8");
        expect(raw).not.toContain(TOKEN_PROJECT_DIR);
        expect(raw).not.toContain(TOKEN_DRAFTS_DIR);
        expect(() => JSON.parse(raw)).not.toThrow();
      }

      // 路径替换成了 draftsTarget 下的绝对路径（脚本统一用正斜杠）
      const movedFwd = movedDir.replace(/\\/g, "/");
      const dc = JSON.parse(
        readFileSync(join(movedDir, "draft_content.json"), "utf-8"),
      );
      expect(dc.materials.videos[0].path).toBe(
        `${movedFwd}/materials/my-video.mp4`,
      );
      const mi = JSON.parse(
        readFileSync(join(movedDir, "draft_meta_info.json"), "utf-8"),
      );
      expect(mi.draft_fold_path).toBe(movedFwd);
      expect(mi.draft_materials[0].value[0].file_Path).toBe(
        `${movedFwd}/materials/my-video.mp4`,
      );
    } finally {
      rmSync(extractRoot, { recursive: true, force: true });
      rmSync(draftsTarget, { recursive: true, force: true });
    }
  });
});
