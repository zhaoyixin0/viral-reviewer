import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5.1.b-3 commit 1: hand-rolled GCS POST policy upload-client test suite.
 *
 * Per W3 verdict dc7ca23 G3: tests use Node-native `fetch` + `FormData` +
 * `Blob` (no jsdom dep) — Node 20+ aligns globalThis.Blob with the Web
 * Blob spec (the package.json `engines.node >= 20` enforces).
 *
 * Mock strategy: `vi.spyOn(globalThis, "fetch")` intercepts all 3 phase
 * fetch calls per upload. Each test sets up the responses in order and
 * asserts call shape + sequence.
 *
 * Per W3 verdict dc7ca23 nit #1 CORRECTION (ECC HIGH-2): `blobInfo.url`
 * is RECONSTRUCTED from `envelope.fields["bucket"] + envelope.finalKey`,
 * NOT pulled from a phase-2 `Location` header (which GCS POST 204
 * typically does not include).
 */

import {
  upload,
  UploadError,
  type UploadOptions,
} from "@/lib/storage/upload-client";

const TEST_BUCKET = "viral-reviewer-blob-test";
const TEST_HANDLE_URL = "/api/upload";

const BASE_OPTS: UploadOptions = {
  access: "public",
  handleUploadUrl: TEST_HANDLE_URL,
  contentType: "video/mp4",
};

function makeBlob(size = 4): Blob {
  return new Blob(["A".repeat(size)], { type: "video/mp4" });
}

function makeEnvelope(finalKey = "uploads/foo.mp4-abcd1234") {
  return {
    type: "signed-upload-policy",
    url: `https://storage.googleapis.com/${TEST_BUCKET}/`,
    fields: {
      bucket: TEST_BUCKET,
      key: finalKey,
      "Content-Type": "video/mp4",
      policy: "<base64-policy>",
      "x-goog-algorithm": "GOOG4-RSA-SHA256",
      "x-goog-credential": "service-account/...",
      "x-goog-date": "20260516T093000Z",
      "x-goog-signature": "deadbeef",
    },
    completionToken: "abcDEF.deadbeef",
    finalKey,
  };
}

function mockOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockNoBody(status = 204): Response {
  return new Response(null, { status });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch") as ReturnType<typeof vi.spyOn>;
});

afterEach(() => {
  fetchSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Happy path — 3-fetch lifecycle
// ---------------------------------------------------------------------------

describe("upload — happy path", () => {
  it("issues 3 fetch calls (gen-signed-url → GCS → completion) and returns UploadResult", async () => {
    const envelope = makeEnvelope("uploads/foo.mp4-abcd1234");
    fetchSpy
      .mockResolvedValueOnce(mockOk(envelope)) // phase 1
      .mockResolvedValueOnce(mockNoBody(204)) // phase 2 GCS
      .mockResolvedValueOnce(mockOk({ type: "completion-ack", success: true })); // phase 3

    const result = await upload("uploads/foo.mp4", makeBlob(4), BASE_OPTS);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      url: `https://storage.googleapis.com/${TEST_BUCKET}/uploads/foo.mp4-abcd1234`,
      pathname: "uploads/foo.mp4-abcd1234",
      contentType: "video/mp4",
      size: 4,
    });
  });

  it("phase 1 POSTs JSON body with type=generate-signed-url + pathname + contentType + clientPayload", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockOk(makeEnvelope()))
      .mockResolvedValueOnce(mockNoBody(204))
      .mockResolvedValueOnce(mockOk({ ok: true }));

    await upload("uploads/foo.mp4", makeBlob(), {
      ...BASE_OPTS,
      clientPayload: { hint: "demo" },
    });

    const [phase1Url, phase1Init] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(phase1Url).toBe(TEST_HANDLE_URL);
    expect(phase1Init.method).toBe("POST");
    expect(
      (phase1Init.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/json");
    const phase1Body = JSON.parse(phase1Init.body as string);
    expect(phase1Body).toEqual({
      type: "generate-signed-url",
      pathname: "uploads/foo.mp4",
      contentType: "video/mp4",
      clientPayload: { hint: "demo" },
    });
  });

  it("phase 2 POSTs multipart/form-data to envelope.url with fields BEFORE file (F1 mandate)", async () => {
    const envelope = makeEnvelope("uploads/foo.mp4-abcd1234");
    fetchSpy
      .mockResolvedValueOnce(mockOk(envelope))
      .mockResolvedValueOnce(mockNoBody(204))
      .mockResolvedValueOnce(mockOk({ ok: true }));

    await upload("uploads/foo.mp4", makeBlob(), BASE_OPTS);

    const [phase2Url, phase2Init] = fetchSpy.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(phase2Url).toBe(envelope.url);
    expect(phase2Init.method).toBe("POST");
    expect(phase2Init.body).toBeInstanceOf(FormData);
    const fd = phase2Init.body as FormData;
    // GCS POST policy mandates: `key` (and ALL fields) MUST come before `file`.
    // FormData preserves insertion order — entries() yields exactly that.
    const keys = Array.from(fd.keys());
    const fileIdx = keys.indexOf("file");
    expect(fileIdx).toBeGreaterThan(0); // file must NOT be first
    expect(fileIdx).toBe(keys.length - 1); // file must be LAST
    // All envelope.fields must be present in the same set
    for (const k of Object.keys(envelope.fields)) {
      expect(keys).toContain(k);
    }
    // Verify specific values to guard against silent field mutation.
    expect(fd.get("bucket")).toBe(TEST_BUCKET);
    expect(fd.get("key")).toBe("uploads/foo.mp4-abcd1234");
  });

  it("phase 3 POSTs JSON body with type=completion + completionToken + blobInfo reconstructed (W3 nit #1 CORRECTION)", async () => {
    const envelope = makeEnvelope("uploads/foo.mp4-abcd1234");
    fetchSpy
      .mockResolvedValueOnce(mockOk(envelope))
      .mockResolvedValueOnce(mockNoBody(204))
      .mockResolvedValueOnce(mockOk({ ok: true }));

    await upload("uploads/foo.mp4", makeBlob(7), BASE_OPTS);

    const [phase3Url, phase3Init] = fetchSpy.mock.calls[2] as [
      string,
      RequestInit,
    ];
    expect(phase3Url).toBe(TEST_HANDLE_URL);
    const phase3Body = JSON.parse(phase3Init.body as string);
    // Per W3 verdict dc7ca23 nit #1 CORRECTION (ECC HIGH-2): blobInfo.url
    // MUST be reconstructed from envelope.fields[bucket] + envelope.finalKey,
    // NOT from a phase-2 Location header (which GCS 204 lacks).
    expect(phase3Body).toEqual({
      type: "completion",
      completionToken: envelope.completionToken,
      blobInfo: {
        url: `https://storage.googleapis.com/${TEST_BUCKET}/uploads/foo.mp4-abcd1234`,
        pathname: "uploads/foo.mp4-abcd1234",
        contentType: "video/mp4",
        size: 7,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// onProgress lifecycle callback
// ---------------------------------------------------------------------------

describe("upload — onProgress", () => {
  it("fires once per phase in order: signing → uploading → completing (W3 C1)", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockOk(makeEnvelope()))
      .mockResolvedValueOnce(mockNoBody(204))
      .mockResolvedValueOnce(mockOk({ ok: true }));
    const onProgress = vi.fn();
    await upload("uploads/foo.mp4", makeBlob(), {
      ...BASE_OPTS,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      "signing",
      "uploading",
      "completing",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("upload — error paths", () => {
  it("throws UploadError('gen_signed_url_failed') with responseStatus on phase 1 non-2xx", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("err", { status: 500 }));
    const err = await upload("uploads/foo.mp4", makeBlob(), BASE_OPTS).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe("gen_signed_url_failed");
    expect(err.responseStatus).toBe(500);
  });

  it("throws UploadError('gen_signed_url_failed') when phase 1 envelope shape is wrong", async () => {
    fetchSpy.mockResolvedValueOnce(mockOk({ type: "wrong-shape" }));
    const err = await upload("uploads/foo.mp4", makeBlob(), BASE_OPTS).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe("gen_signed_url_failed");
    // ECC HIGH-1: responseStatus carries the HTTP status (not body) — never leak
    // response payload through the error.
    expect(err).not.toHaveProperty("response");
  });

  it("throws UploadError('gcs_upload_failed') on phase 2 non-2xx", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockOk(makeEnvelope()))
      .mockResolvedValueOnce(new Response("policy violation", { status: 403 }));
    const err = await upload("uploads/foo.mp4", makeBlob(), BASE_OPTS).catch(
      (e) => e,
    );
    expect(err.code).toBe("gcs_upload_failed");
    expect(err.responseStatus).toBe(403);
  });

  it("rejects envelope at phase 1 when fields.bucket missing (defense-in-depth: prevents orphan GCS upload)", async () => {
    // Per pre-push reviewer MED 2026-05-16: bucket presence validated by
    // isPolicyEnvelope at phase 1 — earlier than the previous post-GCS
    // guard. This prevents an orphan GCS object in the window between
    // phase 2 success and phase 3 reconstruction failure (P5.8.x lifecycle
    // cleanup not yet deployed).
    const envelope = makeEnvelope();
    delete (envelope.fields as Record<string, string>).bucket;
    fetchSpy.mockResolvedValueOnce(mockOk(envelope));
    const err = await upload("uploads/foo.mp4", makeBlob(), BASE_OPTS).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe("gen_signed_url_failed");
    // Phase 2 GCS POST MUST NOT have been issued — that's the entire point.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws UploadError('completion_ping_failed') on phase 3 non-2xx", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockOk(makeEnvelope()))
      .mockResolvedValueOnce(mockNoBody(204))
      .mockResolvedValueOnce(new Response("expired", { status: 401 }));
    const err = await upload("uploads/foo.mp4", makeBlob(), BASE_OPTS).catch(
      (e) => e,
    );
    expect(err.code).toBe("completion_ping_failed");
    expect(err.responseStatus).toBe(401);
  });

  it("throws UploadError('network') when phase 1 fetch rejects (non-abort)", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = await upload("uploads/foo.mp4", makeBlob(), BASE_OPTS).catch(
      (e) => e,
    );
    expect(err.code).toBe("network");
  });

  it("throws UploadError('network') when phase 2 fetch rejects mid-upload (regression for dead-arg bug)", async () => {
    // Pre-push reviewer (a63d93e6 2026-05-16) flagged classifyFetchError's
    // dead 2nd arg let phase 2 fetch-reject slip past unit-tested behavior.
    // Per scope §2.3 B1: ALL fetch rejects unify under `network` regardless
    // of phase (only non-2xx status uses phase-specific codes). Lock this in.
    fetchSpy
      .mockResolvedValueOnce(mockOk(makeEnvelope()))
      .mockRejectedValueOnce(new TypeError("connection reset by peer"));
    const err = await upload("uploads/foo.mp4", makeBlob(), BASE_OPTS).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe("network");
  });

  it("throws UploadError('aborted') when opts.signal triggers AbortError", async () => {
    const abortCtrl = new AbortController();
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          // Simulate fetch honoring the signal — when signal aborts, fetch rejects
          // with a DOMException(AbortError) per fetch spec.
          abortCtrl.signal.addEventListener("abort", () => {
            const err = new DOMException("aborted", "AbortError");
            reject(err);
          });
        }),
    );
    const promise = upload("uploads/foo.mp4", makeBlob(), {
      ...BASE_OPTS,
      signal: abortCtrl.signal,
    });
    abortCtrl.abort();
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe("aborted");
  });

  it("throws UploadError('invalid_client_payload') for non-JSON-serializable clientPayload (ECC MED-2)", async () => {
    // Circular ref → JSON.stringify throws TypeError.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const err = await upload("uploads/foo.mp4", makeBlob(), {
      ...BASE_OPTS,
      clientPayload: circular,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.code).toBe("invalid_client_payload");
    // Phase 1 fetch must NOT have been called — error fires at body serialize.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AbortSignal end-to-end propagation
// ---------------------------------------------------------------------------

describe("upload — AbortSignal", () => {
  it("forwards opts.signal to all 3 fetch calls (E1)", async () => {
    const abortCtrl = new AbortController();
    fetchSpy
      .mockResolvedValueOnce(mockOk(makeEnvelope()))
      .mockResolvedValueOnce(mockNoBody(204))
      .mockResolvedValueOnce(mockOk({ ok: true }));
    await upload("uploads/foo.mp4", makeBlob(), {
      ...BASE_OPTS,
      signal: abortCtrl.signal,
    });
    for (let i = 0; i < 3; i++) {
      const init = fetchSpy.mock.calls[i][1] as RequestInit;
      expect(init.signal).toBe(abortCtrl.signal);
    }
  });
});
