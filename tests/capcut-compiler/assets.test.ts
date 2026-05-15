import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "fs/promises";
import { basename } from "path";
import { tmpdir } from "os";
import { cleanupAssets, prepareAssets } from "@/lib/capcut-compiler/assets";
import { createUrlAllowlist } from "@/lib/url-allowlist";

/**
 * 测试 fixture URL 域 `example.test` —— P3 #2 phase 2 后 prepareAssets 入口 SSRF
 * check 需要 allowlist 实例。这里用宽松 preset 让既有 fixture 通过；新增 SSRF
 * deny 路径在 tests/url-allowlist/*.test.ts 已覆盖。
 */
const PERMISSIVE_TEST_ALLOWLIST = createUrlAllowlist({
  allowedSchemes: ["https:"],
  allowedHosts: [{ suffix: ".example.test" }],
  blockPrivateIps: false,
});

/**
 * Task 7：prepareAssets 多视频并发下载用例。
 *
 * 走 vi.stubGlobal('fetch') mock 网络，保留真文件系统（写入 OS tmpdir）。
 * 成功用例 afterEach 主动 cleanupAssets；失败用例 prepareAssets 内部已
 * cleanup（防止 partial workDir 残留），测试不用兜底。
 */

type FetchMock = ReturnType<typeof vi.fn>;

const TEXT_BYTES = (s: string) =>
  new TextEncoder().encode(s).buffer as ArrayBuffer;

function makeOkResponse(body: ArrayBuffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => body,
  } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

describe("prepareAssets (Task 7 multi-video)", () => {
  let fetchMock: FetchMock;
  const trackedWorkDirs: string[] = [];

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const dir of trackedWorkDirs.splice(0)) {
      await cleanupAssets(dir);
    }
  });

  it("rejects empty videoUrls", async () => {
    await expect(
      prepareAssets([], undefined, { urlAllowlist: PERMISSIVE_TEST_ALLOWLIST }),
    ).rejects.toThrow("videoUrls must be a non-empty array");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads a single video to input-0.mp4 under a fresh workDir", async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse(TEXT_BYTES("video-0")));

    const ws = await prepareAssets(["https://example.test/a.mp4"], undefined, {
      urlAllowlist: PERMISSIVE_TEST_ALLOWLIST,
    });
    trackedWorkDirs.push(ws.workDir);

    expect(ws.workDir.startsWith(tmpdir())).toBe(true);
    expect(ws.videoPaths).toHaveLength(1);
    expect(basename(ws.videoPaths[0])).toBe("input-0.mp4");
    expect(ws.bgmPath).toBeUndefined();

    const bytes = await readFile(ws.videoPaths[0], "utf-8");
    expect(bytes).toBe("video-0");
  });

  it("downloads N videos concurrently to input-{i}.mp4 preserving order", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const idx = Number(/idx=(\d+)/.exec(url)![1]);
      return makeOkResponse(TEXT_BYTES(`payload-${idx}`));
    });

    const urls = [
      "https://example.test/v.mp4?idx=0",
      "https://example.test/v.mp4?idx=1",
      "https://example.test/v.mp4?idx=2",
    ];

    const ws = await prepareAssets(urls, undefined, {
      urlAllowlist: PERMISSIVE_TEST_ALLOWLIST,
    });
    trackedWorkDirs.push(ws.workDir);

    expect(ws.videoPaths.map((p) => basename(p))).toEqual([
      "input-0.mp4",
      "input-1.mp4",
      "input-2.mp4",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const contents = await Promise.all(
      ws.videoPaths.map((p) => readFile(p, "utf-8")),
    );
    expect(contents).toEqual(["payload-0", "payload-1", "payload-2"]);
  });

  it("throws with failed index and logs per-failure error when one video 404s", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fetchMock.mockImplementation(async (url: string) => {
        const idx = Number(/idx=(\d+)/.exec(url)![1]);
        if (idx === 1) return makeErrorResponse(404);
        return makeOkResponse(TEXT_BYTES(`ok-${idx}`));
      });

      await expect(
        prepareAssets(
          [
            "https://example.test/v.mp4?idx=0",
            "https://example.test/v.mp4?idx=1",
            "https://example.test/v.mp4?idx=2",
          ],
          undefined,
          { urlAllowlist: PERMISSIVE_TEST_ALLOWLIST },
        ),
      ).rejects.toThrow(/Failed to download videos: #1/);

      const calls = errSpy.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((m) => m.includes("video #1") && m.includes("404")),
      ).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("lists all failed indexes in throw message when multiple videos fail", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fetchMock.mockImplementation(async (url: string) => {
        const idx = Number(/idx=(\d+)/.exec(url)![1]);
        if (idx === 0 || idx === 2) return makeErrorResponse(500);
        return makeOkResponse(TEXT_BYTES(`ok-${idx}`));
      });

      await expect(
        prepareAssets(
          [
            "https://example.test/v.mp4?idx=0",
            "https://example.test/v.mp4?idx=1",
            "https://example.test/v.mp4?idx=2",
          ],
          undefined,
          { urlAllowlist: PERMISSIVE_TEST_ALLOWLIST },
        ),
      ).rejects.toThrow(/#0, #2 \(2\/3\)/);

      const errMsgs = errSpy.mock.calls.map((c) => String(c[0]));
      expect(
        errMsgs.filter((m) => m.includes("download failed")),
      ).toHaveLength(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("treats fetch network rejection as failure with index", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fetchMock.mockImplementation(async (url: string) => {
        const idx = Number(/idx=(\d+)/.exec(url)![1]);
        if (idx === 0) throw new Error("ECONNRESET");
        return makeOkResponse(TEXT_BYTES(`ok-${idx}`));
      });

      await expect(
        prepareAssets(
          [
            "https://example.test/v.mp4?idx=0",
            "https://example.test/v.mp4?idx=1",
          ],
          undefined,
          { urlAllowlist: PERMISSIVE_TEST_ALLOWLIST },
        ),
      ).rejects.toThrow(/#0/);

      const errMsgs = errSpy.mock.calls.map((c) => String(c[0]));
      expect(
        errMsgs.some((m) => m.includes("video #0") && m.includes("ECONNRESET")),
      ).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("downloads BGM after videos when bgmUrl given (success path)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("bgm.mp3")) return makeOkResponse(TEXT_BYTES("bgm-bytes"));
      return makeOkResponse(TEXT_BYTES("video-bytes"));
    });

    const ws = await prepareAssets(
      ["https://example.test/v.mp4"],
      "https://example.test/bgm.mp3",
      { urlAllowlist: PERMISSIVE_TEST_ALLOWLIST },
    );
    trackedWorkDirs.push(ws.workDir);

    expect(ws.bgmPath).toBeDefined();
    expect(basename(ws.bgmPath!)).toBe("bgm.mp3");

    const bgmBytes = await readFile(ws.bgmPath!, "utf-8");
    expect(bgmBytes).toBe("bgm-bytes");
  });

  it("throws and logs when BGM download fails even if videos succeeded", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith("bgm.mp3")) return makeErrorResponse(403);
        return makeOkResponse(TEXT_BYTES("ok"));
      });

      await expect(
        prepareAssets(
          ["https://example.test/v.mp4"],
          "https://example.test/bgm.mp3",
          { urlAllowlist: PERMISSIVE_TEST_ALLOWLIST },
        ),
      ).rejects.toThrow(/Failed to download BGM/);

      const errMsgs = errSpy.mock.calls.map((c) => String(c[0]));
      expect(
        errMsgs.some(
          (m) => m.includes("bgm download failed") && m.includes("403"),
        ),
      ).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });
});
