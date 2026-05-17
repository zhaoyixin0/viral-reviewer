import "server-only";

import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z, type ZodType } from "zod";

import {
  generateSignedPostPolicy,
  signCompletionToken,
  urlToKey,
  verifyCompletionToken,
} from "./api";
import { getStorage } from "./client";
import { type BlobInfo, StorageError } from "./types";

/**
 * Server-side helper for client-direct uploads.
 *
 * P5.1.b-2 commit 2: lifecycle swapped from `@vercel/blob/client.handleUpload`
 * to GCS v4 signed POST policy + HMAC-signed completion ping (W3 deep verdict
 * 78b7d2f A1+B1+C1+D1+E+F+G). Browser POSTs to the same endpoint with two
 * shapes (`generate-signed-url` / `completion`); the facade routes by `type`.
 *
 * Per W3 P5.1.a-4 plan deep verdict cd7f45a (preserved through b-2):
 * - #1 mandate: `SignedUploadCompletion` reuses `BlobInfo` (Pick) — no duplicate shape
 * - #2 mandate: returns nominal `UploadEnvelope` brand type (not `unknown`) —
 *   expresses "opaque to callers, must not destructure" semantics correctly
 * - #3 mandate: `InvalidUploadBodyError.code` is fixed `"invalid_upload_body"`
 *   (snake_case, consistent with existing `put_failed` / `head_failed` codes)
 * - D3 推翻：no `failOnCompletionHookError` opt-in (YAGNI; current callers
 *   only `console.log`, never throw). Hook errors are swallowed + logged.
 *
 * Lifecycle change summary (P5.1.b-2):
 *
 *   ┌─────── browser ────────────┐                ┌─────── lib/storage ────────────┐
 *   │ POST {type:"generate-      │ ─── req ──▶    │ validate schema + clientPayload │
 *   │   signed-url",pathname,    │                │ + contentType allowlist;        │
 *   │   contentType,clientPayload│                │ derive finalKey;                │
 *   │ }                          │                │ generateSignedPostPolicy +      │
 *   │                            │ ◀── envelope ──│ signCompletionToken;            │
 *   │                            │ {url,fields,   │ return signed-upload-policy.    │
 *   │                            │  completionToken,finalKey}                       │
 *   │ POST multipart/form-data   │                │                                 │
 *   │   to GCS (using fields)    │ ── direct ──▶  │   GCS bucket (CORS: POST)       │
 *   │ POST {type:"completion",   │ ── ping ──▶    │ verifyCompletionToken +         │
 *   │   completionToken,blobInfo}│                │ urlToKey strict bucket+key match│
 *   │                            │                │ (per W3 nit #2 HIGH replacing   │
 *   │                            │ ◀── ack ───────│ .includes substring);           │
 *   │                            │                │ invoke onCompleted (D3 swallow).│
 *   └────────────────────────────┘                └─────────────────────────────────┘
 */

declare const _uploadEnvelopeBrand: unique symbol;

/**
 * Opaque envelope returned by `handleSignedUpload`. Route handlers MUST pass
 * it directly to `NextResponse.json()` — never destructure. Internal shape
 * is provider-specific: post-b-2 it's either a `signed-upload-policy` (url
 * + fields + completionToken + finalKey) or a `completion-ack` (success bool).
 * The brand type prevents callers from reading those fields at compile time.
 */
export type UploadEnvelope = { readonly [_uploadEnvelopeBrand]: never };

/**
 * Subset of `BlobInfo` passed to `onCompleted` hooks. Per W3 cd7f45a #1
 * mandate (reuse `BlobInfo` via Pick), preserved through b-2.
 */
export type SignedUploadCompletion = Pick<
  BlobInfo,
  "url" | "pathname" | "contentType" | "size"
>;

/** Policy fed to `handleSignedUpload`. Provider-neutral; readonly per project immutability rule. */
export interface UploadPolicy {
  /** Stable identifier for logs / future telemetry (e.g. `"upload"`, `"brief-upload"`). */
  readonly logTag: string;
  /** Allowed MIME types for the uploaded object. */
  readonly allowedContentTypes: readonly string[];
  /** Hard upper bound on object size, in bytes. */
  readonly maxBytes: number;
  /**
   * Whether the storage provider should append a random suffix to the key.
   * P5.1.b-2: server-side enforced via GCS POST policy condition
   * `["eq", "$key", finalKey]` — the browser cannot replace `$key` once the
   * policy is signed.
   */
  readonly addRandomSuffix?: boolean;
  /**
   * Zod schema validating the `clientPayload` field sent by the browser.
   * Current callers use `z.null()` as a guard — any string payload must
   * widen the schema explicitly and add downstream consumption.
   */
  readonly clientPayloadSchema: ZodType<unknown>;
  /**
   * Optional server-side hook fired when the browser completion ping arrives
   * with a verified token. Hook errors are always swallowed + logged
   * (W3 cd7f45a D3 推翻).
   *
   * `info.size` is reported when the browser includes it in `blobInfo`;
   * the GCS POST flow does NOT auto-fill it (no equivalent webhook). Callers
   * must treat `size` as optional.
   */
  readonly onCompleted?: (info: SignedUploadCompletion) => Promise<void>;
}

/**
 * Subclass for 4xx-shaped failures: invalid JSON body, schema rejection,
 * or clientPayload schema rejection. Routes catch this separately to
 * return 400 instead of the default 500 (`signed_upload_failed`).
 *
 * `code` is hardcoded to `"invalid_upload_body"` (snake_case, per W3 mandate #3).
 */
export class InvalidUploadBodyError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super("invalid_upload_body", message, cause);
    this.name = "InvalidUploadBodyError";
  }
}

/**
 * Throw `storage_not_configured` when `UPLOAD_SIGNING_SECRET` is missing.
 *
 * Per W3 verdict 78b7d2f ECC follow-up BLOCKER-7: the GCS swap depends on
 * `UPLOAD_SIGNING_SECRET` for HMAC completion tokens. Fail-fast at the lib
 * entry — mirroring `requireBucket()` in api.ts — defends the chain's
 * intermediate states (commit 1-3 merged, commit 4 route status mapping
 * pending) by surfacing a canonical StorageError code.
 */
function requireUploadSecret(): void {
  if (!process.env.UPLOAD_SIGNING_SECRET) {
    throw new StorageError(
      "storage_not_configured",
      "UPLOAD_SIGNING_SECRET is not set — completion token signing unavailable",
    );
  }
}

/**
 * Discriminated union of request shapes the browser sends to the upload
 * endpoint. The `type` discriminator routes inside `handleSignedUpload`.
 *
 * Per W3 verdict 78b7d2f §2.2: `generate-signed-url` mints a POST policy +
 * completion token; `completion` fires the policy.onCompleted hook after
 * the browser confirms upload success.
 */
const GenerateSignedUrlSchema = z.object({
  type: z.literal("generate-signed-url"),
  /**
   * Bucket-relative key the browser wants to upload to (sans random suffix).
   * MUST NOT contain `|` — that char is the reserved separator inside the
   * canonical completion-token payload (`finalKey|contentType|...`). A `|`
   * would split the payload into 6+ fields and break verifyCompletionToken's
   * `fields.length !== 5` guard, surfacing a misleading
   * `completion_token_invalid` instead of the correct `invalid_upload_body`.
   * Reject at the schema boundary so the failure is a clean 400. Per pre-push
   * typescript-reviewer HIGH finding 2026-05-16 (b-2 commit 2).
   */
  pathname: z.string().min(1).regex(/^[^|]+$/, "pathname must not contain '|'"),
  /**
   * Browser-declared MIME — server cross-checks against
   * `policy.allowedContentTypes`. `|` is rejected here for the same reason
   * as `pathname` (canonical-payload separator).
   */
  contentType: z
    .string()
    .min(1)
    .regex(/^[^|]+$/, "contentType must not contain '|'"),
  /** Forward-compatible escape hatch — validated by `policy.clientPayloadSchema`. */
  clientPayload: z.unknown(),
});

const BlobInfoFromBrowserSchema = z.object({
  url: z.string().min(1),
  pathname: z.string().min(1),
  contentType: z.string().optional(),
  size: z.number().optional(),
});

const CompletionSchema = z.object({
  type: z.literal("completion"),
  /** HMAC token minted by `signCompletionToken` in the gen-policy phase. */
  completionToken: z.string().min(1),
  /** Browser-reported upload result — server cross-checks url against token. */
  blobInfo: BlobInfoFromBrowserSchema,
});

const SignedUploadRequestSchema = z.discriminatedUnion("type", [
  GenerateSignedUrlSchema,
  CompletionSchema,
]);

/**
 * Handle a signed client-direct upload request.
 *
 * Lifecycle (per W3 verdict 78b7d2f):
 *  1. Entry early-check `UPLOAD_SIGNING_SECRET` (ECC BLOCKER-7).
 *  2. Parse + zod-validate body to discriminated union.
 *  3. If `type === "generate-signed-url"`:
 *     a. clientPayload via `policy.clientPayloadSchema`.
 *     b. contentType in `policy.allowedContentTypes`.
 *     c. `finalKey = pathname + "-" + uuid8()` if `addRandomSuffix`.
 *     d. `generateSignedPostPolicy` + `signCompletionToken` → return envelope.
 *  4. If `type === "completion"`:
 *     a. `verifyCompletionToken` (throws _invalid / _expired).
 *     b. `urlToKey(blobInfo.url, bucketName)` strict bucket prefix match
 *        (W3 nit #2 HIGH replacing `.includes()` substring check). Extracted
 *        key MUST equal `token.finalKey` or `completion_blob_mismatch`.
 *     c. Invoke `policy.onCompleted` (errors swallowed + logged per D3).
 *     d. Return completion-ack envelope.
 *
 * Caller responsibilities (NOT done here):
 *  - Rate limiting (route layer via `withRateLimit`).
 *  - HTTP status code mapping (route layer; per W3 nit #6 — commit 4
 *    will add `storage_not_configured → 503`, `completion_token_*` → 401,
 *    `completion_blob_mismatch` → 400, `invalid_upload_body` → 400).
 *
 * Errors:
 *  - `InvalidUploadBodyError` ("invalid_upload_body") for parse / schema / allowlist.
 *  - `StorageError` ("signed_upload_failed") for SDK policy gen failure.
 *  - `StorageError` ("completion_token_invalid" / "_expired") for token failure.
 *  - `StorageError` ("completion_blob_mismatch") for cross-bucket / wrong-key blobInfo.
 *  - `StorageError` ("storage_not_configured") for missing env (UPLOAD_SIGNING_SECRET
 *    via requireUploadSecret; GCS_BUCKET_NAME via getStorage().enabled check).
 */
export async function handleSignedUpload(
  req: NextRequest,
  policy: UploadPolicy,
): Promise<UploadEnvelope> {
  requireUploadSecret();

  let body: unknown;
  try {
    body = await req.json();
  } catch (e) {
    throw new InvalidUploadBodyError("upload body is not valid JSON", e);
  }

  const parsed = SignedUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new InvalidUploadBodyError(
      `upload body rejected by schema: ${parsed.error.message}`,
      parsed.error,
    );
  }

  if (parsed.data.type === "generate-signed-url") {
    return await handleGenerateSignedUrl(parsed.data, policy);
  }
  return await handleCompletion(parsed.data, policy);
}

async function handleGenerateSignedUrl(
  data: z.infer<typeof GenerateSignedUrlSchema>,
  policy: UploadPolicy,
): Promise<UploadEnvelope> {
  const cpResult = policy.clientPayloadSchema.safeParse(data.clientPayload);
  if (!cpResult.success) {
    throw new InvalidUploadBodyError(
      `clientPayload rejected by schema: ${cpResult.error.message}`,
      cpResult.error,
    );
  }

  if (!policy.allowedContentTypes.includes(data.contentType)) {
    throw new InvalidUploadBodyError(
      `contentType "${data.contentType}" not in allowlist for ${policy.logTag}`,
    );
  }

  const finalKey = policy.addRandomSuffix
    ? `${data.pathname}-${randomUUID().slice(0, 8)}`
    : data.pathname;

  try {
    const { url, fields } = await generateSignedPostPolicy(finalKey, {
      contentType: data.contentType,
      maxBytes: policy.maxBytes,
    });
    const completionToken = signCompletionToken({
      finalKey,
      contentType: data.contentType,
      maxBytes: policy.maxBytes,
    });
    // Inject bucket into fields (W3 ECC follow-up mandate: client reconstructs
    // blobInfo.url from envelope.fields[bucket] + finalKey). GCS SDK doesn't
    // include bucket in policy fields (bucket is encoded in the URL path); we
    // inject server-side so client validation + URL reconstruction works.
    // GCS silently ignores unknown form fields not constrained by policy
    // conditions, so this extra field is harmless on the multipart POST.
    return {
      type: "signed-upload-policy",
      url,
      fields: { ...fields, bucket: getStorage().bucketName },
      completionToken,
      finalKey,
    } as unknown as UploadEnvelope;
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError(
      "signed_upload_failed",
      `storage.handleSignedUpload(${policy.logTag}) generate failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      e,
    );
  }
}

async function handleCompletion(
  data: z.infer<typeof CompletionSchema>,
  policy: UploadPolicy,
): Promise<UploadEnvelope> {
  // Throws completion_token_invalid / completion_token_expired /
  // storage_not_configured (the last only if UPLOAD_SIGNING_SECRET disappeared
  // between entry early-check and here, which shouldn't happen in a single
  // request — defensive).
  const tokenPayload = verifyCompletionToken(data.completionToken);

  // W3 nit #2 HIGH (78b7d2f): strict bucket+key match via urlToKey,
  // NOT `.includes()` substring (attacker could craft url containing
  // finalKey in a query param while pointing to evil.com).
  const client = getStorage();
  if (!client.enabled || !client.bucketName) {
    throw new StorageError(
      "storage_not_configured",
      "GCS_BUCKET_NAME is not set — completion verify unavailable",
    );
  }

  let extractedKey: string;
  try {
    extractedKey = urlToKey(data.blobInfo.url, client.bucketName);
  } catch (e) {
    // urlToKey throws `url_not_in_bucket` for cross-bucket / non-GCS URLs.
    // Surface as `completion_blob_mismatch` so the route layer maps to 400.
    throw new StorageError(
      "completion_blob_mismatch",
      `blobInfo.url does not belong to bucket ${client.bucketName}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      e,
    );
  }
  if (extractedKey !== tokenPayload.finalKey) {
    throw new StorageError(
      "completion_blob_mismatch",
      `blobInfo.url key "${extractedKey}" does not match token finalKey "${tokenPayload.finalKey}"`,
    );
  }

  // Forward-compat: `tokenPayload.nonce` is intentionally NOT consumed here.
  // Future DB-write callers can extend `policy.onCompleted` to accept the
  // nonce as idempotency key without a token-protocol upgrade (ECC MED-1/2
  // 4-fold defense of anti-pattern #13).

  if (policy.onCompleted) {
    try {
      await policy.onCompleted({
        url: data.blobInfo.url,
        pathname: data.blobInfo.pathname,
        contentType: data.blobInfo.contentType,
        size: data.blobInfo.size,
      });
    } catch (hookError) {
      console.error(
        `[${policy.logTag}] onCompleted hook failed:`,
        hookError,
      );
    }
  }

  return { type: "completion-ack", success: true } as unknown as UploadEnvelope;
}
