import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @vercel/blob — hoisted to top of module per vitest semantics.
const putMock = vi.fn();
const headMock = vi.fn();
const listMock = vi.fn();
const delMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...a: unknown[]) => putMock(...a),
  head: (...a: unknown[]) => headMock(...a),
  list: (...a: unknown[]) => listMock(...a),
  del: (...a: unknown[]) => delMock(...a),
}));

import { del, getDownloadUrl, head, list, put, StorageError } from "@/lib/storage";

beforeEach(() => {
  putMock.mockReset();
  headMock.mockReset();
  listMock.mockReset();
  delMock.mockReset();
});

/**
 * Per W3 P5.1 verdict 12b3b18:
 * - B1: head returns null on missing; all other ops throw StorageError.
 * - Contract baseline freeze: these tests guard the caller-facing API so the
 *   P5.1.b internal swap to @google-cloud/storage keeps these assertions
 *   green with zero change.
 */
describe("storage.head", () => {
  it("returns BlobInfo shape on success", async () => {
    const uploadedAt = new Date("2026-05-15T00:00:00Z");
    headMock.mockResolvedValue({
      url: "https://blob/x",
      pathname: "trending/snapshot-2026-W20.json",
      contentType: "application/json",
      size: 1234,
      uploadedAt,
    });
    const result = await head("trending/snapshot-2026-W20.json");
    expect(result).toEqual({
      url: "https://blob/x",
      pathname: "trending/snapshot-2026-W20.json",
      contentType: "application/json",
      size: 1234,
      uploadedAt,
    });
    expect(headMock).toHaveBeenCalledWith("trending/snapshot-2026-W20.json");
  });

  it("returns null when underlying head throws status:404", async () => {
    headMock.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    expect(await head("missing")).toBeNull();
  });

  it("returns null on BlobNotFoundError name", async () => {
    const err = Object.assign(new Error("The requested blob does not exist"), {
      name: "BlobNotFoundError",
    });
    headMock.mockRejectedValue(err);
    expect(await head("missing")).toBeNull();
  });

  it("throws StorageError('head_failed') on non-404 failure", async () => {
    headMock.mockRejectedValue(new Error("network"));
    await expect(head("k")).rejects.toMatchObject({
      name: "StorageError",
      code: "head_failed",
    });
  });
});

describe("storage.put", () => {
  it("returns PutResult shape and passes options through", async () => {
    putMock.mockResolvedValue({
      url: "https://blob/x",
      downloadUrl: "https://blob/x?download=1",
      pathname: "trending/snapshot-2026-W20.json",
      contentType: "application/json",
      contentDisposition: 'attachment; filename="x.json"',
    });
    const result = await put("trending/snapshot-2026-W20.json", '{"k":1}', {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 3600,
    });
    expect(result).toEqual({
      url: "https://blob/x",
      downloadUrl: "https://blob/x?download=1",
      pathname: "trending/snapshot-2026-W20.json",
      contentType: "application/json",
      contentDisposition: 'attachment; filename="x.json"',
    });
    expect(putMock).toHaveBeenCalledWith("trending/snapshot-2026-W20.json", '{"k":1}', {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 3600,
    });
  });

  it("throws StorageError('put_failed') on underlying failure", async () => {
    putMock.mockRejectedValue(new Error("upload failed"));
    await expect(put("k", "body", { access: "public" })).rejects.toMatchObject({
      name: "StorageError",
      code: "put_failed",
    });
  });
});

describe("storage.list", () => {
  it("returns ListResult shape with paginated blobs", async () => {
    const uploadedAt = new Date("2026-05-15T00:00:00Z");
    listMock.mockResolvedValue({
      blobs: [
        {
          url: "https://blob/a",
          pathname: "trending/snapshot-2026-W20.json",
          size: 100,
          uploadedAt,
        },
        {
          url: "https://blob/b",
          pathname: "trending/snapshot-2026-W19.json",
          size: 200,
          uploadedAt,
        },
      ],
      cursor: "next-page-cursor",
      hasMore: true,
    });
    const result = await list({ prefix: "trending/", limit: 10 });
    expect(result.blobs).toHaveLength(2);
    expect(result.blobs[0]).toMatchObject({
      url: "https://blob/a",
      pathname: "trending/snapshot-2026-W20.json",
      size: 100,
    });
    expect(result.cursor).toBe("next-page-cursor");
    expect(result.hasMore).toBe(true);
    expect(listMock).toHaveBeenCalledWith({
      prefix: "trending/",
      limit: 10,
      cursor: undefined,
    });
  });

  it("throws StorageError('list_failed') on underlying failure", async () => {
    listMock.mockRejectedValue(new Error("network"));
    await expect(list({ prefix: "trending/" })).rejects.toMatchObject({
      name: "StorageError",
      code: "list_failed",
    });
  });
});

describe("storage.del", () => {
  it("accepts a single URL string", async () => {
    delMock.mockResolvedValue(undefined);
    await del("https://blob/x");
    expect(delMock).toHaveBeenCalledWith("https://blob/x");
  });

  it("accepts an array of URLs", async () => {
    delMock.mockResolvedValue(undefined);
    await del(["https://blob/a", "https://blob/b"]);
    expect(delMock).toHaveBeenCalledWith(["https://blob/a", "https://blob/b"]);
  });

  it("throws StorageError('del_failed') on underlying failure", async () => {
    delMock.mockRejectedValue(new Error("forbidden"));
    await expect(del("https://blob/x")).rejects.toMatchObject({
      name: "StorageError",
      code: "del_failed",
    });
  });
});

describe("storage.getDownloadUrl", () => {
  it("appends ?download=1 to a full https URL", async () => {
    const url = await getDownloadUrl("https://blob/x/file.json");
    expect(url).toBe("https://blob/x/file.json?download=1");
  });

  it("preserves existing query parameters", async () => {
    const url = await getDownloadUrl("https://blob/x?v=2");
    expect(url).toContain("v=2");
    expect(url).toContain("download=1");
  });

  it("throws StorageError('download_url_requires_full_url') on a bare key", async () => {
    await expect(getDownloadUrl("trending/snapshot.json")).rejects.toMatchObject({
      name: "StorageError",
      code: "download_url_requires_full_url",
    });
  });
});

describe("StorageError", () => {
  it("preserves code, message, and cause", () => {
    const cause = new Error("underlying");
    const err = new StorageError("custom_code", "wrapper message", cause);
    expect(err.name).toBe("StorageError");
    expect(err.code).toBe("custom_code");
    expect(err.message).toBe("wrapper message");
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
  });
});
