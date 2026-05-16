import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the @/lib/storage facade (not the underlying @vercel/blob /
// @google-cloud/storage SDK) — caller tests should depend only on the
// platform-neutral facade contract. This way P5.1.b internal swaps don't
// leak through to caller test fixtures (anti-pattern #3 defense).
const putMock = vi.fn();
const headMock = vi.fn();
const listMock = vi.fn();
const delMock = vi.fn();
vi.mock("@/lib/storage", () => ({
  put: (...a: unknown[]) => putMock(...a),
  head: (...a: unknown[]) => headMock(...a),
  list: (...a: unknown[]) => listMock(...a),
  del: (...a: unknown[]) => delMock(...a),
}));

// readSnapshot / readLatestTwoSnapshots 用全局 fetch 拉 blob 内容 —— stub 掉
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  writeSnapshot,
  pruneOldSnapshots,
  snapshotKey,
  readSnapshot,
  readLatestTwoSnapshots,
} from "@/lib/trending/snapshot-store";
import { TRENDING_SCHEMA_VERSION, type TrendingSnapshot } from "@/lib/trending/types";

const SNAP: TrendingSnapshot = {
  schemaVersion: TRENDING_SCHEMA_VERSION,
  week: "2026-W20",
  capturedAt: "2026-05-13T08:00:00Z",
  videos: [],
  trendingHashtags: [],
  meta: {
    tiktok: { source: "trends-actor", actorRun: "r1", rawCount: 0, enrichedCount: 0, ok: true },
    instagram: { source: "hashtag-proxy", actorRun: "r2", rawCount: 0, enrichedCount: 0, ok: true },
    partial: false,
  },
};

beforeEach(() => {
  putMock.mockReset();
  headMock.mockReset();
  listMock.mockReset();
  delMock.mockReset();
  fetchMock.mockReset();
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

describe("snapshotKey", () => {
  it("builds key under the trending/ namespace", () => {
    expect(snapshotKey("2026-W20")).toBe("trending/snapshot-2026-W20.json");
  });
});

describe("writeSnapshot", () => {
  it("writes JSON to the week key with allowOverwrite", async () => {
    putMock.mockResolvedValue({ url: "https://blob/x" });
    await writeSnapshot(SNAP);
    expect(putMock).toHaveBeenCalledTimes(1);
    const [key, body, opts] = putMock.mock.calls[0];
    expect(key).toBe("trending/snapshot-2026-W20.json");
    expect(JSON.parse(body as string).week).toBe("2026-W20");
    expect(opts).toMatchObject({ allowOverwrite: true, addRandomSuffix: false });
  });

  it("retries once when the first put throws", async () => {
    putMock.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ url: "ok" });
    await writeSnapshot(SNAP);
    expect(putMock).toHaveBeenCalledTimes(2);
  });

  it("no-ops when BLOB_READ_WRITE_TOKEN is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await writeSnapshot(SNAP);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("logs a warn on first failure then an error when both put attempts fail", async () => {
    // P5.8: both severities emit via console.log JSON; distinguish via "severity" field
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    putMock.mockRejectedValue(new Error("persistent failure"));
    await writeSnapshot(SNAP);
    expect(putMock).toHaveBeenCalledTimes(2);
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    const warnings = lines.filter((m) => m.includes('"severity":"WARNING"'));
    const errors = lines.filter((m) => m.includes('"severity":"ERROR"'));
    expect(warnings).toHaveLength(1);
    expect(errors).toHaveLength(1);
    logSpy.mockRestore();
  });
});

describe("pruneOldSnapshots", () => {
  it("keeps the newest N weeks and deletes the rest", async () => {
    listMock.mockResolvedValue({
      blobs: [
        { pathname: "trending/snapshot-2026-W20.json", url: "u20" },
        { pathname: "trending/snapshot-2026-W19.json", url: "u19" },
        { pathname: "trending/snapshot-2026-W18.json", url: "u18" },
        { pathname: "trending/snapshot-2026-W17.json", url: "u17" },
      ],
    });
    await pruneOldSnapshots(2);
    // 保留 W20 + W19,删 W18 + W17
    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock).toHaveBeenCalledWith(["u18", "u17"]);
  });

  it("deletes nothing when snapshot count is within the keep window", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "trending/snapshot-2026-W20.json", url: "u20" }],
    });
    await pruneOldSnapshots(8);
    expect(delMock).not.toHaveBeenCalled();
  });
});

describe("readSnapshot", () => {
  it("returns the parsed snapshot for an existing week", async () => {
    headMock.mockResolvedValue({ url: "https://blob/w20" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => SNAP });
    const result = await readSnapshot("2026-W20");
    expect(result?.week).toBe("2026-W20");
    expect(headMock).toHaveBeenCalledWith("trending/snapshot-2026-W20.json");
  });

  it("returns null when head finds nothing", async () => {
    headMock.mockResolvedValue(null);
    const result = await readSnapshot("2026-W20");
    expect(result).toBeNull();
  });

  it("returns null when the blob fetch is not ok", async () => {
    headMock.mockResolvedValue({ url: "https://blob/w20" });
    fetchMock.mockResolvedValue({ ok: false });
    const result = await readSnapshot("2026-W20");
    expect(result).toBeNull();
  });

  it("returns null when BLOB_READ_WRITE_TOKEN is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const result = await readSnapshot("2026-W20");
    expect(result).toBeNull();
    expect(headMock).not.toHaveBeenCalled();
  });

  it("returns null when the blob JSON fails schema validation", async () => {
    headMock.mockResolvedValue({ url: "https://blob/w20" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ garbage: true }) });
    const result = await readSnapshot("2026-W20");
    expect(result).toBeNull();
  });
});

describe("readLatestTwoSnapshots", () => {
  it("sorts blobs by pathname desc and returns the newest two", async () => {
    listMock.mockResolvedValue({
      blobs: [
        { pathname: "trending/snapshot-2026-W18.json", url: "u18" },
        { pathname: "trending/snapshot-2026-W20.json", url: "u20" },
        { pathname: "trending/snapshot-2026-W19.json", url: "u19" },
      ],
    });
    // 每个 blob 的 json() 回显它的 url,便于断言取到的是哪两个
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({ ok: true, json: async () => ({ ...SNAP, week: url }) }),
    );
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current?.week).toBe("u20"); // 最新
    expect(previous?.week).toBe("u19"); // 次新
  });

  it("returns previous=null when only one snapshot exists", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "trending/snapshot-2026-W20.json", url: "u20" }],
    });
    fetchMock.mockResolvedValue({ ok: true, json: async () => SNAP });
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current).not.toBeNull();
    expect(previous).toBeNull();
  });

  it("returns both null when no snapshots exist", async () => {
    listMock.mockResolvedValue({ blobs: [] });
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current).toBeNull();
    expect(previous).toBeNull();
  });

  it("returns both null when BLOB_READ_WRITE_TOKEN is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current).toBeNull();
    expect(previous).toBeNull();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("returns both null when a blob fetch throws", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "trending/snapshot-2026-W20.json", url: "u20" }],
    });
    fetchMock.mockRejectedValue(new Error("network down"));
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current).toBeNull();
    expect(previous).toBeNull();
  });

  it("returns null for a blob whose JSON fails schema validation", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "trending/snapshot-2026-W20.json", url: "u20" }],
    });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ not: "a snapshot" }) });
    const { current, previous } = await readLatestTwoSnapshots();
    expect(current).toBeNull();
    expect(previous).toBeNull();
  });
});
