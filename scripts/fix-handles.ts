/**
 * Run: npx tsx scripts/fix-handles.ts
 *
 * 一次性修复已抓取数据中的 "@@username" 双 @ 问题
 */
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { ViralVideo } from "../lib/review-engine/types";

async function main() {
  const dir = join(process.cwd(), "data", "scraped");
  const files = await readdir(dir);

  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const path = join(dir, f);
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as ViralVideo[];
    let fixed = 0;
    for (const v of data) {
      if (v.authorHandle?.startsWith("@@")) {
        v.authorHandle = `@${v.authorHandle.replace(/^@+/, "")}`;
        fixed++;
      }
    }
    if (fixed > 0) {
      await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
      console.log(`  · ${f}: fixed ${fixed} handles`);
    }
  }
}

main().catch(console.error);
