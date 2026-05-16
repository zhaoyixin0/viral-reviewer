/**
 * Platform-neutral storage facade.
 *
 * Per W3 P5.1 verdict chain 12b3b18 + c9367c4 + 78b7d2f + dc7ca23, full
 * GCS migration COMPLETE as of P5.1.b-4:
 * - All callers MUST import from `@/lib/storage` (not `@google-cloud/storage`
 *   directly). ONE grep invariant enforced:
 *
 *   1. `from "@google-cloud/storage"` — only `lib/storage/api.ts` and
 *      `lib/storage/client.ts`. b-2 (signed-upload.ts) + b-3 (upload-client.ts)
 *      DELIBERATELY route through the api.ts facade rather than touching the
 *      SDK directly — keeping the SDK touch surface at exactly 2 files.
 *
 *   The `@vercel/blob/client` invariant was REMOVED in P5.1.b-3 commit 2;
 *   the `@vercel/blob` invariant was REMOVED in P5.1.b-4 (the dep itself
 *   was uninstalled from package.json, so any future import attempt fails
 *   at TypeScript resolution — no runtime tripwire needed).
 *
 *   `upload-client.ts` NOT re-exported here — index.ts is `server-only`-tainted;
 *   client components must use the deep path.
 *
 *   CI enforcement: `npm run check:storage-imports` (scripts/check-storage-imports.ts).
 *
 * P5.1 phase timeline:
 * - a (complete): thin wrappers around @vercel/blob / @vercel/blob/client.
 * - b-1 (complete): api.ts + client.ts on @google-cloud/storage.
 * - b-2 (complete): signed-upload.ts lifecycle rewritten to GCS v4
 *   signed POST policy + HMAC completion ping (W3 verdict 78b7d2f).
 * - b-3 (complete): upload-client.ts browser shim hand-rolled to multipart
 *   POST direct to GCS + completion ping back (W3 verdict dc7ca23 + ECC).
 * - b-4 (current): @vercel/blob dep removed; TOP_WHITELIST + TOP_IMPORT
 *   regex collapsed; ONE grep invariant remains.
 */

export {
  del,
  generateSignedPostPolicy,
  getDownloadUrl,
  head,
  list,
  put,
  signCompletionToken,
  type CompletionTokenPayload,
  type SignedPostPolicy,
  type SignedPostPolicyOptions,
  urlToKey,
  verifyCompletionToken,
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
