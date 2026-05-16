import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";

import { getStorage } from "./client";
import {
  type BlobInfo,
  type DownloadUrlOptions,
  type ListOptions,
  type ListResult,
  type PutOptions,
  type PutResult,
  StorageError,
} from "./types";

/**
 * Platform-neutral storage API — fully on `@google-cloud/storage` after
 * P5.1.b-1 commit 3. caller behavior unchanged from P5.1.a baseline.
 *
 * Per W3 verdict c9367c4 (all decisions frozen):
 * - A1: lazy Storage singleton via lib/storage/client.ts
 * - B1: getDownloadUrl uses SDK getSignedUrl v4 + ADC/WIF (no SA key)
 * - C1: head returns null on 404; all other ops throw StorageError
 * - D3: del/getDownloadUrl accept URLs via urlToKey() strict bucket prefix
 *   match; cross-bucket URLs throw url_not_in_bucket
 * - E (12b3b18 I): addRandomSuffix = crypto.randomUUID().slice(0, 8) hex
 * - H: keys pass through 1:1, no prefix rewriting
 *
 * StorageError codes after commit 3:
 *   storage_not_configured / head_failed / put_failed / list_failed
 *   / del_failed / download_url_failed / url_not_in_bucket
 *
 * P5.1.b-2 commit 1 adds (per W3 deep verdict 78b7d2f + ECC follow-up):
 *   signed_upload_failed / completion_token_invalid / completion_token_expired
 *
 * — three new helpers (generateSignedPostPolicy / signCompletionToken /
 *   verifyCompletionToken) prepare the GCS swap of signed-upload.ts (commit 2).
 *   `urlToKey` is also exported here so commit 2 can use it for the
 *   `completion_blob_mismatch` strict URL parse (W3 nit #2 HIGH fix).
 */

/**
 * Body types accepted by `put`. Matches the set @google-cloud/storage's
 * `file.save()` accepts (string | Buffer | Readable). Wider types
 * (Blob / ArrayBuffer / ReadableStream / File) are preserved at the facade
 * boundary for caller compatibility and converted as needed inside `put`.
 */
type PutBody = string | Readable | Buffer | Blob | ArrayBuffer | ReadableStream | File;

/** Build a public GCS URL for a bucket-key pair. */
function publicUrl(bucketName: string, key: string): string {
  return `https://storage.googleapis.com/${bucketName}/${encodeURI(key)}`;
}

/**
 * Reverse-map a GCS public URL (or bare key) to a bucket-relative key.
 *
 * Per W3 verdict c9367c4 D3: strictly prefix-match the configured bucket
 * name to prevent cross-bucket accidental deletes / reads. Two GCS public
 * URL formats are supported:
 *   A) https://storage.googleapis.com/<bucket>/<key>     (path-style)
 *   B) https://<bucket>.storage.googleapis.com/<key>     (vhost-style)
 *
 * A bare key (no scheme) passes through unchanged. Any URL whose host or
 * path does NOT match `bucketName` throws `StorageError("url_not_in_bucket")`.
 *
 * Exported in P5.1.b-2 commit 1 so signed-upload.ts (commit 2) can use it
 * for the `completion_blob_mismatch` strict URL parse — per W3 verdict
 * 78b7d2f nit #2 HIGH fix replacing `.includes()` substring check.
 */
export function urlToKey(urlOrKey: string, bucketName: string): string {
  if (!urlOrKey.startsWith("http://") && !urlOrKey.startsWith("https://")) {
    return urlOrKey;
  }
  const u = new URL(urlOrKey);
  const pathPrefix = `/${bucketName}/`;
  if (u.host === "storage.googleapis.com" && u.pathname.startsWith(pathPrefix)) {
    return decodeURI(u.pathname.slice(pathPrefix.length));
  }
  if (u.host === `${bucketName}.storage.googleapis.com`) {
    return decodeURI(u.pathname.slice(1));
  }
  throw new StorageError(
    "url_not_in_bucket",
    `storage url ${u.host}${u.pathname} does not belong to bucket ${bucketName}`,
  );
}

/** Throw if storage is not configured (GCS_BUCKET_NAME missing). */
function requireBucket(): {
  bucket: NonNullable<ReturnType<typeof getStorage>["bucket"]>;
  bucketName: string;
} {
  const client = getStorage();
  if (!client.enabled || !client.bucket) {
    throw new StorageError(
      "storage_not_configured",
      "GCS_BUCKET_NAME is not set — storage operations unavailable",
    );
  }
  return { bucket: client.bucket, bucketName: client.bucketName };
}

/**
 * Read object metadata. Returns null on 404 / missing object; throws
 * `StorageError` for any other failure (network, auth, etc).
 */
export async function head(key: string): Promise<BlobInfo | null> {
  const { bucket, bucketName } = requireBucket();
  try {
    const [meta] = await bucket.file(key).getMetadata();
    return {
      url: publicUrl(bucketName, key),
      pathname: key,
      contentType: typeof meta.contentType === "string" ? meta.contentType : undefined,
      size: meta.size !== undefined ? Number(meta.size) : undefined,
      uploadedAt: typeof meta.updated === "string" ? new Date(meta.updated) : undefined,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw new StorageError(
      "head_failed",
      `storage.head(${key}) failed: ${errorMessage(err)}`,
      err,
    );
  }
}

/**
 * Write an object. `opts.access` must be `"public"` — private storage is
 * out of scope for P5.1 (all current callers write public JSON/zip).
 *
 * `addRandomSuffix` (W3 verdict 12b3b18 I): appends 8 hex chars from
 * `crypto.randomUUID()`. Bucket-level UBLA (W3 verdict 12b3b18 D) handles
 * read access via bucket IAM — the SDK `public:true` save option would
 * trigger a legacy object-ACL call that fails 403 on UBLA buckets
 * ("Cannot get legacy ACL for a bucket that has uniform bucket-level
 * access"), so it is intentionally NOT set here.
 */
export async function put(
  key: string,
  body: PutBody,
  opts: PutOptions,
): Promise<PutResult> {
  const { bucket, bucketName } = requireBucket();
  const finalKey = opts.addRandomSuffix ? `${key}-${randomUUID().slice(0, 8)}` : key;
  try {
    // PutBody is a superset of the SDK's SaveData (string | Buffer |
    // Readable). Wider Web types (Blob / ArrayBuffer / ReadableStream /
    // File) are declared at the facade boundary for future-proofing but no
    // current caller passes them — narrowing/conversion lands in commit 3
    // when getDownloadUrl / del also swap and PutBody is reviewed end-to-end.
    await bucket.file(finalKey).save(body as Buffer | string, {
      contentType: opts.contentType,
      resumable: false,
      metadata:
        opts.cacheControlMaxAge !== undefined
          ? { cacheControl: `public, max-age=${opts.cacheControlMaxAge}` }
          : undefined,
      // allowOverwrite:false → fail if object already exists (GCS preconditions)
      ...(opts.allowOverwrite === false
        ? { preconditionOpts: { ifGenerationMatch: 0 } }
        : {}),
    });
    return {
      url: publicUrl(bucketName, finalKey),
      pathname: finalKey,
      contentType: opts.contentType,
      contentDisposition: undefined,
    };
  } catch (err) {
    throw new StorageError(
      "put_failed",
      `storage.put(${finalKey}) failed: ${errorMessage(err)}`,
      err,
    );
  }
}

/**
 * List objects under a prefix. `autoPaginate: false` is required for the
 * SDK to surface the `nextQuery` cursor — without it, `getFiles` swallows
 * pagination and returns every page concatenated.
 */
export async function list(opts: ListOptions = {}): Promise<ListResult> {
  const { bucket, bucketName } = requireBucket();
  try {
    // GCS `bucket.getFiles` returns [File[], nextQuery | null, ApiResponse]
    // — only the first two tuple elements are needed.
    const [files, nextQuery] = await bucket.getFiles({
      prefix: opts.prefix,
      maxResults: opts.limit,
      pageToken: opts.cursor,
      autoPaginate: false,
    });
    return {
      blobs: files.map((f) => ({
        url: publicUrl(bucketName, f.name),
        pathname: f.name,
        size: f.metadata.size !== undefined ? Number(f.metadata.size) : undefined,
        uploadedAt:
          typeof f.metadata.updated === "string"
            ? new Date(f.metadata.updated)
            : undefined,
      })),
      cursor: readPageToken(nextQuery),
      // GCS `getFiles` returns `{}` (NOT null) for nextQuery on the final
      // page — so we cannot rely on truthiness/null-check to derive hasMore.
      // The presence of a `pageToken` is the canonical "more pages" signal.
      hasMore: readPageToken(nextQuery) !== undefined,
    };
  } catch (err) {
    throw new StorageError(
      "list_failed",
      `storage.list(prefix=${opts.prefix ?? "<none>"}) failed: ${errorMessage(err)}`,
      err,
    );
  }
}

/**
 * Delete one or more objects. Accepts either bucket keys or full GCS public
 * URLs; URLs are reverse-mapped to keys via `urlToKey()` per W3 verdict
 * c9367c4 D3 (strict bucket-name prefix match — cross-bucket URLs throw
 * `url_not_in_bucket` to prevent accidental deletes across buckets).
 *
 * `ignoreNotFound: true` so deleting an already-missing key is a no-op
 * (matches @vercel/blob's silent-on-404 del semantics).
 */
export async function del(urls: string | string[]): Promise<void> {
  const { bucket, bucketName } = requireBucket();
  // Renamed from `list` to avoid shadowing the module-level `list` export.
  const targets = Array.isArray(urls) ? urls : [urls];
  try {
    const keys = targets.map((u) => urlToKey(u, bucketName));
    await Promise.all(keys.map((k) => bucket.file(k).delete({ ignoreNotFound: true })));
  } catch (err) {
    if (err instanceof StorageError) throw err; // re-throw url_not_in_bucket
    throw new StorageError(
      "del_failed",
      `storage.del(${targets.length} url${targets.length === 1 ? "" : "s"}) failed: ${errorMessage(err)}`,
      err,
    );
  }
}

/**
 * Resolve a download URL for an object.
 *
 * Per W3 verdict 12b3b18 C: returns a GCS v4 signed URL with
 * `responseDisposition=attachment`, default TTL 15 min (overridable via
 * `opts.ttlSeconds`). Accepts bare keys OR full GCS URLs (via `urlToKey()`).
 */
export async function getDownloadUrl(
  urlOrKey: string,
  opts: DownloadUrlOptions = {},
): Promise<string> {
  const { bucket, bucketName } = requireBucket();
  // urlToKey() is intentionally called OUTSIDE the try block below so that
  // url_not_in_bucket throws cleanly to the caller instead of being wrapped
  // as download_url_failed. Do not move inside the try.
  const key = urlToKey(urlOrKey, bucketName);
  const ttlSeconds = opts.ttlSeconds ?? 900; // W3 verdict 12b3b18 C
  const responseDisposition = opts.filename
    ? `attachment; filename="${opts.filename}"`
    : "attachment";
  try {
    const [signedUrl] = await bucket.file(key).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + ttlSeconds * 1000,
      responseDisposition,
    });
    return signedUrl;
  } catch (err) {
    throw new StorageError(
      "download_url_failed",
      `storage.getDownloadUrl(${key}) failed: ${errorMessage(err)}`,
      err,
    );
  }
}

/**
 * GCS 404 detection.
 *
 * Per W3 verdict c9367c4 nit C: removed legacy `err.name === "BlobNotFoundError"`
 * branch — after b-1 commit 2, api.ts head/put/list no longer routes through
 * @vercel/blob, so the BlobNotFoundError name check is dead code.
 * GCS SDK canonical errors: `ApiError` carries `code: number` and the
 * underlying message is "No such object: <bucket>/<key>".
 */
function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: number; status?: number; message?: string };
  if (e.code === 404 || e.status === 404) return true;
  const msg = (e.message ?? "").toLowerCase();
  return msg.includes("no such object");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Defensive extraction of `pageToken` from the GCS getFiles nextQuery tuple. */
function readPageToken(nextQuery: unknown): string | undefined {
  if (!nextQuery || typeof nextQuery !== "object") return undefined;
  const t = (nextQuery as { pageToken?: unknown }).pageToken;
  return typeof t === "string" ? t : undefined;
}

// ---------------------------------------------------------------------------
// P5.1.b-2 commit 1: GCS v4 signed POST policy + HMAC-signed completion token
// ---------------------------------------------------------------------------

/** Default 60-minute TTL for signed POST policies (W3 12b3b18 C write TTL). */
const SIGNED_POST_DEFAULT_TTL_MS = 60 * 60 * 1000;

/** Default 60-minute TTL for completion tokens — matches signed POST TTL. */
const COMPLETION_TOKEN_DEFAULT_TTL_MS = 60 * 60 * 1000;

/** Browser-facing result of a v4 signed POST policy generation. */
export interface SignedPostPolicy {
  /** Endpoint the browser POSTs the multipart form to (host always GCS). */
  url: string;
  /** Form fields the browser MUST include verbatim in the multipart POST. */
  fields: Record<string, string>;
}

export interface SignedPostPolicyOptions {
  contentType: string;
  maxBytes: number;
  /** Override the default 60-minute policy TTL. */
  expiresMs?: number;
}

/**
 * Completion token payload — fields cross-checked at `verifyCompletionToken`
 * against the browser-supplied `blobInfo` in signed-upload.ts commit 2.
 *
 * `nonce` is generated server-side and round-trips through the token; it is
 * NOT consumed by the current console.log-only `onCompleted` callers, but is
 * exposed in `verifyCompletionToken`'s return so future DB-write callers can
 * use it as an idempotency key without a token-protocol upgrade (per ECC
 * MED-1/2 follow-up 78b7d2f — forward-compat 4-th defense of anti-pattern #13).
 */
export interface CompletionTokenPayload {
  finalKey: string;
  contentType: string;
  maxBytes: number;
  expiresAt: number;
  nonce: string;
}

/**
 * Canonical pipe-concat serialization of the completion token payload.
 *
 * Per W3 verdict 78b7d2f BLOCKER nit #1: `JSON.stringify` key order is V8
 * insertion-order-stable but NOT ECMAScript-guaranteed. A future Node major
 * bump or runtime swap (Bun, Cloudflare Workers) could re-order keys,
 * silently invalidating in-flight tokens across deployments. Explicit
 * pipe-concat removes the ambiguity and the JSON-escape edge cases for
 * contentType containing special characters.
 *
 * Field separator (`|`) is reserved — any field carrying `|` must be
 * rejected upstream. `finalKey` and `contentType` come from the browser
 * request schema in signed-upload.ts and are explicitly regex-rejected
 * at the schema boundary (`/^[^|]+$/`) before reaching this function —
 * see `GenerateSignedUrlSchema` (pre-push reviewer HIGH 2026-05-16). The
 * other three fields are typed (number / uuid hex). `maxBytes` is a
 * Number serialized via template literal — no `|` possible.
 */
function canonicalCompletionPayload(p: CompletionTokenPayload): string {
  return `${p.finalKey}|${p.contentType}|${p.maxBytes}|${p.expiresAt}|${p.nonce}`;
}

/** Throw if UPLOAD_SIGNING_SECRET is missing — fail-fast mirroring requireBucket. */
function requireUploadSecret(): string {
  const secret = process.env.UPLOAD_SIGNING_SECRET;
  if (!secret) {
    throw new StorageError(
      "storage_not_configured",
      "UPLOAD_SIGNING_SECRET is not set — completion token signing unavailable",
    );
  }
  return secret;
}

/**
 * Generate a v4 signed POST policy for browser direct upload to GCS.
 *
 * Per W3 verdict 78b7d2f A1: POST policy is mandatory over PUT signed URL
 * because GCS conditions enable server-side enforcement of:
 *   - `["content-length-range", 0, maxBytes]` — caps abuse (e.g. 10GB upload)
 *   - `["eq", "$Content-Type", contentType]` — locks MIME to the allowlist entry
 *   - `["eq", "$key", key]` — server-side `addRandomSuffix` enforcement
 *     (browser cannot replace `$key` once policy is signed)
 *
 * SDK quirk (per b-1 H1 lessons + ECC MED-3 mandate): the SDK resolves
 * `generateSignedPostPolicyV4` to a 1-element tuple `[PolicyResponse]`. The
 * facade unwraps via `[0]` destructure — DO NOT simplify to `await ...`
 * without tuple destructure; mocks must preserve this shape.
 */
export async function generateSignedPostPolicy(
  key: string,
  opts: SignedPostPolicyOptions,
): Promise<SignedPostPolicy> {
  const { bucket } = requireBucket();
  const expires = Date.now() + (opts.expiresMs ?? SIGNED_POST_DEFAULT_TTL_MS);
  try {
    const [policy] = await bucket.file(key).generateSignedPostPolicyV4({
      expires,
      conditions: [
        ["content-length-range", 0, opts.maxBytes],
        ["eq", "$Content-Type", opts.contentType],
        ["eq", "$key", key],
      ],
    });
    return { url: policy.url, fields: policy.fields };
  } catch (err) {
    throw new StorageError(
      "signed_upload_failed",
      `storage.generateSignedPostPolicy(${key}) failed: ${errorMessage(err)}`,
      err,
    );
  }
}

/**
 * Mint an HMAC-SHA256-signed completion token.
 *
 * Token format: `<base64url(canonicalPayload)>.<hex(hmac)>`. Stateless —
 * no server-side storage needed (per W3 verdict 78b7d2f C1). The caller
 * provides `{finalKey, contentType, maxBytes}`; this helper adds
 * `expiresAt = now + ttlMs` and a fresh `nonce`.
 */
export function signCompletionToken(
  payload: Pick<CompletionTokenPayload, "finalKey" | "contentType" | "maxBytes">,
  ttlMs: number = COMPLETION_TOKEN_DEFAULT_TTL_MS,
): string {
  const secret = requireUploadSecret();
  const fullPayload: CompletionTokenPayload = {
    ...payload,
    expiresAt: Date.now() + ttlMs,
    nonce: randomUUID(),
  };
  const canonical = canonicalCompletionPayload(fullPayload);
  const hmac = createHmac("sha256", secret).update(canonical).digest("hex");
  const payloadEncoded = Buffer.from(canonical, "utf8").toString("base64url");
  return `${payloadEncoded}.${hmac}`;
}

/**
 * Verify a completion token and return its decoded payload.
 *
 * Throws:
 *   - `completion_token_invalid` — malformed token / bad base64 / HMAC
 *     mismatch (tampered or wrong secret) / wrong field count / non-numeric
 *     maxBytes/expiresAt.
 *   - `completion_token_expired` — `expiresAt < now`.
 *   - `storage_not_configured` — `UPLOAD_SIGNING_SECRET` missing.
 *
 * Uses `timingSafeEqual` to prevent HMAC-oracle timing attacks.
 *
 * The returned `nonce` is currently unused by callers but exposed for
 * future DB-write callers needing an idempotency key (ECC MED-1/2 forward-
 * compat: adding consumer logic later does NOT break in-flight tokens).
 */
export function verifyCompletionToken(token: string): CompletionTokenPayload {
  const secret = requireUploadSecret();
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new StorageError(
      "completion_token_invalid",
      "completion token must be <payload>.<hmac>",
    );
  }
  const [payloadEncoded, hmacGiven] = parts;
  const canonical = Buffer.from(payloadEncoded, "base64url").toString("utf8");
  const hmacExpected = createHmac("sha256", secret).update(canonical).digest("hex");
  // Hex pre-validate: `Buffer.from(<non-hex>, "hex")` silently strips
  // invalid chars and yields a short buffer, which then makes
  // `timingSafeEqual` throw RangeError (mismatched byte lengths) instead of
  // returning false — the token would still be correctly rejected, but the
  // caller would receive an uncaught TypeError outside the StorageError
  // wrapping contract. Per pre-push typescript-reviewer MED finding 2026-05-16.
  if (
    hmacGiven.length !== hmacExpected.length ||
    !/^[0-9a-f]+$/i.test(hmacGiven) ||
    !timingSafeEqual(Buffer.from(hmacGiven, "hex"), Buffer.from(hmacExpected, "hex"))
  ) {
    throw new StorageError(
      "completion_token_invalid",
      "completion token HMAC mismatch (tampered or wrong secret)",
    );
  }
  const fields = canonical.split("|");
  if (fields.length !== 5) {
    throw new StorageError(
      "completion_token_invalid",
      `completion token payload has ${fields.length} fields, expected 5`,
    );
  }
  const [finalKey, contentType, maxBytesStr, expiresAtStr, nonce] = fields;
  const maxBytes = Number(maxBytesStr);
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(maxBytes) || !Number.isFinite(expiresAt)) {
    throw new StorageError(
      "completion_token_invalid",
      "completion token has non-numeric maxBytes / expiresAt",
    );
  }
  if (Date.now() > expiresAt) {
    throw new StorageError(
      "completion_token_expired",
      `completion token expired at ${new Date(expiresAt).toISOString()}`,
    );
  }
  return { finalKey, contentType, maxBytes, expiresAt, nonce };
}
