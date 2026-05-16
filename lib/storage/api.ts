import "server-only";

import type { Readable } from "node:stream";

import {
  del as vercelDel,
  head as vercelHead,
  list as vercelList,
  put as vercelPut,
} from "@vercel/blob";

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
 * Platform-neutral storage API — thin wrapper around `@vercel/blob` in P5.1.a.
 *
 * Per W3 verdict 12b3b18:
 * - B1: `head` returns null on missing object; all other ops throw `StorageError`.
 * - H: keys pass through unchanged (no prefix rewriting).
 * - I: `addRandomSuffix` semantics preserved 1:1 with `@vercel/blob`.
 *
 * P5.1.b will swap the `@vercel/blob` imports above for `@google-cloud/storage`
 * with zero caller-facing change (contract baseline frozen in a-2).
 */

/**
 * Body types accepted by `put`. Mirrors `@vercel/blob`'s PutBody exactly
 * (intentionally narrow: no `Uint8Array` — callers should wrap with
 * `Buffer.from(uint8)` or `new Blob([uint8])`). GCS adapter in P5.1.b
 * supports the same set via `bucket.file(key).save(body)`.
 */
type PutBody = string | Readable | Buffer | Blob | ArrayBuffer | ReadableStream | File;

/**
 * Read object metadata. Returns null on 404 / missing object; throws
 * `StorageError` for any other failure (network, auth, etc).
 */
export async function head(key: string): Promise<BlobInfo | null> {
  try {
    const meta = await vercelHead(key);
    return {
      url: meta.url,
      pathname: meta.pathname,
      contentType: meta.contentType,
      size: meta.size,
      uploadedAt: meta.uploadedAt,
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
 */
export async function put(
  key: string,
  body: PutBody,
  opts: PutOptions,
): Promise<PutResult> {
  try {
    const result = await vercelPut(key, body, {
      access: opts.access,
      contentType: opts.contentType,
      addRandomSuffix: opts.addRandomSuffix,
      allowOverwrite: opts.allowOverwrite,
      cacheControlMaxAge: opts.cacheControlMaxAge,
    });
    return {
      url: result.url,
      downloadUrl: result.downloadUrl,
      pathname: result.pathname,
      contentType: result.contentType,
      contentDisposition: result.contentDisposition,
    };
  } catch (err) {
    throw new StorageError(
      "put_failed",
      `storage.put(${key}) failed: ${errorMessage(err)}`,
      err,
    );
  }
}

/**
 * List objects under a prefix. Always paginated — caller should pass a
 * sensible `limit`. Default Vercel Blob limit is 1000.
 */
export async function list(opts: ListOptions = {}): Promise<ListResult> {
  try {
    const result = await vercelList({
      prefix: opts.prefix,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return {
      blobs: result.blobs.map((b) => ({
        url: b.url,
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt,
      })),
      cursor: result.cursor,
      hasMore: result.hasMore,
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
 * Delete one or more objects. Accepts URLs (Vercel Blob convention) — in
 * P5.1.b the GCS adapter will reverse-map URLs to bucket keys internally.
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
 * Resolve a download URL for an object. In P5.1.a this is a pass-through of
 * the public URL (Vercel Blob's `downloadUrl` is returned by `put` directly,
 * and re-derivable from any object URL via the `?download=1` convention).
 *
 * Per W3 verdict 12b3b18 decision C: in P5.1.b this becomes a GCS v4 signed
 * URL with `responseDisposition=attachment` + 15 min TTL for compile-capcut.
 * Callers should treat the returned URL as short-lived even today to keep
 * the contract stable across the swap.
 */
export async function getDownloadUrl(
  urlOrKey: string,
  opts: DownloadUrlOptions = {},
): Promise<string> {
  // Vercel Blob: public URLs are stable; `?download=1` forces attachment.
  // P5.1.b will replace this with `bucket.file(key).getSignedUrl({
  //   version: "v4", action: "read", expires: now + ttlSeconds * 1000,
  //   responseDisposition: opts.filename
  //     ? `attachment; filename="${opts.filename}"`
  //     : "attachment",
  // })`.
  void opts;
  if (urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://")) {
    const u = new URL(urlOrKey);
    u.searchParams.set("download", "1");
    return u.toString();
  }
  // Bare key path → caller is presumed to have a fresh head() result;
  // we don't synthesize a public URL here because Vercel Blob domains
  // are deployment-scoped. Surface a typed error so the caller's contract
  // intent is unambiguous.
  throw new StorageError(
    "download_url_requires_full_url",
    `storage.getDownloadUrl requires a full URL in P5.1.a (got bare key: ${urlOrKey})`,
  );
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string; name?: string };
  if (e.status === 404) return true;
  if (e.name === "BlobNotFoundError") return true;
  const msg = (e.message ?? "").toLowerCase();
  return msg.includes("not found") || msg.includes("the requested blob");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
