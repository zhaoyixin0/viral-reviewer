#!/usr/bin/env tsx
/**
 * Grep invariant check for P5.1 storage facade.
 *
 * Enforces ONE grep invariant — direct SDK import is confined to the
 * facade. All callers MUST go through `@/lib/storage`.
 *
 *   1. `@google-cloud/storage` only in `lib/storage/api.ts` and
 *      `lib/storage/client.ts`                                     (P5.1.b)
 *      (← signed-upload.ts in b-2 + upload-client.ts in b-3 DELIBERATELY
 *      go through the api.ts facade — keeps the SDK touch surface at 2
 *      files; the browser shim hand-rolls multipart POST with no SDK call.)
 *
 *   The `@vercel/blob/client` invariant was REMOVED in P5.1.b-3 commit 2
 *   (upload-client.ts hand-rolled the GCS POST policy in b-3 commit 1,
 *   making the regex + whitelist dead code).
 *
 *   The `@vercel/blob` invariant was REMOVED in P5.1.b-4 (this commit):
 *   `@vercel/blob` dep itself uninstalled from package.json, so any future
 *   import attempt fails at TypeScript resolution. The TOP_WHITELIST +
 *   TOP_IMPORT regex collapsed into the dead-code pile.
 *
 * Why a custom script (not `npm run lint`): grep invariant violations need
 * a precise, ungated failure message pointing at the offending file —
 * mixing into ESLint output dilutes the signal and risks false-positive
 * suppression. Independent CI step also fails fast (~50ms cold).
 *
 * Why pure Node fs (no `rg`): avoids cross-platform binary dependency
 * (Windows dev / Linux CI) and keeps the check self-contained in the repo.
 *
 * Run: `npm run check:storage-imports`
 * Exit: 0 if clean, 1 if any violation.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

/** Directories to scan for `.ts` / `.tsx` files. */
const SCAN_DIRS = ["app", "components", "lib", "scripts", "tests"] as const;

/** Directory names to never descend into. */
const SKIP_DIRS = new Set([
  ".next",
  "node_modules",
  "dist",
  ".git",
  "coverage",
  ".vercel",
]);

/**
 * Matches `import ... from "@google-cloud/storage"` or `export ... from ...`.
 *
 * Uses the same `(?:import|export)\b` form as TOP_IMPORT / CLIENT_IMPORT
 * (per a-5 LOW #1: re-export form was a latent gap that the typescript-reviewer
 * caught only after a-5 commit; keep all three regexes consistent).
 */
const GCS_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^"']*?from\s+["']@google-cloud\/storage["']/s;

/**
 * Files allowed to import `@google-cloud/storage` (P5.1.b).
 *
 * - `lib/storage/api.ts`: head/put/list/del/getDownloadUrl +
 *   generateSignedPostPolicy (P5.1.b-1 commits 2-3 + b-2 commit 1)
 * - `lib/storage/client.ts`: lazy Storage singleton constructed here
 *   (P5.1.b-1 commit 1)
 *
 * P5.1.b-2 deliberately did NOT add `signed-upload.ts` here (scope §2.1
 * row 6 anticipated it would) — the b-2 rewrite goes through api.ts
 * helpers rather than touching the SDK directly, keeping the SDK touch
 * surface at exactly 2 files. b-3 (upload-client.ts) is browser-side and
 * also will NOT join this set (it will hand-roll a fetch POST with no
 * Node SDK call).
 */
const GCS_WHITELIST = new Set<string>([
  "lib/storage/api.ts",
  "lib/storage/client.ts",
]);

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // dir doesn't exist — fine, skip silently
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) {
      yield p;
    }
  }
}

function normalize(absPath: string): string {
  return relative(ROOT, absPath).split(sep).join("/");
}

interface Violation {
  readonly file: string;
  readonly kind: "gcs";
}

async function scan(): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const dir of SCAN_DIRS) {
    for await (const abs of walk(join(ROOT, dir))) {
      const rel = normalize(abs);
      const content = await readFile(abs, "utf8");
      if (GCS_IMPORT.test(content) && !GCS_WHITELIST.has(rel)) {
        violations.push({ file: rel, kind: "gcs" });
      }
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const violations = await scan();
  if (violations.length === 0) {
    console.log(
      "✓ storage import invariant clean — no out-of-whitelist @google-cloud/storage callers.",
    );
    return;
  }
  console.error("✗ storage import invariant violations:\n");
  for (const v of violations) {
    console.error(
      `    ${v.file}: imports @google-cloud/storage (not in whitelist)`,
    );
  }
  console.error(
    "\nAll callers MUST import from @/lib/storage. See lib/storage/index.ts head docstring.",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("[check-storage-imports] unexpected error:", e);
  process.exit(1);
});
