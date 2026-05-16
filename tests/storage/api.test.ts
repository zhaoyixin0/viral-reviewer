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
  const fileDelete = vi.fn();
  const fileGetSignedUrl = vi.fn();
  // P5.1.b-2 commit 1: GCS v4 signed POST policy generation.
  // SDK quirk (ECC MED-3 mandate 78b7d2f): resolves to a 1-element tuple
  // `[PolicyResponse]`. Mocks must preserve that shape — never simplify
  // to `mockResolvedValue({url, fields})` (would silently regress runtime).
  const fileGenerateSignedPostPolicyV4 = vi.fn();
  const bucketGetFiles = vi.fn();
  const StorageCtor = vi.fn();
  // Track which key each File proxy was created for so per-op assertions
  // can verify bucket.file(<key>) routing without coupling to ordering.
  const fileKeyAccess = vi.fn<(key: string) => void>();
  return {
    fileGetMetadata,
    fileSave,
    fileDelete,
    fileGetSignedUrl,
    fileGenerateSignedPostPolicyV4,
    bucketGetFiles,
    StorageCtor,
    fileKeyAccess,
  };
});

vi.mock("@google-cloud/storage", () => {
  class Storage {
    constructor() {
      gcs.StorageCtor();
    }
    bucket(_name: string) {
      return {
        file: (key: string) => {
          gcs.fileKeyAccess(key);
          return {
            getMetadata: gcs.fileGetMetadata,
            save: gcs.fileSave,
            delete: gcs.fileDelete,
            getSignedUrl: gcs.fileGetSignedUrl,
            generateSignedPostPolicyV4: gcs.fileGenerateSignedPostPolicyV4,
          };
        },
        getFiles: gcs.bucketGetFiles,
      };
    }
  }
  return { Storage };
});

import {
  __resetStorageForTests,
  del,
  generateSignedPostPolicy,
  getDownloadUrl,
  head,
  list,
  type PutResult,
  put,
  signCompletionToken,
  StorageError,
  verifyCompletionToken,
} from "@/lib/storage";

// Compile-time invariant (commit 3a per W3 verdict efc1715 BLOCKER):
// PutResult must NEVER carry a `downloadUrl` field again. The Vercel-Blob
// `?download=1` convention does not work on GCS; callers must explicitly
// call getDownloadUrl(). A future re-addition of `downloadUrl?: string` to
// PutResult would make `_NoDownloadUrlOnPutResult` resolve to `never`,
// turning the const assignment below into a TS error.
type _NoDownloadUrlOnPutResult = "downloadUrl" extends keyof PutResult ? never : true;
const _PROOF_NO_DOWNLOAD_URL: _NoDownloadUrlOnPutResult = true;
void _PROOF_NO_DOWNLOAD_URL;

beforeEach(() => {
  gcs.fileGetMetadata.mockReset();
  gcs.fileSave.mockReset();
  gcs.fileDelete.mockReset();
  gcs.fileGetSignedUrl.mockReset();
  gcs.fileGenerateSignedPostPolicyV4.mockReset();
  gcs.bucketGetFiles.mockReset();
  gcs.StorageCtor.mockReset();
  gcs.fileKeyAccess.mockReset();
  __resetStorageForTests();
  process.env.GCS_BUCKET_NAME = "viral-reviewer-blob-test";
  // P5.1.b-2 commit 1: sign/verifyCompletionToken require this secret.
  // Hex 32-byte test value (matches the `openssl rand -hex 32` runbook).
  process.env.UPLOAD_SIGNING_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

afterEach(() => {
  __resetStorageForTests();
  delete process.env.GCS_BUCKET_NAME;
  delete process.env.UPLOAD_SIGNING_SECRET;
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
    expect(result.pathname).toBe("trending/snapshot-2026-W20.json");
    expect(result.contentType).toBe("application/json");
    // downloadUrl field removed in commit 3a per W3 verdict efc1715 BLOCKER
    // — callers must now call getDownloadUrl() explicitly for a GCS v4 signed
    // URL with Content-Disposition: attachment (the Vercel `?download=1`
    // query convention does NOT work on GCS).
    expect(result).not.toHaveProperty("downloadUrl");
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

describe("storage.del", () => {
  it("accepts a single GCS public URL — reverse-maps to key and calls file.delete", async () => {
    gcs.fileDelete.mockResolvedValue(undefined);
    await del(
      "https://storage.googleapis.com/viral-reviewer-blob-test/trending/snapshot-2026-W20.json",
    );
    expect(gcs.fileKeyAccess).toHaveBeenCalledWith("trending/snapshot-2026-W20.json");
    expect(gcs.fileDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it("accepts an array of URLs and deletes in parallel", async () => {
    gcs.fileDelete.mockResolvedValue(undefined);
    await del([
      "https://storage.googleapis.com/viral-reviewer-blob-test/trending/a.json",
      "https://storage.googleapis.com/viral-reviewer-blob-test/trending/b.json",
    ]);
    expect(gcs.fileKeyAccess).toHaveBeenCalledTimes(2);
    expect(gcs.fileKeyAccess).toHaveBeenCalledWith("trending/a.json");
    expect(gcs.fileKeyAccess).toHaveBeenCalledWith("trending/b.json");
    expect(gcs.fileDelete).toHaveBeenCalledTimes(2);
    // Both delete calls must carry { ignoreNotFound: true } — array path
    // regression guard so a future loop refactor doesn't drop the option.
    expect(gcs.fileDelete.mock.calls[0][0]).toEqual({ ignoreNotFound: true });
    expect(gcs.fileDelete.mock.calls[1][0]).toEqual({ ignoreNotFound: true });
  });

  it("accepts a bare key (no scheme) without reverse-mapping", async () => {
    gcs.fileDelete.mockResolvedValue(undefined);
    await del("trending/snapshot-2026-W20.json");
    expect(gcs.fileKeyAccess).toHaveBeenCalledWith("trending/snapshot-2026-W20.json");
  });

  it("throws StorageError('url_not_in_bucket') on a cross-bucket URL (D3 defense)", async () => {
    await expect(
      del("https://storage.googleapis.com/some-other-bucket/x.json"),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "url_not_in_bucket",
    });
    expect(gcs.fileDelete).not.toHaveBeenCalled();
  });

  it("throws StorageError('del_failed') on underlying SDK failure", async () => {
    gcs.fileDelete.mockRejectedValue(new Error("forbidden"));
    await expect(del("trending/x.json")).rejects.toMatchObject({
      name: "StorageError",
      code: "del_failed",
    });
  });
});

describe("storage.getDownloadUrl", () => {
  it("accepts a bare key + returns the SDK signed URL", async () => {
    // SDK getSignedUrl resolves to [signedUrl] 1-tuple
    gcs.fileGetSignedUrl.mockResolvedValue([
      "https://storage.googleapis.com/viral-reviewer-blob-test/trending/x.json?X-Goog-Signature=abc",
    ]);
    const url = await getDownloadUrl("trending/x.json");
    expect(url).toContain("X-Goog-Signature=abc");
    expect(gcs.fileKeyAccess).toHaveBeenCalledWith("trending/x.json");
    expect(gcs.fileGetSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "v4",
        action: "read",
        responseDisposition: "attachment",
      }),
    );
  });

  it("reverse-maps a GCS URL to key and applies filename in Content-Disposition", async () => {
    gcs.fileGetSignedUrl.mockResolvedValue(["https://signed/url"]);
    await getDownloadUrl(
      "https://storage.googleapis.com/viral-reviewer-blob-test/capcut-exports/project.zip",
      { filename: "viral-reviewer-2026-W20.zip" },
    );
    expect(gcs.fileKeyAccess).toHaveBeenCalledWith("capcut-exports/project.zip");
    expect(gcs.fileGetSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        responseDisposition: 'attachment; filename="viral-reviewer-2026-W20.zip"',
      }),
    );
  });

  it("uses default 900s (15min) TTL when ttlSeconds not provided (W3 verdict 12b3b18 C)", async () => {
    gcs.fileGetSignedUrl.mockResolvedValue(["https://signed/url"]);
    const before = Date.now();
    await getDownloadUrl("trending/x.json");
    const after = Date.now();
    const { expires } = gcs.fileGetSignedUrl.mock.calls[0][0] as { expires: number };
    // 900s = 900_000ms; allow real-time jitter window for [before, after]
    expect(expires).toBeGreaterThanOrEqual(before + 900_000);
    expect(expires).toBeLessThanOrEqual(after + 900_000);
  });

  it("respects custom ttlSeconds override", async () => {
    gcs.fileGetSignedUrl.mockResolvedValue(["https://signed/url"]);
    const before = Date.now();
    await getDownloadUrl("trending/x.json", { ttlSeconds: 60 });
    const after = Date.now();
    const { expires } = gcs.fileGetSignedUrl.mock.calls[0][0] as { expires: number };
    expect(expires).toBeGreaterThanOrEqual(before + 60_000);
    expect(expires).toBeLessThanOrEqual(after + 60_000);
  });

  it("throws StorageError('url_not_in_bucket') on a cross-bucket URL (D3 defense)", async () => {
    await expect(
      getDownloadUrl("https://storage.googleapis.com/some-other-bucket/x.json"),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "url_not_in_bucket",
    });
    expect(gcs.fileGetSignedUrl).not.toHaveBeenCalled();
  });

  it("throws StorageError('download_url_failed') on SDK failure", async () => {
    gcs.fileGetSignedUrl.mockRejectedValue(new Error("auth"));
    await expect(getDownloadUrl("trending/x.json")).rejects.toMatchObject({
      name: "StorageError",
      code: "download_url_failed",
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

// ---------------------------------------------------------------------------
// P5.1.b-2 commit 1: generateSignedPostPolicy + completion token sign/verify
// (per W3 verdict 78b7d2f deep + ECC follow-up — 7 mandatory + 1 nit cases)
// ---------------------------------------------------------------------------

describe("storage.generateSignedPostPolicy", () => {
  it("returns {url, fields} via SDK [policy] 1-tuple unwrap (ECC MED-3 mandate)", async () => {
    // SDK quirk: generateSignedPostPolicyV4 resolves to a 1-element tuple
    // `[PolicyResponse]`. Mock preserves the tuple shape literally — a
    // mockResolvedValue({url, fields}) regression would type-error at the
    // facade's `[policy] = await ...` destructure (anti-pattern #3 defense).
    gcs.fileGenerateSignedPostPolicyV4.mockResolvedValue([
      {
        url: "https://storage.googleapis.com/viral-reviewer-blob-test/",
        fields: {
          key: "uploads/raw/video.mp4",
          "Content-Type": "video/mp4",
          policy: "<base64-policy>",
          "x-goog-algorithm": "GOOG4-RSA-SHA256",
          "x-goog-credential": "service-account/...",
          "x-goog-date": "20260516T093000Z",
          "x-goog-signature": "deadbeef",
        },
      },
      // INTENTIONAL: no second tuple element. If the SDK ever switches to a
      // 2-tuple (per b-1 H1 lessons), this case becomes the early signal.
    ]);
    const result = await generateSignedPostPolicy("uploads/raw/video.mp4", {
      contentType: "video/mp4",
      maxBytes: 200 * 1024 * 1024,
    });
    expect(result.url).toBe(
      "https://storage.googleapis.com/viral-reviewer-blob-test/",
    );
    expect(result.fields.key).toBe("uploads/raw/video.mp4");
    expect(result.fields["x-goog-signature"]).toBe("deadbeef");
  });

  it("wires conditions: content-length-range + Content-Type eq + key eq (W3 verdict 78b7d2f A1)", async () => {
    gcs.fileGenerateSignedPostPolicyV4.mockResolvedValue([
      { url: "https://gcs/", fields: {} },
    ]);
    await generateSignedPostPolicy("uploads/raw/file.pdf", {
      contentType: "application/pdf",
      maxBytes: 100 * 1024 * 1024,
    });
    const args = gcs.fileGenerateSignedPostPolicyV4.mock.calls[0][0] as {
      conditions: Array<unknown[]>;
    };
    expect(args.conditions).toEqual([
      ["content-length-range", 0, 100 * 1024 * 1024],
      ["eq", "$Content-Type", "application/pdf"],
      ["eq", "$key", "uploads/raw/file.pdf"],
    ]);
  });

  it("throws StorageError('signed_upload_failed') on SDK failure", async () => {
    gcs.fileGenerateSignedPostPolicyV4.mockRejectedValue(new Error("auth"));
    await expect(
      generateSignedPostPolicy("k", { contentType: "text/plain", maxBytes: 100 }),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "signed_upload_failed",
    });
  });

  it("throws StorageError('storage_not_configured') when GCS_BUCKET_NAME missing", async () => {
    delete process.env.GCS_BUCKET_NAME;
    __resetStorageForTests();
    await expect(
      generateSignedPostPolicy("k", { contentType: "text/plain", maxBytes: 100 }),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "storage_not_configured",
    });
  });
});

describe("storage.signCompletionToken / verifyCompletionToken", () => {
  it("sign + verify roundtrip preserves payload (incl forward-compat nonce)", () => {
    const token = signCompletionToken({
      finalKey: "uploads/raw/video.mp4-abc12345",
      contentType: "video/mp4",
      maxBytes: 200 * 1024 * 1024,
    });
    const decoded = verifyCompletionToken(token);
    expect(decoded.finalKey).toBe("uploads/raw/video.mp4-abc12345");
    expect(decoded.contentType).toBe("video/mp4");
    expect(decoded.maxBytes).toBe(200 * 1024 * 1024);
    expect(decoded.expiresAt).toBeGreaterThan(Date.now());
    // ECC MED-1/2 (78b7d2f) forward-compat: nonce is server-minted UUID,
    // exposed in return so future DB-write callers have an idempotency key
    // without a token-protocol upgrade. UUID v4 hex shape: 8-4-4-4-12.
    expect(decoded.nonce).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("verify rejects tampered HMAC with completion_token_invalid", () => {
    const token = signCompletionToken({
      finalKey: "uploads/a",
      contentType: "video/mp4",
      maxBytes: 100,
    });
    // Flip the last hex digit of the HMAC to simulate tampering.
    const [payload, hmac] = token.split(".");
    const lastChar = hmac[hmac.length - 1];
    const flipped = lastChar === "0" ? "1" : "0";
    const tampered = `${payload}.${hmac.slice(0, -1)}${flipped}`;
    expect(() => verifyCompletionToken(tampered)).toThrowError(
      expect.objectContaining({
        name: "StorageError",
        code: "completion_token_invalid",
      }),
    );
  });

  it("verify rejects non-hex hmac with completion_token_invalid (no raw TypeError leak)", () => {
    // Regression for pre-push reviewer MED 2026-05-16: an HMAC string of
    // valid length but non-hex chars (e.g. all 'z') would make
    // Buffer.from(..., "hex") yield a 0-byte buffer, then timingSafeEqual
    // throws RangeError — bypassing the StorageError wrapping contract.
    const token = signCompletionToken({
      finalKey: "k",
      contentType: "video/mp4",
      maxBytes: 100,
    });
    const [payload] = token.split(".");
    // 64-char non-hex (sha256 hex digest is 64 chars).
    const nonHexHmac = "z".repeat(64);
    expect(() => verifyCompletionToken(`${payload}.${nonHexHmac}`)).toThrowError(
      expect.objectContaining({
        name: "StorageError",
        code: "completion_token_invalid",
      }),
    );
  });

  it("verify rejects expired token with completion_token_expired", () => {
    // ttlMs = -1 → expiresAt = now - 1, already expired at verify time.
    const token = signCompletionToken(
      { finalKey: "k", contentType: "video/mp4", maxBytes: 100 },
      -1,
    );
    expect(() => verifyCompletionToken(token)).toThrowError(
      expect.objectContaining({
        name: "StorageError",
        code: "completion_token_expired",
      }),
    );
  });

  it("throws storage_not_configured (sign + verify) when UPLOAD_SIGNING_SECRET missing (nit #5)", () => {
    delete process.env.UPLOAD_SIGNING_SECRET;
    expect(() =>
      signCompletionToken({
        finalKey: "k",
        contentType: "video/mp4",
        maxBytes: 100,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "StorageError",
        code: "storage_not_configured",
      }),
    );
    expect(() => verifyCompletionToken("anything.deadbeef")).toThrowError(
      expect.objectContaining({
        name: "StorageError",
        code: "storage_not_configured",
      }),
    );
  });
});
