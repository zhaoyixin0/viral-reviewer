#!/usr/bin/env tsx
/**
 * Grep invariant check for P5.1 storage facade.
 *
 * Enforces TWO grep invariants — direct SDK imports are confined to the
 * facade. All callers MUST go through `@/lib/storage`.
 *
 *   1. `@vercel/blob`         only in `lib/storage/api.ts`         (P5.1.a)
 *      (← retired in P5.1.b-1 commit 2: api.ts no longer imports it, but
 *      the whitelist entry is preserved until b-4 removes the dep so a
 *      stray reintroduction here is still caught.)
 *   2. `@google-cloud/storage` only in `lib/storage/api.ts` and
 *      `lib/storage/client.ts`                                     (P5.1.b)
 *      (← signed-upload.ts in b-2 + upload-client.ts in b-3 DELIBERATELY
 *      go through the api.ts facade — keeps the SDK touch surface at 2
 *      files; the browser shim hand-rolls multipart POST with no SDK call.)
 *
 *   The `@vercel/blob/client` invariant was REMOVED in P5.1.b-3 commit 2:
 *   after upload-client.ts hand-rolled the GCS POST policy lifecycle in
 *   b-3 commit 1, no file imports `@vercel/blob/client` any longer; the
 *   regex + whitelist had become dead code.
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
 * Matches `import ... from "@vercel/blob"` or `export ... from "@vercel/blob"`
 * (top-level package).
 *
 * Requires `import` / `export` keyword at line start to avoid false positives
 * on comments / docstrings / string literals that mention the package name.
 * Lazy `[^"']*?` with `s` flag handles multi-line `import { ... }`.
 * Quote-terminated so `@vercel/blob/client` won't match.
 *
 * Both `import { x } from` AND `export { x } from` are caught (per
 * typescript-reviewer 2026-05-16 a-5 LOW #1: re-export form was a latent
 * gap; upload-client.ts itself uses `export ... from`).
 */
const TOP_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^"']*?from\s+["']@vercel\/blob["']/s;

/**
 * Matches `import ... from "@google-cloud/storage"` or `export ... from ...`.
 *
 * Uses the same `(?:import|export)\b` form as TOP_IMPORT / CLIENT_IMPORT
 * (per a-5 LOW #1: re-export form was a latent gap that the typescript-reviewer
 * caught only after a-5 commit; keep all three regexes consistent).
 */
const GCS_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^"']*?from\s+["']@google-cloud\/storage["']/s;

/** Files allowed to import top-level `@vercel/blob`. */
const TOP_WHITELIST = new Set<string>(["lib/storage/api.ts"]);

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
  readonly kind: "top" | "gcs";
}

async function scan(): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const dir of SCAN_DIRS) {
    for await (const abs of walk(join(ROOT, dir))) {
      const rel = normalize(abs);
      const content = await readFile(abs, "utf8");
      if (TOP_IMPORT.test(content) && !TOP_WHITELIST.has(rel)) {
        violations.push({ file: rel, kind: "top" });
      }
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
      "✓ storage import invariants clean — no out-of-whitelist @vercel/blob or @google-cloud/storage callers.",
    );
    return;
  }
  console.error("✗ storage import invariant violations:\n");
  for (const v of violations) {
    const pkg = v.kind === "top" ? "@vercel/blob" : "@google-cloud/storage";
    console.error(`    ${v.file}: imports ${pkg} (not in whitelist)`);
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
