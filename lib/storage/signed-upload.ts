import "server-only";

import type { NextRequest } from "next/server";
import type { ZodType } from "zod";

import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";

import { type BlobInfo, StorageError } from "./types";

/**
 * Throw `storage_not_configured` when `UPLOAD_SIGNING_SECRET` is missing.
 *
 * Per W3 verdict 78b7d2f ECC follow-up BLOCKER-7: the GCS swap (commit 2)
 * makes signed-upload.ts depend on `UPLOAD_SIGNING_SECRET` for HMAC
 * completion tokens. Fail-fast at the lib entry — mirroring
 * `requireBucket()` in api.ts — defends the chain's intermediate state:
 * if commit 1-3 are merged but commit 4 (route 503 mapping) is not,
 * an unset secret still surfaces a canonical StorageError code that the
 * route's outer catch can recognize, rather than a generic 500.
 *
 * Activated NOW in commit 1 (anticipatory): the current Vercel handleUpload
 * lifecycle does not consume the secret, so this check only impacts
 * deployments that have NOT yet bootstrapped `UPLOAD_SIGNING_SECRET` (W2
 * P5.2.4.2 Secret Manager line). Production / preview deploys MUST set
 * the env var before merging commit 1; local dev sets it in `.env.local`.
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
 * Server-side helper for client-direct uploads.
 *
 * Wraps `@vercel/blob/client.handleUpload` behind a provider-neutral policy
 * interface so 2 upload routes (`/api/upload`, `/api/template-brief-upload`)
 * don't import `@vercel/blob/client` directly.
 *
 * Per W3 P5.1.a-4 plan deep verdict cd7f45a (typescript-reviewer review):
 * - #1 mandate: `SignedUploadCompletion` reuses `BlobInfo` (Pick) — no duplicate shape
 * - #2 mandate: returns nominal `UploadEnvelope` brand type (not `unknown`) —
 *   expresses "opaque to callers, must not destructure" semantics correctly
 * - #3 mandate: `InvalidUploadBodyError.code` is fixed `"invalid_upload_body"`
 *   (snake_case, consistent with existing `put_failed` / `head_failed` codes)
 * - D3 推翻：no `failOnCompletionHookError` opt-in (YAGNI; current callers
 *   only `console.log`, never throw). Hook errors are swallowed + logged,
 *   matching default `@vercel/blob` behavior (webhook failures shouldn't 502 the client).
 *
 * P5.1.b will swap `@vercel/blob/client` internals here for GCS v4 signed
 * POST URL flow with a client-side completion ping (no equivalent webhook
 * in GCS), keeping `UploadPolicy` / `handleSignedUpload` shape stable.
 *
 * Version pin caveat (per typescript-reviewer 2026-05-15 a-4 commit 1 MED #1):
 * The "InvalidUploadBodyError propagates through onBeforeGenerateToken
 * without re-wrapping" guarantee relies on `@vercel/blob`'s current
 * implementation NOT catching callback errors. Do not minor-bump `@vercel/blob`
 * before P5.1.b without re-running tests AND skim-verifying that
 * `handleUpload`'s `onBeforeGenerateToken` branch still propagates errors raw.
 */

declare const _uploadEnvelopeBrand: unique symbol;

/**
 * Opaque envelope returned by `handleSignedUpload`. Route handlers MUST pass
 * it directly to `NextResponse.json()` — never destructure. Internal shape
 * is provider-specific (today: `@vercel/blob/client` token JSON; b 阶段: a
 * GCS-shaped envelope routed through the same handler).
 */
export type UploadEnvelope = { readonly [_uploadEnvelopeBrand]: never };

/**
 * Subset of `BlobInfo` passed to `onCompleted` hooks. `uploadedAt` is
 * intentionally omitted — Vercel's `onUploadCompleted` callback receives
 * a `blob` without this field, and GCS swap (P5.1.b) won't synthesize it.
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
   * P5.1.a: forwarded to `@vercel/blob`'s `addRandomSuffix`.
   * P5.1.b: facade emulates by appending `crypto.randomUUID().slice(0, 8)`.
   */
  readonly addRandomSuffix?: boolean;
  /**
   * Zod schema validating the `clientPayload` field sent by the browser.
   * Current callers use `z.null()` as a guard — any string payload must
   * widen the schema explicitly and add downstream consumption.
   */
  readonly clientPayloadSchema: ZodType<unknown>;
  /**
   * Optional server-side hook fired when an upload completes.
   * P5.1.a: invoked by `@vercel/blob`'s `onUploadCompleted` webhook.
   * P5.1.b: triggered by facade after the client-side completion ping.
   *
   * Per W3 D3 推翻 (cd7f45a): hook errors are always swallowed + logged.
   * Don't add business logic that needs at-least-once semantics here without
   * extending the policy interface first (breaking-change is acceptable;
   * silently dropping a DB write is not).
   *
   * `info.size` semantics (per typescript-reviewer 2026-05-15 a-4 commit 1 MED #2):
   * - P5.1.a: ALWAYS undefined — Vercel's `PutBlobResult` lacks `size`.
   * - P5.1.b (planned): populated from GCS object metadata when available.
   * Callers MUST treat `size` as optional regardless of provider.
   */
  readonly onCompleted?: (info: SignedUploadCompletion) => Promise<void>;
}

/**
 * Subclass for 4xx-shaped failures: invalid JSON body, or `clientPayload`
 * rejected by `policy.clientPayloadSchema`. Routes catch this separately to
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
 * Handle a signed client-direct upload request.
 *
 * Lifecycle:
 *  1. Parse `req.json()` as `HandleUploadBody`; failure → `InvalidUploadBodyError`.
 *  2. Validate `clientPayload` against `policy.clientPayloadSchema`;
 *     rejection → `InvalidUploadBodyError`.
 *  3. Forward `allowedContentTypes` / `maximumSizeInBytes` / `addRandomSuffix`
 *     to `@vercel/blob`'s token generator.
 *  4. On completion, invoke `policy.onCompleted` if provided. Hook errors are
 *     swallowed + `console.error`-logged (does NOT fail the upload).
 *
 * Caller responsibilities (NOT done here):
 *  - Rate limiting (route layer via `withRateLimit`).
 *  - `BLOB_READ_WRITE_TOKEN` env presence check (route layer; 503 on miss).
 *
 * Errors:
 *  - `InvalidUploadBodyError` ("invalid_upload_body") for parse / schema failures.
 *  - `StorageError` ("signed_upload_failed") for token generation / webhook errors.
 */
export async function handleSignedUpload(
  req: NextRequest,
  policy: UploadPolicy,
): Promise<UploadEnvelope> {
  // BLOCKER-7 (W3 verdict 78b7d2f ECC follow-up): early-check
  // UPLOAD_SIGNING_SECRET so an unset env surfaces canonical
  // storage_not_configured even before commit 2 wires the helpers in.
  requireUploadSecret();
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch (e) {
    throw new InvalidUploadBodyError("upload body is not valid JSON", e);
  }

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const parsed = policy.clientPayloadSchema.safeParse(clientPayload);
        if (!parsed.success) {
          throw new InvalidUploadBodyError(
            `clientPayload rejected by schema: ${parsed.error.message}`,
            parsed.error,
          );
        }
        return {
          allowedContentTypes: [...policy.allowedContentTypes],
          maximumSizeInBytes: policy.maxBytes,
          addRandomSuffix: policy.addRandomSuffix,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        if (!policy.onCompleted) return;
        try {
          // `size` is intentionally omitted: Vercel's `PutBlobResult` (the
          // `blob` type on onUploadCompleted) doesn't include it. GCS's
          // object metadata callback in P5.1.b will populate `size` when
          // available — current callers must treat it as optional.
          await policy.onCompleted({
            url: blob.url,
            pathname: blob.pathname,
            contentType: blob.contentType,
          });
        } catch (hookError) {
          console.error(
            `[${policy.logTag}] onCompleted hook failed:`,
            hookError,
          );
        }
      },
    });
    // Brand cast: route handlers must pass envelope to NextResponse.json()
    // opaquely (see UploadEnvelope docstring).
    return json as unknown as UploadEnvelope;
  } catch (e) {
    if (e instanceof StorageError) throw e;
    throw new StorageError(
      "signed_upload_failed",
      `storage.handleSignedUpload(${policy.logTag}) failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      e,
    );
  }
}
