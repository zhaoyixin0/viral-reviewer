/**
 * Platform-neutral storage facade.
 *
 * Per W3 P5.1 verdict 12b3b18 + c9367c4:
 * - All callers MUST import from `@/lib/storage` (not `@vercel/blob` or
 *   `@google-cloud/storage` directly). THREE grep invariants enforced:
 *
 *   1. `from "@vercel/blob"` — only `lib/storage/api.ts`
 *      (whitelist preserved for P5.1.b transient state; api.ts no longer
 *      imports it after b-1 commit 3, b-4 removes the dep entirely).
 *   2. `from "@vercel/blob/client"` — only `lib/storage/signed-upload.ts`
 *      (server, handleUpload integration) + `lib/storage/upload-client.ts`
 *      (browser shim, `"use client"`, re-exports `upload` for 4 frontend
 *      callers). b-2 + b-3 will retire these.
 *   3. `from "@google-cloud/storage"` — only `lib/storage/api.ts` and
 *      `lib/storage/client.ts` (P5.1.b-1 commits 1-3). b-2 will add
 *      `signed-upload.ts` to this whitelist.
 *
 *   `upload-client.ts` NOT re-exported here — index.ts is `server-only`-tainted;
 *   client components must use the deep path.
 *
 *   CI enforcement: `npm run check:storage-imports` (scripts/check-storage-imports.ts).
 *
 * - P5.1.a (complete): thin wrappers around `@vercel/blob` / `@vercel/blob/client`.
 * - P5.1.b-1 (current after commit chain): api.ts + client.ts on
 *   `@google-cloud/storage`. signed-upload.ts + upload-client.ts still on
 *   `@vercel/blob/client` until b-2 + b-3.
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
