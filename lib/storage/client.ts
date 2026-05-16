import "server-only";

import { Storage, type Bucket } from "@google-cloud/storage";

import type { StorageProvider } from "./types";

/**
 * Platform-neutral storage client handle.
 *
 * P5.1.b (current, per W3 verdict c9367c4 A1): holds a singleton
 * `@google-cloud/storage` `Storage` instance + resolved `Bucket` reference.
 * Lazy-constructed on first `getStorage()` call so module load never throws.
 *
 * `enabled` reflects `GCS_BUCKET_NAME` presence. Missing env var → soft-fail
 * (`enabled: false`, `bucket: null`) per W3 anti-pattern #4: throwing at
 * module load (or first call) would brick local dev / preview deploys where
 * the bucket may not yet be wired. Callers reach storage via the `head` /
 * `put` / `list` / `del` exports — those will surface a clear `StorageError`
 * (commit 2-3) if the bucket handle is null, rather than crashing at import.
 */
export interface StorageClient {
  readonly provider: StorageProvider;
  readonly enabled: boolean;
  /** GCS bucket handle. `null` iff `enabled === false`. */
  readonly bucket: Bucket | null;
  /** Resolved bucket name. Empty string iff `enabled === false`. */
  readonly bucketName: string;
}

let cached: StorageClient | null = null;

/**
 * Lazily resolve the storage client.
 *
 * Per W3 verdict 12b3b18 decision A1: singleton pattern mirrors
 * `lib/technique-matching/match-engine.ts` Anthropic SDK pattern.
 * Container-level reuse is the whole point — never construct per request.
 *
 * Credentials resolution is delegated to the SDK's ADC chain (GOOGLE_*
 * env vars → metadata server → gcloud user creds), so this function never
 * touches secrets directly.
 */
export function getStorage(): StorageClient {
  if (cached) return cached;
  const bucketName = process.env.GCS_BUCKET_NAME ?? "";
  if (!bucketName) {
    cached = {
      provider: "gcs",
      enabled: false,
      bucket: null,
      bucketName: "",
    };
    return cached;
  }
  const storage = new Storage();
  cached = {
    provider: "gcs",
    enabled: true,
    bucket: storage.bucket(bucketName),
    bucketName,
  };
  return cached;
}

/**
 * Test-only: clear the cached singleton so the next `getStorage()` re-resolves
 * env vars AND constructs a fresh `Storage` instance.
 *
 * Per W3 verdict c9367c4 nit: must reset the underlying `Storage` instance,
 * not just drop the bucket reference — otherwise tests that swap mocked env
 * mid-suite would observe stale credentials/HTTP-pool state from the prior
 * Storage instance. Setting `cached = null` achieves this because the next
 * `getStorage()` call hits the `new Storage()` branch fresh.
 */
export function __resetStorageForTests(): void {
  cached = null;
}
