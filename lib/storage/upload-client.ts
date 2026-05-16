"use client";

/**
 * Browser-side shim re-exporting `upload` from `@vercel/blob/client`.
 *
 * Per W3 P5.1.a-4 deep verdict 819e3fb (a-5 cleared): the 4 frontend
 * callers (technique-match/InputPanel, technique-match/CapCutExport,
 * review/InputPanel, template-review/BriefUploader) import from here
 * instead of `@vercel/blob/client` directly so that:
 *
 * 1. P5.1.a grep invariant is clean — only this file + `signed-upload.ts`
 *    (server) touch `@vercel/blob/client`. `CLIENT_WHITELIST` shrinks to 2.
 * 2. P5.1.b GCS swap can replace the body of this file with an equivalent
 *    browser function (GCS v4 signed POST URL flow has no `upload()` SDK
 *    parity — facade will hand-roll the POST). 4 callers don't change.
 *
 * Naming note (偏离 W3 outline `lib/storage/client/upload.ts`):
 * - Avoids visual / grep collision with sibling `lib/storage/client.ts`
 *   (which is the server-only storage SDK singleton — `getStorage()`).
 * - File path `upload-client.ts` makes browser intent explicit at a glance.
 *
 * Not re-exported from `lib/storage/index.ts`: index imports `server-only`,
 * which would crash any client component importing transitively through it.
 * Callers must use the deep path: `import { upload } from "@/lib/storage/upload-client"`.
 *
 * Defense in depth: `"use client"` directive ensures Next.js bundles this
 * file browser-side only (`@vercel/blob/client` is already marked browser-only
 * by the package, but the directive prevents accidental server import).
 */

export { upload } from "@vercel/blob/client";
