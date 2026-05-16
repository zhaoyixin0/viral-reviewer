/**
 * Platform-neutral storage facade.
 *
 * Per W3 P5.1 verdict 12b3b18 + c9367c4 + 78b7d2f + dc7ca23:
 * - All callers MUST import from `@/lib/storage` (not `@vercel/blob` or
 *   `@google-cloud/storage` directly). TWO grep invariants enforced:
 *
 *   1. `from "@vercel/blob"` — only `lib/storage/api.ts`
 *      (whitelist preserved as a tripwire for accidental re-introduction;
 *      api.ts no longer imports it after b-1 commit 2. b-4 removes the dep
 *      AND this whitelist entry + regex.)
 *   2. `from "@google-cloud/storage"` — only `lib/storage/api.ts` and
 *      `lib/storage/client.ts` (P5.1.b-1 commits 1-3 + b-2 commit 1
 *      added generateSignedPostPolicy to api.ts). b-2 deliberately did
 *      NOT widen this set — signed-upload.ts goes through api.ts helpers
 *      rather than touching SDK directly, keeping the SDK touch surface
 *      at exactly 2 files.
 *
 *   The `@vercel/blob/client` invariant was REMOVED in P5.1.b-3 commit 2:
 *   after upload-client.ts hand-rolled the GCS POST policy lifecycle in
 *   b-3 commit 1, no file imports `@vercel/blob/client` any longer.
 *
 *   `upload-client.ts` NOT re-exported here — index.ts is `server-only`-tainted;
 *   client components must use the deep path.
 *
 *   CI enforcement: `npm run check:storage-imports` (scripts/check-storage-imports.ts).
 *
 * - P5.1.a (complete): thin wrappers around `@vercel/blob` / `@vercel/blob/client`.
 * - P5.1.b-1 (complete): api.ts + client.ts on `@google-cloud/storage`.
 * - P5.1.b-2 (complete): signed-upload.ts lifecycle rewritten to GCS v4
 *   signed POST policy + HMAC completion ping (per W3 deep verdict 78b7d2f).
 * - P5.1.b-3 (current after commit chain): upload-client.ts browser shim
 *   hand-rolled to multipart POST direct to GCS + completion ping back
 *   (per W3 deep verdict dc7ca23 + ECC correction). b-4 cleanup follows
 *   to remove the `@vercel/blob` dep itself.
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
