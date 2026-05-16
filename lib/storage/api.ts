import "server-only";

import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

// commit 3 will remove this last @vercel/blob import (del + getDownloadUrl
// still route through vercel until then). Whitelisted in
// scripts/check-storage-imports.ts until b-4 removes the dep entirely.
import { del as vercelDel } from "@vercel/blob";

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
 * Platform-neutral storage API.
 *
 * P5.1.b-1 commit 2: head / put / list now route through
 * `@google-cloud/storage` per W3 verdict c9367c4 (A1 / B1 / C1 / E / F1
 * frozen). del + getDownloadUrl preserved at @vercel/blob until commit 3.
 *
 * Per W3 verdict 12b3b18:
 * - B1: `head` returns null on missing object; all other ops throw.
 * - H: keys pass through unchanged (no prefix rewriting).
 * - I: `addRandomSuffix` uses `crypto.randomUUID().slice(0, 8)` hex
 *   (8 chars, equivalent to @vercel/blob's 6-8 base32 suffix length).
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
    const url = publicUrl(bucketName, finalKey);
    return {
      url,
      downloadUrl: `${url}?download=1`,
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
 * Delete one or more objects. Accepts URLs (Vercel Blob convention).
 *
 * **commit 3** will swap to GCS via `urlToKey()` reverse mapping +
 * `bucket.file(key).delete()`. Preserved at @vercel/blob here so the
 * commit-2 transient state stays caller-compatible.
 */
export async function del(urls: string | string[]): Promise<void> {
  try {
    await vercelDel(urls);
  } catch (err) {
    const count = Array.isArray(urls) ? urls.length : 1;
    throw new StorageError(
      "del_failed",
      `storage.del(${count} url${count === 1 ? "" : "s"}) failed: ${errorMessage(err)}`,
      err,
    );
  }
}

/**
 * Resolve a download URL for an object.
 *
 * **commit 3** will swap to GCS v4 signed URL with
 * `responseDisposition=attachment` + 15 min TTL (per W3 verdict 12b3b18 C).
 * Preserved as a-1 pass-through here for commit-2 transient state.
 */
export async function getDownloadUrl(
  urlOrKey: string,
  opts: DownloadUrlOptions = {},
): Promise<string> {
  void opts;
  if (urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://")) {
    const u = new URL(urlOrKey);
    u.searchParams.set("download", "1");
    return u.toString();
  }
  throw new StorageError(
    "download_url_requires_full_url",
    `storage.getDownloadUrl requires a full URL in P5.1.a (got bare key: ${urlOrKey})`,
  );
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
