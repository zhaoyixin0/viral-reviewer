/**
 * Platform-neutral storage facade.
 *
 * Per W3 P5.1 verdict 12b3b18:
 * - All callers MUST import from `@/lib/storage` (not `@vercel/blob` or
 *   `@google-cloud/storage` directly). Grep invariant enforced after P5.1.a-3.
 * - P5.1.a (current): thin wrapper around `@vercel/blob`.
 * - P5.1.b (planned): internal swap to `@google-cloud/storage`, zero caller change.
 */

export {
  del,
  getDownloadUrl,
  head,
  list,
  put,
} from "./api";

export {
  __resetStorageForTests,
  getStorage,
  type StorageClient,
} from "./client";

export {
  type BlobInfo,
  type DownloadUrlOptions,
  type ListOptions,
  type ListResult,
  type PutOptions,
  type PutResult,
  type StorageProvider,
  StorageError,
} from "./types";
