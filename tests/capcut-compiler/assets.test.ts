import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "fs/promises";
import { basename } from "path";
import { tmpdir } from "os";

// Mock undici Pool (used by fetchWithAllowlist) — must hoist Pool tracking.
const { mockPoolInstances, mockPoolCtor } = vi.hoisted(() => {
  type MockPoolInstance = {
    origin: string;
    connect: { servername?: string };
    close: ReturnType<typeof vi.fn>;
  };
  const instances: MockPoolInstance[] = [];
  const ctor = vi.fn();
  return { mockPoolInstances: instances, mockPoolCtor: ctor };
});

vi.mock("undici", () => {
  class MockPool {
    origin: string;
    connect: { servername?: string };
    close = vi.fn().mockResolvedValue(undefined);
    constructor(origin: string, opts: { connect?: { servername?: string } }) {
      this.origin = origin;
      this.connect = opts.connect ?? {};
      mockPoolCtor(origin, opts);
      mockPoolInstances.push(this);
    }
  }
  return { Pool: MockPool };
});

// Mock node:dns/promises for checkAsync DNS resolve
vi.mock("node:dns", async () => {
  const actual = await vi.importActual<typeof import("node:dns")>("node:dns");
  return {
    ...actual,
    promises: {
      resolve4: vi.fn(),
      resolve6: vi.fn(),
    },
  };
});

import { promises as dns } from "node:dns";
import { cleanupAssets, prepareAssets } from "@/lib/capcut-compiler/assets";
import {
  createUrlAllowlist,
  VERCEL_BLOB_PRESET,
  UrlAllowlistError,
} from "@/lib/url-allowlist";
import {
  mockDnsNxDomain,
  mockDnsRebinding,
  mockDnsResolve,
  resetDnsMocks,
} from "@/tests/__stubs__/dns-mock";

/**
 * 测试 fixture URL 域 `example.test` —— P3 #2 phase 2 后 prepareAssets 入口 SSRF
 * check 需要 allowlist 实例。这里用宽松 preset 让既有 fixture 通过；新增 SSRF
 * deny 路径在 tests/url-allowlist/*.test.ts 已覆盖。
 *
 * Phase 3.5 (W3 verdict 5357c41 §D2): use shared dns-mock helper to drive
 * checkAsync DNS resolution paths (covers happy / rebinding / nxdomain).
 */
const PERMISSIVE_TEST_ALLOWLIST = createUrlAllowlist({
  allowedSchemes: ["https:"],
  allowedHosts: [{ suffix: ".example.test" }],
  blockPrivateIps: false,
});

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

describe("prepareAssets (Task 7 multi-video, phase 3.5 async)", () => {
  let fetchMock: FetchMock;
  const trackedWorkDirs: string[] = [];

  beforeEach(() => {
    resetDnsMocks(dns);
    mockPoolInstances.length = 0;
    mockPoolCtor.mockReset();
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
    // PERMISSIVE_TEST_ALLOWLIST has blockPrivateIps=false → checkAsync 跳过 DNS。
    // fetchWithAllowlist 走 plain fetch (no Pool) 分支。
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
    const errSpy = vi.spyOn(console, "log").mockImplementation(() => {});
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
      // P5.8: logger emits JSON, structure {"index":1,"status":404,...} replaces "video #1...404"
      expect(
        calls.some((m) => m.includes('"index":1') && m.includes('"status":404')),
      ).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("lists all failed indexes in throw message when multiple videos fail", async () => {
    const errSpy = vi.spyOn(console, "log").mockImplementation(() => {});
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
      // P5.8: logger emits JSON with message "video download failed"
      expect(
        errMsgs.filter((m) => m.includes("video download failed")),
      ).toHaveLength(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("treats fetch network rejection as failure with index", async () => {
    const errSpy = vi.spyOn(console, "log").mockImplementation(() => {});
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
      // P5.8: logger emits JSON {"index":0, ...} with stringified message containing "ECONNRESET"
      expect(
        errMsgs.some((m) => m.includes('"index":0') && m.includes("ECONNRESET")),
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
    const errSpy = vi.spyOn(console, "log").mockImplementation(() => {});
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

/**
 * P3 #2 phase 2：`prepareAssets` 入口 SSRF allowlist check 覆盖（sync deny paths
 * unchanged from phase 3.5 because checkAsync short-circuits on sync deny without
 * triggering DNS）。
 */
describe("prepareAssets · P3 #2 phase 2 SSRF allowlist gate (sync deny short-circuit)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const VERCEL_BLOB_ALLOWLIST = createUrlAllowlist(VERCEL_BLOB_PRESET);

  beforeEach(() => {
    resetDnsMocks(dns);
    mockPoolCtor.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws UrlAllowlistError with reason=invalid_url when videoUrl unparseable", async () => {
    await expect(
      prepareAssets(["not-a-url"], undefined, {
        urlAllowlist: VERCEL_BLOB_ALLOWLIST,
      }),
    ).rejects.toMatchObject({
      name: "UrlAllowlistError",
      reason: "invalid_url",
      url: "not-a-url",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPoolCtor).not.toHaveBeenCalled();
  });

  it("throws UrlAllowlistError with reason=scheme_denied when videoUrl uses http://", async () => {
    await expect(
      prepareAssets(["http://x.public.blob.vercel-storage.com/a.mp4"], undefined, {
        urlAllowlist: VERCEL_BLOB_ALLOWLIST,
      }),
    ).rejects.toMatchObject({
      name: "UrlAllowlistError",
      reason: "scheme_denied",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws UrlAllowlistError with reason=private_ip when videoUrl host is 127.0.0.1", async () => {
    await expect(
      prepareAssets(["https://127.0.0.1/a.mp4"], undefined, {
        urlAllowlist: VERCEL_BLOB_ALLOWLIST,
      }),
    ).rejects.toMatchObject({
      name: "UrlAllowlistError",
      reason: "private_ip",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws UrlAllowlistError with reason=host_denied when videoUrl host not in preset", async () => {
    await expect(
      prepareAssets(["https://evil.com/a.mp4"], undefined, {
        urlAllowlist: VERCEL_BLOB_ALLOWLIST,
      }),
    ).rejects.toMatchObject({
      name: "UrlAllowlistError",
      reason: "host_denied",
      url: "https://evil.com/a.mp4",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fail-fast (all-or-nothing): 1st denied URL aborts batch", async () => {
    await expect(
      prepareAssets(
        [
          "https://evil-1.com/a.mp4",
          "https://x.public.blob.vercel-storage.com/b.mp4",
        ],
        undefined,
        { urlAllowlist: VERCEL_BLOB_ALLOWLIST },
      ),
    ).rejects.toBeInstanceOf(UrlAllowlistError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on denied bgmUrl even if all videoUrls pass", async () => {
    await expect(
      prepareAssets(
        ["https://x.public.blob.vercel-storage.com/v.mp4"],
        "https://evil.com/bgm.mp3",
        { urlAllowlist: VERCEL_BLOB_ALLOWLIST },
      ),
    ).rejects.toMatchObject({
      name: "UrlAllowlistError",
      reason: "host_denied",
      url: "https://evil.com/bgm.mp3",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * P3 #2 phase 3.5: 新增 async deny paths (DNS rebinding / DNS failure / public
 * resolve happy path)。验证 checkAsync + fetchWithAllowlist 完整链路。
 */
describe("prepareAssets · P3 #2 phase 3.5 DNS rebinding / DNS failure", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const VERCEL_BLOB_ALLOWLIST = createUrlAllowlist(VERCEL_BLOB_PRESET);
  const trackedWorkDirs: string[] = [];

  beforeEach(() => {
    resetDnsMocks(dns);
    mockPoolInstances.length = 0;
    mockPoolCtor.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const dir of trackedWorkDirs.splice(0)) {
      await cleanupAssets(dir);
    }
  });

  it("throws UrlAllowlistError reason=resolved_private_ip when DNS resolves to 127.0.0.1", async () => {
    mockDnsResolve(
      dns,
      "x.public.blob.vercel-storage.com",
      ["127.0.0.1"],
    );
    await expect(
      prepareAssets(
        ["https://x.public.blob.vercel-storage.com/a.mp4"],
        undefined,
        { urlAllowlist: VERCEL_BLOB_ALLOWLIST },
      ),
    ).rejects.toMatchObject({
      name: "UrlAllowlistError",
      reason: "resolved_private_ip",
      resolvedIp: "127.0.0.1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPoolCtor).not.toHaveBeenCalled();
  });

  it("throws UrlAllowlistError reason=dns_resolve_failed when DNS rejects", async () => {
    mockDnsNxDomain(dns);
    await expect(
      prepareAssets(
        ["https://x.public.blob.vercel-storage.com/a.mp4"],
        undefined,
        { urlAllowlist: VERCEL_BLOB_ALLOWLIST },
      ),
    ).rejects.toMatchObject({
      name: "UrlAllowlistError",
      reason: "dns_resolve_failed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPoolCtor).not.toHaveBeenCalled();
  });

  it("DNS rebinding: second call's resolved IP catches private rebind", async () => {
    // First call (pre-stream checkAsync) sees public; second call (in
    // fetchWithAllowlist's internal checkAsync) sees private → reject before
    // Pool construction.
    mockDnsRebinding(
      dns,
      "x.public.blob.vercel-storage.com",
      ["1.1.1.1"],
      ["127.0.0.1"],
    );

    await expect(
      prepareAssets(
        ["https://x.public.blob.vercel-storage.com/a.mp4"],
        undefined,
        { urlAllowlist: VERCEL_BLOB_ALLOWLIST },
      ),
    ).rejects.toMatchObject({
      name: "UrlAllowlistError",
      reason: "resolved_private_ip",
      resolvedIp: "127.0.0.1",
    });
    // Pool never constructed (rebound detected before any TCP)
    expect(mockPoolCtor).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("all-or-nothing: any URL resolving to private IP aborts entire batch", async () => {
    // Two URLs; second resolves to AWS metadata. Use mock impl via the
    // already-mocked vi.fn refs (not reassignment, which breaks vi.mock binding).
    const resolve4Mock = dns.resolve4 as unknown as ReturnType<typeof vi.fn>;
    const resolve6Mock = dns.resolve6 as unknown as ReturnType<typeof vi.fn>;
    resolve4Mock.mockImplementation((host: string) => {
      if (host === "ok.public.blob.vercel-storage.com") {
        return Promise.resolve(["1.1.1.1"]);
      }
      if (host === "evil.public.blob.vercel-storage.com") {
        return Promise.resolve(["169.254.169.254"]);
      }
      return Promise.resolve([]);
    });
    resolve6Mock.mockResolvedValue([]);

    await expect(
      prepareAssets(
        [
          "https://ok.public.blob.vercel-storage.com/a.mp4",
          "https://evil.public.blob.vercel-storage.com/b.mp4",
        ],
        undefined,
        { urlAllowlist: VERCEL_BLOB_ALLOWLIST },
      ),
    ).rejects.toMatchObject({
      reason: "resolved_private_ip",
      resolvedIp: "169.254.169.254",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("happy path: DNS resolves to public IP, fetchWithAllowlist routes through Pool", async () => {
    mockDnsResolve(
      dns,
      "x.public.blob.vercel-storage.com",
      ["1.2.3.4"],
    );
    fetchMock.mockResolvedValueOnce(makeOkResponse(TEXT_BYTES("ok")));

    const ws = await prepareAssets(
      ["https://x.public.blob.vercel-storage.com/a.mp4"],
      undefined,
      { urlAllowlist: VERCEL_BLOB_ALLOWLIST },
    );
    trackedWorkDirs.push(ws.workDir);

    // Pool ctor called for the actual fetch (after batch checkAsync passed)
    expect(mockPoolCtor).toHaveBeenCalledTimes(1);
    expect(mockPoolCtor.mock.calls[0]?.[0]).toBe("https://1.2.3.4:443");
    expect(mockPoolCtor.mock.calls[0]?.[1]).toMatchObject({
      connect: { servername: "x.public.blob.vercel-storage.com" },
    });
    // Pool closed in finally
    expect(mockPoolInstances[0]?.close).toHaveBeenCalledTimes(1);
  });
});
