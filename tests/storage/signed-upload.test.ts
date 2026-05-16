import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * P5.1.b-2 commit 2: signed-upload.ts lifecycle rewritten from
 * `@vercel/blob/client.handleUpload` to GCS v4 signed POST policy + HMAC
 * completion ping (per W3 deep verdict 78b7d2f + ECC follow-up).
 *
 * Per W3 nit F mandate (carried from b-1 c9367c4): GCS SDK
 * `generateSignedPostPolicyV4` resolves to a 1-element tuple
 * `[PolicyResponse]`. Mock preserves the literal shape; never simplify to
 * `mockResolvedValue({url, fields})` (anti-pattern #3 defense).
 *
 * 13 contract cases from P5.1.a-4 are PRESERVED at the outer-assertion
 * level (envelope opacity, policy field forwarding, clientPayload schema,
 * onCompleted shape + error swallow, failure rewrap rules, json-parse,
 * subclass propagation, defensive guard). Mock setups are rewritten to
 * target the new lifecycle (gen-signed-url + completion ping).
 *
 * Net-new cases (W3 verdict 78b7d2f mandate):
 *   - completion ping happy path (valid token + matching URL → ack)
 *   - completion_token_invalid (tampered token)
 *   - completion_token_expired (past expiresAt)
 *   - completion_blob_mismatch via cross-bucket URL (W3 nit #2 HIGH —
 *     urlToKey strict match, NOT .includes substring)
 *   - completion_blob_mismatch via wrong finalKey in same bucket
 *   - contentType not in allowlist → invalid_upload_body
 *   - addRandomSuffix server-side enforcement (finalKey contains 8-char hex)
 *
 * Entry early-check case (commit 1 BLOCKER-7) preserved verbatim.
 */

const gcs = vi.hoisted(() => {
  const fileGenerateSignedPostPolicyV4 = vi.fn();
  const StorageCtor = vi.fn();
  return { fileGenerateSignedPostPolicyV4, StorageCtor };
});

vi.mock("@google-cloud/storage", () => {
  class Storage {
    constructor() {
      gcs.StorageCtor();
    }
    bucket(_name: string) {
      return {
        file: (_key: string) => ({
          generateSignedPostPolicyV4: gcs.fileGenerateSignedPostPolicyV4,
        }),
      };
    }
  }
  return { Storage };
});

import {
  __resetStorageForTests,
  handleSignedUpload,
  InvalidUploadBodyError,
  signCompletionToken,
  StorageError,
  type UploadPolicy,
} from "@/lib/storage";
import type { NextRequest } from "next/server";

const TEST_BUCKET = "viral-reviewer-blob-test";
const TEST_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

/** Build a body for the gen-signed-url phase with optional overrides. */
function genReq(overrides: {
  pathname?: string;
  contentType?: string;
  clientPayload?: unknown;
} = {}) {
  return {
    type: "generate-signed-url" as const,
    pathname: overrides.pathname ?? "uploads/x.pdf",
    contentType: overrides.contentType ?? "application/pdf",
    clientPayload: overrides.clientPayload ?? null,
  };
}

/** Build a body for the completion phase with optional overrides. */
function completionReq(overrides: {
  completionToken?: string;
  url?: string;
  pathname?: string;
  contentType?: string;
  size?: number;
} = {}) {
  const completionToken =
    overrides.completionToken ??
    signCompletionToken({
      finalKey: overrides.pathname ?? "uploads/x.pdf-abcd1234",
      contentType: overrides.contentType ?? "application/pdf",
      maxBytes: BASE_POLICY.maxBytes,
    });
  return {
    type: "completion" as const,
    completionToken,
    blobInfo: {
      url:
        overrides.url ??
        `https://storage.googleapis.com/${TEST_BUCKET}/${overrides.pathname ?? "uploads/x.pdf-abcd1234"}`,
      pathname: overrides.pathname ?? "uploads/x.pdf-abcd1234",
      contentType: overrides.contentType,
      size: overrides.size,
    },
  };
}

/** Resolve generateSignedPostPolicyV4 mock with the standard 1-tuple shape. */
function mockGenSignedPolicy(
  fields: Record<string, string> = { key: "uploads/x.pdf-abcd1234" },
) {
  gcs.fileGenerateSignedPostPolicyV4.mockResolvedValue([
    {
      url: `https://storage.googleapis.com/${TEST_BUCKET}/`,
      fields,
    },
    // INTENTIONAL: no second tuple element. The facade destructures via
    // `[policy] = await ...` — a future SDK switch to 2-tuple would break
    // here as the early signal (anti-pattern #3 defense).
  ]);
}

beforeEach(() => {
  gcs.fileGenerateSignedPostPolicyV4.mockReset();
  gcs.StorageCtor.mockReset();
  __resetStorageForTests();
  process.env.GCS_BUCKET_NAME = TEST_BUCKET;
  process.env.UPLOAD_SIGNING_SECRET = TEST_SECRET;
});

afterEach(() => {
  __resetStorageForTests();
  delete process.env.GCS_BUCKET_NAME;
  delete process.env.UPLOAD_SIGNING_SECRET;
});

describe("handleSignedUpload — happy path", () => {
  it("returns the signed-upload envelope opaquely (no caller-visible internals)", async () => {
    mockGenSignedPolicy();
    const result = await handleSignedUpload(
      makeReq(genReq()),
      { ...BASE_POLICY, addRandomSuffix: false },
    );
    // UploadEnvelope brand: callers MUST NOT destructure (compile-time
    // protection via `_uploadEnvelopeBrand`). Runtime shape is opaque.
    // We only assert the runtime returns an object — the brand prevents
    // any property reads at TS level.
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("forwards policy fields (allowedContentTypes/maxBytes/addRandomSuffix) into the GCS POST policy conditions", async () => {
    mockGenSignedPolicy();
    await handleSignedUpload(
      makeReq(genReq({ pathname: "uploads/foo.pdf", contentType: "video/mp4" })),
      {
        ...BASE_POLICY,
        allowedContentTypes: ["application/pdf", "video/mp4"],
        maxBytes: 42,
        addRandomSuffix: false,
      },
    );
    // contentType wired through (allowlist hit) + maxBytes wired into
    // content-length-range + key locked to finalKey (server-side enforce
    // of addRandomSuffix=false → finalKey === pathname).
    const args = gcs.fileGenerateSignedPostPolicyV4.mock.calls[0][0] as {
      conditions: Array<unknown[]>;
    };
    expect(args.conditions).toEqual([
      ["content-length-range", 0, 42],
      ["eq", "$Content-Type", "video/mp4"],
      ["eq", "$key", "uploads/foo.pdf"],
    ]);
  });
});

describe("handleSignedUpload — clientPayload schema", () => {
  it("passes when clientPayload satisfies z.null() schema", async () => {
    mockGenSignedPolicy();
    await expect(
      handleSignedUpload(makeReq(genReq({ clientPayload: null })), BASE_POLICY),
    ).resolves.toBeDefined();
  });

  it("throws InvalidUploadBodyError when clientPayload violates z.null()", async () => {
    await expect(
      handleSignedUpload(
        makeReq(genReq({ clientPayload: "unauthorized-payload" })),
        BASE_POLICY,
      ),
    ).rejects.toMatchObject({
      name: "InvalidUploadBodyError",
      code: "invalid_upload_body",
    });
  });

  it("allows widened clientPayload schema (proves schema is injected, not hardcoded)", async () => {
    mockGenSignedPolicy();
    await expect(
      handleSignedUpload(makeReq(genReq({ clientPayload: "valid-string" })), {
        ...BASE_POLICY,
        clientPayloadSchema: z.string(),
      }),
    ).resolves.toBeDefined();
  });
});

describe("handleSignedUpload — onCompleted hook (completion ping path)", () => {
  it("invokes onCompleted once with SignedUploadCompletion shape on a valid completion ping", async () => {
    const onCompleted = vi.fn().mockResolvedValue(undefined);
    const body = completionReq({
      pathname: "uploads/x.pdf",
      contentType: "application/pdf",
      size: 1234,
    });
    await handleSignedUpload(makeReq(body), { ...BASE_POLICY, onCompleted });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledWith({
      url: `https://storage.googleapis.com/${TEST_BUCKET}/uploads/x.pdf`,
      pathname: "uploads/x.pdf",
      contentType: "application/pdf",
      size: 1234,
    });
  });

  it("swallows + logs onCompleted hook errors (D3 推翻: no opt-in to fail)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hookErr = new Error("DB write failed");
    const onCompleted = vi.fn().mockRejectedValue(hookErr);
    const body = completionReq({ pathname: "uploads/x" });
    await expect(
      handleSignedUpload(makeReq(body), { ...BASE_POLICY, onCompleted }),
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
  it("throws StorageError('signed_upload_failed') when generateSignedPostPolicy rejects", async () => {
    gcs.fileGenerateSignedPostPolicyV4.mockRejectedValue(new Error("network"));
    await expect(
      handleSignedUpload(makeReq(genReq()), BASE_POLICY),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "signed_upload_failed",
    });
  });

  it("preserves the original error as StorageError.cause", async () => {
    const original = new Error("upstream");
    gcs.fileGenerateSignedPostPolicyV4.mockRejectedValue(original);
    try {
      await handleSignedUpload(makeReq(genReq()), BASE_POLICY);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError);
      // generateSignedPostPolicy wraps SDK error in StorageError
      // ("signed_upload_failed") with cause = original. signed-upload.ts
      // re-throws via `if (e instanceof StorageError) throw e` without
      // rewrapping, so the cause chain is preserved 1 level deep.
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
    expect(gcs.fileGenerateSignedPostPolicyV4).not.toHaveBeenCalled();
  });

  it("InvalidUploadBodyError from clientPayload schema is not rewrapped (subclass identity preserved)", async () => {
    // Previously (a-4): the inner throw happened inside Vercel's
    // onBeforeGenerateToken callback. Post-b-2: the schema check is
    // inline in handleGenerateSignedUrl. The subclass identity rule
    // still holds — InvalidUploadBodyError MUST NOT become signed_upload_failed.
    const err = await handleSignedUpload(
      makeReq(genReq({ clientPayload: "rejected" })),
      BASE_POLICY,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidUploadBodyError);
    expect(err.code).toBe("invalid_upload_body");
  });

  it("non-InvalidUploadBody StorageError propagates without rewrap (subclass identity preserved)", async () => {
    // Per typescript-reviewer a-4 commit 1 LOW #1: cover the
    // subclass identity preservation rule. Post-b-2 the natural source of
    // a non-InvalidUploadBody StorageError reaching signed-upload.ts's
    // outer scope is `verifyCompletionToken` (token tamper/expire) —
    // those throw their own StorageError subtypes (completion_token_*).
    // The CRITICAL guarantee: the original code MUST NOT be rewrapped
    // into a generic `signed_upload_failed` by an outer catch.
    //
    // (a-4 baseline used a mocked custom code; post-b-2, api.ts helpers
    //  always normalize SDK errors to `signed_upload_failed` so the
    //  natural test surface moves to verify*Token codes.)
    const expiredToken = signCompletionToken(
      { finalKey: "k", contentType: "application/pdf", maxBytes: 100 },
      -1,
    );
    const err = await handleSignedUpload(
      makeReq(completionReq({ completionToken: expiredToken })),
      BASE_POLICY,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err.code).toBe("completion_token_expired");
    expect(err.code).not.toBe("signed_upload_failed");
  });
});

describe("handleSignedUpload — entry early-check (BLOCKER-7 78b7d2f)", () => {
  it("throws storage_not_configured before req.json() when UPLOAD_SIGNING_SECRET missing", async () => {
    // ECC follow-up BLOCKER-7: lib entry-level requireUploadSecret() fires
    // BEFORE any lifecycle. Verify by passing a req whose .json() would
    // throw — if early-check is missing, the test would see
    // InvalidUploadBodyError instead.
    delete process.env.UPLOAD_SIGNING_SECRET;
    await expect(
      handleSignedUpload(makeReq(null, { jsonThrows: true }), BASE_POLICY),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "storage_not_configured",
    });
    expect(gcs.fileGenerateSignedPostPolicyV4).not.toHaveBeenCalled();
  });
});

describe("handleSignedUpload — defensive guards", () => {
  it("does not throw when onCompleted is undefined on a valid completion ping", async () => {
    // BASE_POLICY has no onCompleted. Valid completion ping must still
    // return an envelope (the no-onCompleted early-return inside the
    // completion phase).
    const body = completionReq({ pathname: "uploads/x" });
    await expect(
      handleSignedUpload(makeReq(body), BASE_POLICY),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// P5.1.b-2 commit 2 — NEW GCS-specific cases (W3 verdict 78b7d2f mandate)
// ---------------------------------------------------------------------------

describe("handleSignedUpload — completion token verify (new b-2 paths)", () => {
  it("rejects completion ping with tampered token → completion_token_invalid", async () => {
    const validToken = signCompletionToken({
      finalKey: "uploads/x.pdf-abcd1234",
      contentType: "application/pdf",
      maxBytes: BASE_POLICY.maxBytes,
    });
    // Flip last hex char of HMAC suffix to simulate tampering.
    const [payloadEnc, hmac] = validToken.split(".");
    const lastChar = hmac[hmac.length - 1];
    const flipped = lastChar === "0" ? "1" : "0";
    const tamperedToken = `${payloadEnc}.${hmac.slice(0, -1)}${flipped}`;

    await expect(
      handleSignedUpload(
        makeReq(completionReq({ completionToken: tamperedToken })),
        BASE_POLICY,
      ),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "completion_token_invalid",
    });
  });

  it("rejects completion ping with expired token → completion_token_expired", async () => {
    const expiredToken = signCompletionToken(
      {
        finalKey: "uploads/x.pdf-abcd1234",
        contentType: "application/pdf",
        maxBytes: BASE_POLICY.maxBytes,
      },
      -1, // ttlMs = -1 → expiresAt = now - 1, already past at verify
    );
    await expect(
      handleSignedUpload(
        makeReq(completionReq({ completionToken: expiredToken })),
        BASE_POLICY,
      ),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "completion_token_expired",
    });
  });

  it("rejects completion with cross-bucket URL → completion_blob_mismatch (urlToKey strict, NOT .includes substring)", async () => {
    // W3 nit #2 HIGH (78b7d2f): attacker constructs blobInfo.url containing
    // finalKey as substring but pointing to another bucket. urlToKey must
    // catch this via strict bucket-name prefix match.
    const finalKey = "uploads/x.pdf-abcd1234";
    const token = signCompletionToken({
      finalKey,
      contentType: "application/pdf",
      maxBytes: BASE_POLICY.maxBytes,
    });
    const crossBucketUrl = `https://storage.googleapis.com/evil-bucket/${finalKey}`;
    await expect(
      handleSignedUpload(
        makeReq(
          completionReq({
            completionToken: token,
            url: crossBucketUrl,
            pathname: finalKey,
          }),
        ),
        BASE_POLICY,
      ),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "completion_blob_mismatch",
    });
  });

  it("rejects completion when extracted key does not match token finalKey → completion_blob_mismatch", async () => {
    // blobInfo.url IS in the right bucket but for a DIFFERENT key.
    const token = signCompletionToken({
      finalKey: "uploads/expected-key",
      contentType: "application/pdf",
      maxBytes: BASE_POLICY.maxBytes,
    });
    const wrongKeyUrl = `https://storage.googleapis.com/${TEST_BUCKET}/uploads/different-key`;
    await expect(
      handleSignedUpload(
        makeReq(
          completionReq({
            completionToken: token,
            url: wrongKeyUrl,
            pathname: "uploads/different-key",
          }),
        ),
        BASE_POLICY,
      ),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "completion_blob_mismatch",
    });
  });

  it("returns completion-ack envelope on valid completion ping (happy path)", async () => {
    const body = completionReq({ pathname: "uploads/x.pdf-abcd1234" });
    const result = await handleSignedUpload(makeReq(body), BASE_POLICY);
    expect(result).toBeDefined();
    // Envelope opacity preserved — only assert object shape.
    expect(typeof result).toBe("object");
  });
});

describe("handleSignedUpload — generate-signed-url defensive (new b-2 paths)", () => {
  it("rejects contentType not in allowlist → invalid_upload_body", async () => {
    await expect(
      handleSignedUpload(
        makeReq(genReq({ contentType: "application/x-evil" })),
        BASE_POLICY,
      ),
    ).rejects.toMatchObject({
      name: "InvalidUploadBodyError",
      code: "invalid_upload_body",
    });
    expect(gcs.fileGenerateSignedPostPolicyV4).not.toHaveBeenCalled();
  });

  it("rejects pathname containing '|' (canonical-payload separator) → invalid_upload_body", async () => {
    // Pre-push typescript-reviewer HIGH 2026-05-16: a pipe char in the
    // pathname would propagate into finalKey, splitting the canonical
    // completion-token payload into 6 fields and surfacing a misleading
    // completion_token_invalid downstream. Schema regex rejects the input
    // up-front as the correct invalid_upload_body 400.
    await expect(
      handleSignedUpload(
        makeReq(genReq({ pathname: "uploads/evil|injected" })),
        BASE_POLICY,
      ),
    ).rejects.toMatchObject({
      name: "InvalidUploadBodyError",
      code: "invalid_upload_body",
    });
    expect(gcs.fileGenerateSignedPostPolicyV4).not.toHaveBeenCalled();
  });

  it("server-side addRandomSuffix appends 8-char hex; finalKey locks into POST policy condition (W3 G)", async () => {
    mockGenSignedPolicy();
    await handleSignedUpload(
      makeReq(genReq({ pathname: "uploads/foo.pdf" })),
      { ...BASE_POLICY, addRandomSuffix: true },
    );
    const args = gcs.fileGenerateSignedPostPolicyV4.mock.calls[0][0] as {
      conditions: Array<unknown[]>;
    };
    // last condition is ["eq", "$key", finalKey] — extract + verify shape.
    const keyCondition = args.conditions[args.conditions.length - 1];
    expect(keyCondition[0]).toBe("eq");
    expect(keyCondition[1]).toBe("$key");
    expect(keyCondition[2]).toMatch(/^uploads\/foo\.pdf-[0-9a-f]{8}$/);
  });
});
