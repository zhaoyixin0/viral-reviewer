import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Mock @vercel/blob/client — hoisted to top of module per vitest semantics.
// Mirrors the a-2 pattern in tests/storage/api.test.ts for @vercel/blob.
const handleUploadMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  handleUpload: (...a: unknown[]) => handleUploadMock(...a),
}));

import {
  handleSignedUpload,
  InvalidUploadBodyError,
  StorageError,
  type UploadPolicy,
} from "@/lib/storage";
import type { NextRequest } from "next/server";

beforeEach(() => {
  handleUploadMock.mockReset();
  // P5.1.b-2 commit 1 BLOCKER-7 (ECC follow-up 78b7d2f): handleSignedUpload
  // now requireUploadSecret() at entry — without UPLOAD_SIGNING_SECRET, every
  // case here would throw storage_not_configured before reaching the
  // happy/failure assertions. Hex 32-byte test value (matches the
  // `openssl rand -hex 32` runbook line W2 P5.2.4.2 will provision in prod).
  process.env.UPLOAD_SIGNING_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

afterEach(() => {
  delete process.env.UPLOAD_SIGNING_SECRET;
});

/**
 * Contract tests for `lib/storage/signed-upload.ts` (P5.1.a-4).
 *
 * Per W3 deep verdict cd7f45a:
 * - D1 approve: 4xx parse / schema failure → `InvalidUploadBodyError`.
 * - D2 approve: facade is server-side only; client `upload()` call sites
 *   removed in P5.1.a-5.
 * - D3 推翻: onCompleted hook errors are always swallowed + logged.
 * - D4 approve: grep CI check is a separate `npm run check:storage-imports` task.
 * - typescript-reviewer #3 mandate: `InvalidUploadBodyError.code` is fixed
 *   `"invalid_upload_body"` (snake_case).
 *
 * Like a-2's `api.test.ts`, these are mock-based contract tests baseline-frozen
 * for P5.1.b: the GCS swap must keep these assertions green with zero change.
 */

const BASE_POLICY: UploadPolicy = {
  logTag: "test-upload",
  allowedContentTypes: ["application/pdf"],
  maxBytes: 100 * 1024 * 1024,
  addRandomSuffix: true,
  clientPayloadSchema: z.null(),
};

// Minimal fake — handleSignedUpload only calls req.json() in the happy path.
function makeReq(body: unknown, opts: { jsonThrows?: boolean } = {}): NextRequest {
  return {
    json: opts.jsonThrows
      ? () => Promise.reject(new Error("Unexpected token"))
      : () => Promise.resolve(body),
  } as unknown as NextRequest;
}

describe("handleSignedUpload — happy path", () => {
  it("returns the handleUpload JSON envelope opaquely", async () => {
    const envelope = { type: "blob.generate-client-token", clientToken: "tok" };
    handleUploadMock.mockResolvedValue(envelope);
    const result = await handleSignedUpload(
      makeReq({ type: "blob.generate-client-token" }),
      BASE_POLICY,
    );
    expect(result).toBe(envelope);
  });

  it("forwards policy fields (allowedContentTypes/maxBytes/addRandomSuffix) to handleUpload", async () => {
    handleUploadMock.mockImplementation(async (args: {
      onBeforeGenerateToken: (
        pathname: string,
        clientPayload: string | null,
      ) => Promise<{
        allowedContentTypes: string[];
        maximumSizeInBytes: number;
        addRandomSuffix?: boolean;
      }>;
    }) => {
      const tokenOpts = await args.onBeforeGenerateToken("uploads/foo.pdf", null);
      return { _tokenOpts: tokenOpts };
    });

    const result = (await handleSignedUpload(makeReq({}), {
      ...BASE_POLICY,
      allowedContentTypes: ["application/pdf", "video/mp4"],
      maxBytes: 42,
      addRandomSuffix: false,
    })) as unknown as { _tokenOpts: { allowedContentTypes: string[]; maximumSizeInBytes: number; addRandomSuffix?: boolean } };

    expect(result._tokenOpts.allowedContentTypes).toEqual([
      "application/pdf",
      "video/mp4",
    ]);
    expect(result._tokenOpts.maximumSizeInBytes).toBe(42);
    expect(result._tokenOpts.addRandomSuffix).toBe(false);
  });
});

describe("handleSignedUpload — clientPayload schema", () => {
  it("passes when clientPayload satisfies z.null() schema", async () => {
    handleUploadMock.mockImplementation(async (args: {
      onBeforeGenerateToken: (
        p: string,
        cp: string | null,
      ) => Promise<unknown>;
    }) => {
      await args.onBeforeGenerateToken("uploads/x.pdf", null);
      return { ok: true };
    });
    await expect(
      handleSignedUpload(makeReq({}), BASE_POLICY),
    ).resolves.toBeDefined();
  });

  it("throws InvalidUploadBodyError when clientPayload violates z.null()", async () => {
    handleUploadMock.mockImplementation(async (args: {
      onBeforeGenerateToken: (
        p: string,
        cp: string | null,
      ) => Promise<unknown>;
    }) => {
      // Simulate handleUpload invoking the callback with a string payload.
      return args.onBeforeGenerateToken("uploads/x.pdf", "unauthorized-payload");
    });
    await expect(
      handleSignedUpload(makeReq({}), BASE_POLICY),
    ).rejects.toMatchObject({
      name: "InvalidUploadBodyError",
      code: "invalid_upload_body",
    });
  });

  it("allows widened clientPayload schema (proves schema is injected, not hardcoded)", async () => {
    handleUploadMock.mockImplementation(async (args: {
      onBeforeGenerateToken: (
        p: string,
        cp: string | null,
      ) => Promise<unknown>;
    }) => {
      const tokenOpts = await args.onBeforeGenerateToken("uploads/x.pdf", "valid-string");
      return { tokenOpts };
    });
    await expect(
      handleSignedUpload(makeReq({}), {
        ...BASE_POLICY,
        clientPayloadSchema: z.string(),
      }),
    ).resolves.toBeDefined();
  });
});

describe("handleSignedUpload — onCompleted hook", () => {
  it("invokes onCompleted once with BlobInfo subset (no size — Vercel PutBlobResult omits it)", async () => {
    const onCompleted = vi.fn().mockResolvedValue(undefined);
    handleUploadMock.mockImplementation(async (args: {
      onUploadCompleted: (p: {
        blob: { url: string; pathname: string; contentType?: string };
      }) => Promise<void>;
    }) => {
      await args.onUploadCompleted({
        blob: {
          url: "https://blob/x.pdf",
          pathname: "uploads/x.pdf",
          contentType: "application/pdf",
        },
      });
      return { ok: true };
    });

    await handleSignedUpload(makeReq({}), { ...BASE_POLICY, onCompleted });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledWith({
      url: "https://blob/x.pdf",
      pathname: "uploads/x.pdf",
      contentType: "application/pdf",
    });
  });

  it("swallows + logs onCompleted hook errors (D3 推翻: no opt-in to fail)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hookErr = new Error("DB write failed");
    const onCompleted = vi.fn().mockRejectedValue(hookErr);
    handleUploadMock.mockImplementation(async (args: {
      onUploadCompleted: (p: {
        blob: { url: string; pathname: string };
      }) => Promise<void>;
    }) => {
      await args.onUploadCompleted({
        blob: { url: "https://blob/x", pathname: "uploads/x" },
      });
      return { ok: true };
    });

    await expect(
      handleSignedUpload(makeReq({}), { ...BASE_POLICY, onCompleted }),
    ).resolves.toBeDefined();
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[test-upload] onCompleted hook failed:",
      hookErr,
    );
    errorSpy.mockRestore();
  });
});

describe("handleSignedUpload — failure paths", () => {
  it("throws StorageError('signed_upload_failed') when handleUpload rejects", async () => {
    handleUploadMock.mockRejectedValue(new Error("network"));
    await expect(
      handleSignedUpload(makeReq({}), BASE_POLICY),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "signed_upload_failed",
    });
  });

  it("preserves the original error as StorageError.cause", async () => {
    const original = new Error("upstream");
    handleUploadMock.mockRejectedValue(original);
    try {
      await handleSignedUpload(makeReq({}), BASE_POLICY);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError);
      expect((e as StorageError).cause).toBe(original);
    }
  });

  it("throws InvalidUploadBodyError when req.json() fails", async () => {
    await expect(
      handleSignedUpload(makeReq(null, { jsonThrows: true }), BASE_POLICY),
    ).rejects.toMatchObject({
      name: "InvalidUploadBodyError",
      code: "invalid_upload_body",
    });
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("InvalidUploadBodyError thrown inside onBeforeGenerateToken is not rewrapped", async () => {
    // If handleUpload propagates the inner throw, the outer catch must preserve
    // the subclass identity (not re-wrap into generic signed_upload_failed).
    handleUploadMock.mockImplementation(async (args: {
      onBeforeGenerateToken: (
        p: string,
        cp: string | null,
      ) => Promise<unknown>;
    }) => args.onBeforeGenerateToken("uploads/x", "rejected"));
    const err = await handleSignedUpload(makeReq({}), BASE_POLICY).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidUploadBodyError);
    expect(err.code).toBe("invalid_upload_body");
  });

  it("non-InvalidUploadBody StorageError from handleUpload propagates without rewrap", async () => {
    // Per typescript-reviewer a-4 commit 1 LOW #1: cover the
    // `if (e instanceof StorageError) throw e;` re-throw path. Important for
    // P5.1.b when the GCS adapter may surface its own StorageError subtypes.
    const customErr = new StorageError("provider_specific", "GCS auth failed");
    handleUploadMock.mockRejectedValue(customErr);
    const err = await handleSignedUpload(makeReq({}), BASE_POLICY).catch((e) => e);
    expect(err).toBe(customErr);
    expect(err.code).toBe("provider_specific");
  });
});

describe("handleSignedUpload — entry early-check (BLOCKER-7 78b7d2f)", () => {
  it("throws storage_not_configured before req.json() when UPLOAD_SIGNING_SECRET missing", async () => {
    // ECC follow-up BLOCKER-7: lib entry-level requireUploadSecret() fires
    // BEFORE handleUpload lifecycle. Verify by passing a req whose .json()
    // would throw — if the early-check is missing, the test would instead
    // see InvalidUploadBodyError. The presence of storage_not_configured
    // proves the early-check ran first.
    delete process.env.UPLOAD_SIGNING_SECRET;
    await expect(
      handleSignedUpload(makeReq(null, { jsonThrows: true }), BASE_POLICY),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "storage_not_configured",
    });
    // handleUpload (Vercel lifecycle) must not have been invoked either.
    expect(handleUploadMock).not.toHaveBeenCalled();
  });
});

describe("handleSignedUpload — defensive guards", () => {
  it("does not throw when onCompleted is undefined (guard inside onUploadCompleted)", async () => {
    // Per typescript-reviewer a-4 commit 1 LOW #2: BASE_POLICY has no
    // onCompleted, but the previous happy-path test didn't trigger
    // onUploadCompleted — explicitly fire it to exercise the early-return guard.
    handleUploadMock.mockImplementation(async (args: {
      onUploadCompleted: (p: {
        blob: { url: string; pathname: string };
      }) => Promise<void>;
    }) => {
      await args.onUploadCompleted({
        blob: { url: "https://blob/x", pathname: "uploads/x" },
      });
      return { ok: true };
    });

    await expect(
      handleSignedUpload(makeReq({}), BASE_POLICY),
    ).resolves.toBeDefined();
  });
});
