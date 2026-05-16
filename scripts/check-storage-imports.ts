#!/usr/bin/env tsx
/**
 * Grep invariant check for P5.1 storage facade (per W3 verdict cd7f45a D4).
 *
 * Enforces that `@vercel/blob` and `@vercel/blob/client` are only imported
 * by the storage facade itself (and a small set of legacy frontend files
 * scheduled for cleanup in P5.1.a-5). All other callers MUST go through
 * `@/lib/storage`.
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
 * Matches `import ... from "@vercel/blob"` (top-level package).
 *
 * Requires the `import` keyword at line start to avoid false positives on
 * comments / docstrings / string literals that happen to mention the package
 * name. Lazy `[^"']*?` with `s` flag handles multi-line `import { ... }`.
 * Quote-terminated so `@vercel/blob/client` won't match.
 */
const TOP_IMPORT = /(?:^|\n)\s*import\b[^"']*?from\s+["']@vercel\/blob["']/s;

/** Matches `import ... from "@vercel/blob/client"` (browser/server signed-upload sub-path). */
const CLIENT_IMPORT = /(?:^|\n)\s*import\b[^"']*?from\s+["']@vercel\/blob\/client["']/s;

/** Files allowed to import top-level `@vercel/blob`. */
const TOP_WHITELIST = new Set<string>(["lib/storage/api.ts"]);

/**
 * Files allowed to import `@vercel/blob/client`.
 *
 * - `lib/storage/signed-upload.ts`: server-side facade (P5.1.a-4, this commit).
 * - 4 client components: legacy direct callers, TO BE REMOVED in P5.1.a-5
 *   when `lib/storage/client/upload.ts` browser shim lands.
 */
const CLIENT_WHITELIST = new Set<string>([
  "lib/storage/signed-upload.ts",
  "components/technique-match/InputPanel.tsx",
  "components/technique-match/CapCutExport.tsx",
  "components/review/InputPanel.tsx",
  "components/template-review/BriefUploader.tsx",
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
  readonly kind: "top" | "client";
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
      if (CLIENT_IMPORT.test(content) && !CLIENT_WHITELIST.has(rel)) {
        violations.push({ file: rel, kind: "client" });
      }
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const violations = await scan();
  if (violations.length === 0) {
    console.log(
      "✓ storage import invariants clean — no out-of-whitelist @vercel/blob[/client] callers.",
    );
    return;
  }
  console.error("✗ storage import invariant violations:\n");
  for (const v of violations) {
    const pkg = v.kind === "top" ? "@vercel/blob" : "@vercel/blob/client";
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
