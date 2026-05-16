import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5.1.b-1 commit 2: contract baseline ported from a-2.
 *
 * - head / put / list now mock `@google-cloud/storage` (W3 verdict c9367c4 F1).
 * - del / getDownloadUrl still go through `@vercel/blob` until commit 3
 *   — both mocks coexist in this file during the transient state.
 *
 * Per W3 verdict c9367c4 nit F (MANDATE):
 *   GCS SDK has two well-known tuple-unwrap quirks that must be made
 *   explicit in test fixtures so future test edits don't silently
 *   regress to a "simplified" mockResolvedValue shape:
 *
 *   1. `file.getMetadata()` resolves to a **2-element tuple**
 *      `[FileMetadata, ApiResponse]` (per `MetadataResponse<K> = [K, r.Response]`
 *      in `service-object.d.ts`). The facade unwraps to plain `BlobInfo` by
 *      destructuring only the first element.
 *   2. `bucket.getFiles()` with `autoPaginate:false` resolves to a
 *      **3-element tuple** `[File[], nextQuery, ApiResponse]`. The middle
 *      element is an empty object `{}` (NOT `null`) on the final page —
 *      the canonical "more pages" signal is the presence of `pageToken`
 *      on nextQuery, not truthiness of nextQuery itself.
 *
 *   Mock fixtures below preserve these exact shapes (with comments at each
 *   site) so a `mockResolvedValue(plainMeta)` regression breaks loudly.
 */

const gcs = vi.hoisted(() => {
  const fileGetMetadata = vi.fn();
  const fileSave = vi.fn();
  const bucketGetFiles = vi.fn();
  const StorageCtor = vi.fn();
  return { fileGetMetadata, fileSave, bucketGetFiles, StorageCtor };
});

vi.mock("@google-cloud/storage", () => {
  class Storage {
    constructor() {
      gcs.StorageCtor();
    }
    bucket(_name: string) {
      return {
        file: (_key: string) => ({
          getMetadata: gcs.fileGetMetadata,
          save: gcs.fileSave,
        }),
        getFiles: gcs.bucketGetFiles,
      };
    }
  }
  return { Storage };
});

// Legacy @vercel/blob mock — only del + getDownloadUrl still route through
// vercel until commit 3. head / put / list mocks (putMock / headMock /
// listMock) have been REMOVED to make the swap explicit; touching them in
// tests below would fail to compile.
const delMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  del: (...a: unknown[]) => delMock(...a),
}));

import {
  __resetStorageForTests,
  del,
  getDownloadUrl,
  head,
  list,
  put,
  StorageError,
} from "@/lib/storage";

beforeEach(() => {
  gcs.fileGetMetadata.mockReset();
  gcs.fileSave.mockReset();
  gcs.bucketGetFiles.mockReset();
  gcs.StorageCtor.mockReset();
  delMock.mockReset();
  __resetStorageForTests();
  process.env.GCS_BUCKET_NAME = "viral-reviewer-blob-test";
});

afterEach(() => {
  __resetStorageForTests();
  delete process.env.GCS_BUCKET_NAME;
});

describe("storage.head", () => {
  it("returns BlobInfo shape on success — note SDK [meta, ApiResponse] 2-tuple unwrap", async () => {
    // GCS SDK quirk: getMetadata resolves to [FileMetadata, ApiResponse].
    // The facade destructures only [0] to get BlobInfo. The empty {} for
    // [1] is the ApiResponse the facade ignores.
    gcs.fileGetMetadata.mockResolvedValue([
      {
        contentType: "application/json",
        size: "1234", // GCS returns size as string — facade normalizes to number
        updated: "2026-05-15T00:00:00.000Z",
      },
      {} /* ApiResponse — facade ignores */,
    ]);
    const result = await head("trending/snapshot-2026-W20.json");
    expect(result).toEqual({
      url: "https://storage.googleapis.com/viral-reviewer-blob-test/trending/snapshot-2026-W20.json",
      pathname: "trending/snapshot-2026-W20.json",
      contentType: "application/json",
      size: 1234,
      uploadedAt: new Date("2026-05-15T00:00:00.000Z"),
    });
  });

  it("returns null when GCS throws code:404 (canonical ApiError)", async () => {
    gcs.fileGetMetadata.mockRejectedValue(
      Object.assign(new Error("Not Found"), { code: 404 }),
    );
    expect(await head("missing")).toBeNull();
  });

  it("returns null when error message contains 'No such object' (GCS canonical 404)", async () => {
    gcs.fileGetMetadata.mockRejectedValue(
      new Error("No such object: viral-reviewer-blob-test/missing"),
    );
    expect(await head("missing")).toBeNull();
  });

  it("throws StorageError('head_failed') on non-404 failure", async () => {
    gcs.fileGetMetadata.mockRejectedValue(new Error("network"));
    await expect(head("k")).rejects.toMatchObject({
      name: "StorageError",
      code: "head_failed",
    });
  });

  it("throws StorageError('storage_not_configured') when GCS_BUCKET_NAME missing", async () => {
    delete process.env.GCS_BUCKET_NAME;
    __resetStorageForTests();
    await expect(head("k")).rejects.toMatchObject({
      name: "StorageError",
      code: "storage_not_configured",
    });
  });
});

describe("storage.put", () => {
  it("calls save with mapped options and returns PutResult", async () => {
    gcs.fileSave.mockResolvedValue(undefined);
    const result = await put("trending/snapshot-2026-W20.json", '{"k":1}', {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 3600,
    });
    expect(result.url).toBe(
      "https://storage.googleapis.com/viral-reviewer-blob-test/trending/snapshot-2026-W20.json",
    );
    expect(result.downloadUrl).toBe(`${result.url}?download=1`);
    expect(result.pathname).toBe("trending/snapshot-2026-W20.json");
    expect(result.contentType).toBe("application/json");
    expect(gcs.fileSave).toHaveBeenCalledWith(
      '{"k":1}',
      expect.objectContaining({
        contentType: "application/json",
        resumable: false,
        metadata: { cacheControl: "public, max-age=3600" },
      }),
    );
    // UBLA defense: `public: true` save option must NOT be set — it triggers
    // a legacy ACL call that returns 403 on UBLA buckets (W3 verdict 12b3b18 D).
    expect(gcs.fileSave.mock.calls[0][1]).not.toHaveProperty("public");
  });

  it("appends 8 hex-char random suffix when addRandomSuffix:true (W3 verdict 12b3b18 I)", async () => {
    gcs.fileSave.mockResolvedValue(undefined);
    const result = await put("capcut-exports/project.zip", Buffer.from("z"), {
      access: "public",
      contentType: "application/zip",
      addRandomSuffix: true,
    });
    // 8 hex chars from crypto.randomUUID().slice(0, 8): [0-9a-f]{8}
    expect(result.pathname).toMatch(
      /^capcut-exports\/project\.zip-[0-9a-f]{8}$/,
    );
  });

  it("throws StorageError('put_failed') on underlying failure", async () => {
    gcs.fileSave.mockRejectedValue(new Error("upload failed"));
    await expect(put("k", "body", { access: "public" })).rejects.toMatchObject({
      name: "StorageError",
      code: "put_failed",
    });
  });
});

describe("storage.list", () => {
  it("returns ListResult — note SDK 3-tuple [files, nextQuery, apiResponse] unwrap", async () => {
    // GCS SDK quirk: getFiles resolves to a 3-element tuple.
    // - [0] File[]: each `f.name` + `f.metadata.size/updated`
    // - [1] nextQuery: { pageToken } when more pages, `{}` when exhausted
    //   (NOT null — see "returns hasMore:false" case below)
    // - [2] ApiResponse (unused by facade)
    gcs.bucketGetFiles.mockResolvedValue([
      [
        {
          name: "trending/snapshot-2026-W20.json",
          metadata: { size: "100", updated: "2026-05-15T00:00:00.000Z" },
        },
        {
          name: "trending/snapshot-2026-W19.json",
          metadata: { size: "200", updated: "2026-05-15T00:00:00.000Z" },
        },
      ],
      { pageToken: "next-page-cursor" },
      { /* apiResponse — facade ignores */ },
    ]);
    const result = await list({ prefix: "trending/", limit: 10 });
    expect(result.blobs).toHaveLength(2);
    expect(result.blobs[0]).toMatchObject({
      url: "https://storage.googleapis.com/viral-reviewer-blob-test/trending/snapshot-2026-W20.json",
      pathname: "trending/snapshot-2026-W20.json",
      size: 100,
    });
    expect(result.cursor).toBe("next-page-cursor");
    expect(result.hasMore).toBe(true);
    expect(gcs.bucketGetFiles).toHaveBeenCalledWith({
      prefix: "trending/",
      maxResults: 10,
      pageToken: undefined,
      autoPaginate: false,
    });
  });

  it("returns hasMore:false when nextQuery has no pageToken (final page — SDK uses {} not null)", async () => {
    // SDK behavior: on the last page, nextQuery is `{}` (empty object),
    // NOT null. The facade derives hasMore from `pageToken` presence to
    // avoid the truthiness pitfall. This case guards the regression.
    gcs.bucketGetFiles.mockResolvedValue([[], {}, {}]);
    const result = await list({ prefix: "trending/" });
    expect(result.blobs).toEqual([]);
    expect(result.cursor).toBeUndefined();
    expect(result.hasMore).toBe(false);
  });

  it("throws StorageError('list_failed') on underlying failure", async () => {
    gcs.bucketGetFiles.mockRejectedValue(new Error("network"));
    await expect(list({ prefix: "trending/" })).rejects.toMatchObject({
      name: "StorageError",
      code: "list_failed",
    });
  });
});

// del / getDownloadUrl: contract preserved from a-2; commit 3 will port these
// to GCS along with the new `url_not_in_bucket` D3 code. Tests below still
// exercise the @vercel/blob passthrough path.

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
