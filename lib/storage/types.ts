/**
 * Platform-neutral storage types.
 *
 * Designed to wrap `@vercel/blob` in P5.1.a (thin wrapper) and swap to
 * `@google-cloud/storage` in P5.1.b without changing caller code.
 *
 * Per W3 P5.1 verdict 12b3b18:
 * - B1: `head` returns null on 404; all other ops throw on failure.
 * - H: key naming preserved 1:1 with current `@vercel/blob` keys.
 * - I: addRandomSuffix uses crypto.randomUUID().slice(0, 8) hex when GCS swap lands.
 */

export type StorageProvider = "vercel-blob" | "gcs";

export interface BlobInfo {
  url: string;
  pathname: string;
  contentType?: string;
  size?: number;
  uploadedAt?: Date;
}

export interface PutOptions {
  access: "public";
  contentType?: string;
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
  cacheControlMaxAge?: number;
}

export interface PutResult {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType?: string;
  contentDisposition?: string;
}

export interface ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface ListResult {
  blobs: BlobInfo[];
  cursor?: string;
  hasMore: boolean;
}

export interface DownloadUrlOptions {
  /** Seconds until the signed URL expires. Only relevant for GCS swap (P5.1.b). */
  ttlSeconds?: number;
  /** Filename hint for Content-Disposition. */
  filename?: string;
}

/**
 * Errors thrown by `lib/storage/*` operations.
 *
 * `code` is a stable identifier callers may switch on without inspecting
 * the underlying provider error shape.
 */
export class StorageError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.cause = cause;
  }
}
