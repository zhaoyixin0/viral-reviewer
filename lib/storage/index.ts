/**
 * Platform-neutral storage facade.
 *
 * Per W3 P5.1 verdict 12b3b18:
 * - All callers MUST import from `@/lib/storage` (not `@vercel/blob` or
 *   `@google-cloud/storage` directly). Grep invariants enforced after a-4:
 *
 *   1. `from "@vercel/blob"` — only `lib/storage/api.ts`.
 *   2. `from "@vercel/blob/client"` — only `lib/storage/signed-upload.ts`
 *      (server, handleUpload integration) + `lib/storage/upload-client.ts`
 *      (browser shim, `"use client"`, re-exports `upload` for the 4 frontend
 *      callers). 4 caller components import from `@/lib/storage/upload-client`.
 *
 *   `upload-client.ts` NOT re-exported here — index.ts is `server-only`-tainted;
 *   client components must use the deep path.
 *
 *   CI enforcement: `npm run check:storage-imports` (scripts/check-storage-imports.ts).
 *
 * - P5.1.a (current): thin wrappers around `@vercel/blob` / `@vercel/blob/client`.
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
  handleSignedUpload,
  InvalidUploadBodyError,
  type SignedUploadCompletion,
  type UploadEnvelope,
  type UploadPolicy,
} from "./signed-upload";

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
