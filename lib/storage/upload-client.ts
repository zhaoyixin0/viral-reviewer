"use client";

/**
 * Browser-side upload shim — hand-rolled GCS POST policy lifecycle.
 *
 * P5.1.b-3 commit 1: replaces the previous `@vercel/blob/client.upload`
 * re-export with a 3-phase fetch flow against the b-2 server endpoint:
 *
 *   1. POST {type:"generate-signed-url",...} → receives opaque envelope
 *      with GCS POST policy {url, fields, completionToken, finalKey}.
 *   2. POSTs multipart/form-data DIRECTLY to GCS (bucket CORS allows).
 *      `fields` MUST be appended BEFORE `file` per GCS POST policy spec.
 *   3. POST {type:"completion", completionToken, blobInfo} back to the
 *      server endpoint — server verifies HMAC token + strict URL/key
 *      match (b-2 c2 HIGH nit #2 fix) + fires policy.onCompleted.
 *
 * 4 frontend callers (technique-match InputPanel/CapCutExport, review
 * InputPanel, template-review BriefUploader) keep the `(pathname, body,
 * opts) → {url, pathname, contentType, size}` signature (W3 b-3 verdict
 * A1) — caller code unchanged except BriefUploader's progress UI
 * (commit 2 — phase-only callback replaces percentage).
 *
 * Browser shim NOT re-exported from `lib/storage/index.ts` (index is
 * `server-only`-tainted). Callers MUST use the deep path:
 * `import { upload } from "@/lib/storage/upload-client"`.
 *
 * `"use client"` directive ensures Next.js bundles this file browser-side
 * only — defends against a stray server-side import.
 *
 * NODE TEST CAVEAT: tests require Node >= 20 — package.json `engines.node`
 * enforces this. Node 18's `globalThis.Blob` is `buffer.Blob` (not Web
 * Blob), which differs in `.stream()` return type; Node 20 aligns with
 * the Web Blob spec the browser ships. ECC MED-3 follow-up dc7ca23.
 */

/** Browser-facing result shape. Mirrors `BlobInfo` subset for caller compat. */
export interface UploadResult {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
}

/** Phase reported through `opts.onProgress` (W3 verdict C1 — no byte-level percentage). */
export type UploadPhase = "signing" | "uploading" | "completing";

/** Stable error-code set — mirrors server-side `StorageError.code` shape. */
export type UploadErrorCode =
  | "gen_signed_url_failed"
  | "gcs_upload_failed"
  | "completion_ping_failed"
  | "invalid_client_payload"
  | "network"
  | "aborted";

/**
 * Browser-side counterpart of `StorageError`. Caller can switch on `code`
 * to distinguish retryable (5xx via `responseStatus`) from non-retryable.
 *
 * `responseStatus` is HTTP status code ONLY (not response body) — per W3
 * verdict dc7ca23 ECC HIGH-1: a raw `response: unknown` field could let
 * a caller `JSON.stringify(err.response)` straight into a 3rd-party
 * analytics service, leaking server internals (stack trace, Sentry id,
 * internal paths) across the browser boundary.
 */
export class UploadError extends Error {
  readonly code: UploadErrorCode;
  readonly responseStatus?: number;

  constructor(
    code: UploadErrorCode,
    message: string,
    init?: { cause?: unknown; responseStatus?: number },
  ) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.responseStatus = init?.responseStatus;
    if (init?.cause !== undefined) {
      (this as { cause?: unknown }).cause = init.cause;
    }
  }
}

export interface UploadOptions {
  /** Reserved for caller-compat with the legacy Vercel SDK — only `"public"` is honored. */
  access: "public";
  /** Server endpoint that mints the signed POST policy + verifies completion. */
  handleUploadUrl: string;
  /** MIME of the file body — must be in server's `allowedContentTypes`. */
  contentType: string;
  /**
   * Forward-compat escape hatch — verbatim into phase 1 body, validated
   * server-side by `policy.clientPayloadSchema`. Defensively
   * JSON.stringify-checked at call site (throws `invalid_client_payload`
   * for circular refs / BigInt / function values).
   */
  clientPayload?: unknown;
  /** Aborts in-flight fetch(es) when triggered; throws `UploadError("aborted")`. */
  signal?: AbortSignal;
  /** Lifecycle callback — fires once per phase entry: signing → uploading → completing. */
  onProgress?: (phase: UploadPhase) => void;
}

interface SignedUploadPolicyEnvelope {
  readonly type: "signed-upload-policy";
  readonly url: string;
  readonly fields: Record<string, string>;
  readonly bucketName: string;
  readonly completionToken: string;
  readonly finalKey: string;
}

/**
 * Phase 1 envelope guard — opaque `UploadEnvelope` brand cast back here.
 *
 * Validates `bucketName` top-level presence (was previously `fields.bucket`
 * but Path A regressed at 411b231: GCS POST policy V4 rejects 400 for any
 * unknown form field not in policy conditions — `bucket` is not a policy
 * condition so sending it as form field broke uploads). bucketName is now
 * at envelope top-level: out-of-band for client (URL construction) without
 * polluting the multipart form sent to GCS.
 */
function isPolicyEnvelope(value: unknown): value is SignedUploadPolicyEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (
    v.type !== "signed-upload-policy" ||
    typeof v.url !== "string" ||
    typeof v.completionToken !== "string" ||
    typeof v.finalKey !== "string" ||
    typeof v.bucketName !== "string" ||
    v.bucketName.length === 0 ||
    v.fields === null ||
    typeof v.fields !== "object"
  ) {
    return false;
  }
  return true;
}

/**
 * Direct-upload a Blob/File to GCS via the b-2 signed-upload endpoint.
 *
 * Caller-compatible with the legacy `@vercel/blob/client.upload(pathname,
 * body, opts)` signature. Returns `{url, pathname, contentType, size}` —
 * subset of Vercel's `PutBlobResult` (drops `contentDisposition`, which
 * grep-verified no caller used).
 *
 * Errors thrown as `UploadError`:
 *   - `invalid_client_payload` — opts.clientPayload not JSON-serializable
 *   - `gen_signed_url_failed` — phase 1 non-2xx or schema mismatch
 *   - `gcs_upload_failed` — phase 2 GCS POST non-2xx (policy violation,
 *      bad form, etc.)
 *   - `completion_ping_failed` — phase 3 non-2xx
 *   - `network` — any fetch reject (offline / DNS / TLS)
 *   - `aborted` — opts.signal triggered mid-flight
 *
 * Lifecycle (all 3 fetch calls receive opts.signal for unified cancel):
 *   phase 1 → POST handleUploadUrl  ({type:"generate-signed-url",...})
 *   phase 2 → POST envelope.url     (multipart/form-data: fields..., file)
 *   phase 3 → POST handleUploadUrl  ({type:"completion",...})
 */
export async function upload(
  pathname: string,
  body: Blob | File,
  opts: UploadOptions,
): Promise<UploadResult> {
  // ECC MED-2 (dc7ca23): defensively validate clientPayload serializability
  // here so the failure mode is a clean UploadError at the call site, not
  // a `fetch(... body: JSON.stringify(undefined))` silently producing a
  // bad request. Current callers pass nothing (null) → safe; future callers
  // with circular refs / BigInt / functions surface-fail at this boundary.
  let phase1Body: string;
  try {
    phase1Body = JSON.stringify({
      type: "generate-signed-url",
      pathname,
      contentType: opts.contentType,
      clientPayload: opts.clientPayload ?? null,
    });
  } catch (e) {
    throw new UploadError(
      "invalid_client_payload",
      `opts.clientPayload is not JSON-serializable: ${
        e instanceof Error ? e.message : String(e)
      }`,
      { cause: e },
    );
  }

  // -------- Phase 1: mint signed POST policy + completion token ----------
  opts.onProgress?.("signing");
  const envelope = await fetchPhase1(
    opts.handleUploadUrl,
    phase1Body,
    opts.signal,
  );

  // -------- Phase 2: multipart POST directly to GCS ----------------------
  opts.onProgress?.("uploading");
  await fetchPhase2(envelope, body, opts.signal);

  // ECC follow-up correction (dc7ca23): client reconstructs blobInfo.url
  // from publicly known components — NOT from the GCS POST response
  // `Location` header (the W3 deep verdict's original nit #1 mandate was
  // WRONG; GCS POST 204 typically has no Location). The server-side
  // `urlToKey` (b-2 c2 HIGH nit #2) does strict bucket+key validation,
  // so a forged URL would be rejected at the completion-ping verify step.
  // bucketName from envelope top-level (Path B fix to 411b231 regression):
  // GCS POST policy V4 rejects unknown form fields, so bucket can't ride
  // along inside the `fields` object — it lives at envelope top-level instead.
  //
  // encodeURI(finalKey) per 2026-05-17 hot fix: filenames with spaces /
  // parens (e.g. "Download (1).mp4-abc12345") produce malformed URLs that
  // fail server-side fetch with 404. encodeURI preserves "/" path separator
  // while encoding spaces (%20) and special chars. Matches publicUrl()
  // helper in lib/storage/api.ts which uses same encoding for consistency.
  const blobUrl = `https://storage.googleapis.com/${envelope.bucketName}/${encodeURI(envelope.finalKey)}`;

  // -------- Phase 3: completion ping back to server ----------------------
  opts.onProgress?.("completing");
  await fetchPhase3(opts.handleUploadUrl, envelope.completionToken, {
    url: blobUrl,
    pathname: envelope.finalKey,
    contentType: opts.contentType,
    size: body.size,
  }, opts.signal);

  return {
    url: blobUrl,
    pathname: envelope.finalKey,
    contentType: opts.contentType,
    size: body.size,
  };
}

async function fetchPhase1(
  handleUploadUrl: string,
  body: string,
  signal: AbortSignal | undefined,
): Promise<SignedUploadPolicyEnvelope> {
  let resp: Response;
  try {
    resp = await fetch(handleUploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
  } catch (e) {
    throw classifyFetchError(e);
  }
  if (!resp.ok) {
    throw new UploadError(
      "gen_signed_url_failed",
      `signed-url endpoint returned ${resp.status}`,
      { responseStatus: resp.status },
    );
  }
  const envelope = (await resp.json().catch(() => null)) as unknown;
  if (!isPolicyEnvelope(envelope)) {
    throw new UploadError(
      "gen_signed_url_failed",
      "signed-url endpoint returned envelope of unexpected shape",
      { responseStatus: resp.status },
    );
  }
  return envelope;
}

async function fetchPhase2(
  envelope: SignedUploadPolicyEnvelope,
  body: Blob | File,
  signal: AbortSignal | undefined,
): Promise<void> {
  const fd = new FormData();
  // GCS POST policy mandates: ALL `fields` MUST be appended BEFORE the file.
  // Otherwise GCS rejects with `400 Bad Request: Missing required field 'key'`.
  for (const [k, v] of Object.entries(envelope.fields)) {
    fd.append(k, v);
  }
  fd.append("file", body);

  let resp: Response;
  try {
    resp = await fetch(envelope.url, {
      method: "POST",
      body: fd,
      signal,
    });
  } catch (e) {
    // W3 verdict + ECC MED-1 (dc7ca23): partial GCS upload cleanup is NOT
    // attempted here. If the abort races against GCS write completion, an
    // orphan object may persist. P5.8.x observability scope adds a bucket
    // lifecycle rule ("delete objects without `completed` metadata after
    // 24h") to mop up. Do NOT add retry / cleanup logic here without first
    // re-reading that lifecycle rule design.
    throw classifyFetchError(e);
  }
  if (!resp.ok) {
    throw new UploadError(
      "gcs_upload_failed",
      `GCS direct upload returned ${resp.status}`,
      { responseStatus: resp.status },
    );
  }
}

async function fetchPhase3(
  handleUploadUrl: string,
  completionToken: string,
  blobInfo: { url: string; pathname: string; contentType: string; size: number },
  signal: AbortSignal | undefined,
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(handleUploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "completion",
        completionToken,
        blobInfo,
      }),
      signal,
    });
  } catch (e) {
    throw classifyFetchError(e);
  }
  if (!resp.ok) {
    throw new UploadError(
      "completion_ping_failed",
      `completion endpoint returned ${resp.status}`,
      { responseStatus: resp.status },
    );
  }
}

/**
 * Map a `fetch()` reject into the appropriate `UploadError`.
 *
 * Per scope §2.3 B1: `network` is a single unified code for any fetch reject
 * across all 3 phases (offline / DNS / TLS). Phase-specific codes
 * (`gen_signed_url_failed` / `gcs_upload_failed` / `completion_ping_failed`)
 * are reserved for non-2xx STATUS responses, not connection-level failures.
 * `aborted` overrides everything when opts.signal triggers.
 */
function classifyFetchError(err: unknown): UploadError {
  if (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  ) {
    return new UploadError("aborted", "upload aborted via opts.signal", {
      cause: err,
    });
  }
  return new UploadError(
    "network",
    `network fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    { cause: err },
  );
}

