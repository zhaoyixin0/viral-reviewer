/**
 * Run: npx tsx --env-file=.env.local scripts/download-mp4s.ts
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { downloadVideo } from "@/lib/enrichment/video-downloader";

type Item = { id: string; videoUrl: string | null; platform: string };

const CONCURRENCY = 5;

async function* chunks<T>(arr: T[], size: number) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

async function main() {
  const inPath = join(process.cwd(), "data", "rescrape-2026-05-13.json");
  const raw = await readFile(inPath, "utf-8");
  const items = (JSON.parse(raw) as Item[]).filter((v) => v.videoUrl);
  console.log(`[download] starting ${items.length} videos`);

  const outDir = join(process.cwd(), "data", "raw-mp4s");

  let done = 0;
  let failed = 0;
  const errors: { id: string; reason: string }[] = [];

  for await (const batch of chunks(items, CONCURRENCY)) {
    const results = await Promise.all(
      batch.map(async (v) => {
        const out = join(outDir, `${v.id}.mp4`);
        return { id: v.id, result: await downloadVideo(v.videoUrl!, out) };
      }),
    );
    for (const { id, result } of results) {
      done++;
      if (result.ok) {
        process.stdout.write(
          `  [${done}/${items.length}] ${id} ${result.cached ? "(cached)" : `${(result.bytes / 1024 / 1024).toFixed(1)} MB`}\n`,
        );
      } else {
        failed++;
        errors.push({ id, reason: result.reason });
        process.stdout.write(`  [${done}/${items.length}] ${id} FAIL: ${result.reason}\n`);
      }
    }
  }

  console.log(`\n[download] done: ${items.length - failed} ok, ${failed} failed`);
  if (errors.length > 0) {
    console.log("[download] errors:", JSON.stringify(errors.slice(0, 10), null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
