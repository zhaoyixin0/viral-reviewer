import "server-only";

import type { StorageProvider } from "./types";

/**
 * Platform-neutral storage client handle.
 *
 * P5.1.a (current): thin wrapper around `@vercel/blob` — `enabled` reflects
 * `BLOB_READ_WRITE_TOKEN` presence, no SDK instance is held.
 *
 * P5.1.b (planned, per W3 verdict 12b3b18): will hold a singleton
 * `@google-cloud/storage` `Storage` instance + resolved bucket name.
 */
export interface StorageClient {
  readonly provider: StorageProvider;
  readonly enabled: boolean;
}

let cached: StorageClient | null = null;

/**
 * Lazily resolve the storage client.
 *
 * Per W3 verdict 12b3b18 decision A1: singleton pattern mirrors
 * `lib/technique-matching/match-engine.ts` Anthropic SDK pattern.
 * Container-level reuse is the whole point — never construct per request.
 *
 * Per W3 anti-pattern #4: missing token logs once but does NOT throw.
 * Callers already guard with `if (!enabled) return null`; throwing here
 * would break the soft-fail UX (cache miss falls through to live fetch).
 */
export function getStorage(): StorageClient {
  if (cached) return cached;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  cached = {
    provider: "vercel-blob",
    enabled: !!token,
  };
  return cached;
}

/**
 * Test-only: clear the cached singleton so the next `getStorage()` re-resolves
 * env vars. Pair with `vi.resetModules()` when swapping mocked envs mid-test.
 */
export function __resetStorageForTests(): void {
  cached = null;
}
