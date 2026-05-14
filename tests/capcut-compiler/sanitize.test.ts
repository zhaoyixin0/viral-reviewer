import { describe, expect, it } from "vitest";
import { sanitizeVideoFileName } from "@/lib/capcut-compiler/build";

describe("sanitizeVideoFileName", () => {
  it("keeps a normal filename unchanged", () => {
    expect(sanitizeVideoFileName("20260429-200100.mp4")).toBe(
      "20260429-200100.mp4",
    );
  });

  it("strips directory components, keeps the basename", () => {
    expect(sanitizeVideoFileName("C:\\Users\\me\\clip.mp4")).toBe("clip.mp4");
    expect(sanitizeVideoFileName("/home/me/clip.mov")).toBe("clip.mov");
  });

  it("replaces filesystem-illegal characters with underscore", () => {
    expect(sanitizeVideoFileName('my:vi*deo?.mp4')).toBe("my_vi_deo_.mp4");
  });

  it("falls back to input.mp4 when undefined or empty", () => {
    expect(sanitizeVideoFileName(undefined)).toBe("input.mp4");
    expect(sanitizeVideoFileName("")).toBe("input.mp4");
    expect(sanitizeVideoFileName("   ")).toBe("input.mp4");
  });

  it("falls back to input.mp4 when the name contains a reserved token", () => {
    expect(sanitizeVideoFileName("__VR_PROJECT_DIR__.mp4")).toBe("input.mp4");
  });

  it("keeps unicode filenames", () => {
    expect(sanitizeVideoFileName("我的视频.mp4")).toBe("我的视频.mp4");
  });

  it("truncates an over-long filename, keeping the extension", () => {
    const result = sanitizeVideoFileName(`${"a".repeat(200)}.mp4`);
    expect(result.length).toBe(120);
    expect(result.endsWith(".mp4")).toBe(true);
  });

  it("truncates an over-long extensionless filename to 120 chars", () => {
    expect(sanitizeVideoFileName("z".repeat(200))).toBe("z".repeat(120));
  });
});
